import nodemailer from 'nodemailer'
import { getPortalUserEmail } from './agol.js'
import { env } from './env.js'
import { pool } from './db.js'

type AffectedItem = {
  deleted_item_id: string
  affected_item_id: string
  title: string
  owner_username: string | null
}

type EmailLookup = { email: string | null; error?: string }
type EmailLookupResult = { values: Map<string, EmailLookup>; error?: string }
type AffectedItemNotice = {
  item_id: string
  title: string
  deleted_by: Map<string, { item_id: string; title: string }>
}

export type PreparedDeletionNotifications = {
  affectedItems: AffectedItem[]
  emails: Promise<EmailLookupResult>
  error?: string
}

export type DeletionNotification = {
  username: string | null
  email: string | null
  affected_items: { item_id: string; title: string }[]
  status: 'sent' | 'failed' | 'skipped'
  reason?: string
}

export type DeletionNotificationSummary = {
  notifications: DeletionNotification[]
}

export async function prepareDeletionNotifications(input: {
  orgId: string
  plannedDeleteIds: string[]
  portalUrl: string
  token: string
  referer: string
}): Promise<PreparedDeletionNotifications> {
  try {
    const result = await pool.query<AffectedItem>(
      `select d.dependency_item_id as deleted_item_id,
              affected.item_id as affected_item_id,
              affected.title,
              affected.owner_username
       from item_dependencies d
       join items affected on affected.org_id = d.org_id and affected.item_id = d.item_id
       where d.org_id = $1 and d.dependency_item_id = any($2::text[])
       order by affected.title, affected.item_id`,
      [input.orgId, [...new Set(input.plannedDeleteIds)]],
    )
    const affectedItems = result.rows
    const owners = [...new Map(
      affectedItems.flatMap((item) => item.owner_username
        ? [[item.owner_username.toLowerCase(), item.owner_username] as const]
        : []),
    ).values()]
    const emails = retrieveEmails(owners, input).then(
      (values) => ({ values }),
      () => ({ values: new Map<string, EmailLookup>(), error: 'Email lookups failed unexpectedly.' }),
    )
    return { affectedItems, emails }
  } catch {
    return {
      affectedItems: [],
      emails: Promise.resolve({ values: new Map(), error: 'Notification preparation failed unexpectedly.' }),
      error: 'Affected items or owner usernames could not be retrieved from the database.',
    }
  }
}

async function retrieveEmails(
  owners: string[],
  input: { portalUrl: string; token: string; referer: string },
): Promise<Map<string, EmailLookup>> {
  const emails = new Map<string, EmailLookup>()
  const deadline = Date.now() + 60_000
  let nextOwner = 0
  const lookupWorker = async () => {
    while (nextOwner < owners.length) {
      const username = owners[nextOwner++]
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        emails.set(username.toLowerCase(), { email: null, error: 'Email lookup timed out.' })
        continue
      }
      try {
        const email = await getPortalUserEmail(
          input.portalUrl,
          input.token,
          input.referer,
          username,
          Math.min(30_000, remaining),
        )
        emails.set(username.toLowerCase(), { email })
      } catch {
        emails.set(username.toLowerCase(), {
          email: null,
          error: Date.now() >= deadline ? 'Email lookup timed out.' : 'Could not retrieve the ArcGIS email address.',
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, owners.length) }, () => lookupWorker()))
  return emails
}

export async function sendDeletionNotifications(
  prepared: PreparedDeletionNotifications,
  deletedItems: { id: string; title: string }[],
  initiator: string,
): Promise<DeletionNotificationSummary> {
  if (prepared.error) {
    return { notifications: [failed(null, [], prepared.error)] }
  }

  const deletedById = new Map(deletedItems.map((item) => [item.id, item]))
  const owners = new Map<string, {
    username: string
    affected: Map<string, AffectedItemNotice>
  }>()
  const unowned = new Map<string, { item_id: string; title: string }>()
  for (const row of prepared.affectedItems) {
    const responsible = deletedById.get(row.deleted_item_id)
    if (!responsible || deletedById.has(row.affected_item_id)) continue
    const affected = { item_id: row.affected_item_id, title: row.title }
    if (!row.owner_username) {
      unowned.set(row.affected_item_id, affected)
      continue
    }
    const key = row.owner_username.toLowerCase()
    let owner = owners.get(key)
    if (!owner) {
      owner = {
        username: row.owner_username,
        affected: new Map(),
      }
      owners.set(key, owner)
    }
    let notice = owner.affected.get(affected.item_id)
    if (!notice) {
      notice = { ...affected, deleted_by: new Map() }
      owner.affected.set(affected.item_id, notice)
    }
    notice.deleted_by.set(responsible.id, {
      item_id: responsible.id,
      title: responsible.title,
    })
  }

  const { values: emails, error: emailLookupError } = await prepared.emails
  const notifications: DeletionNotification[] = unowned.size
    ? [skipped(null, [...unowned.values()], 'Affected items have no owner username in the database.')]
    : []
  const transport = env.smtpHost && env.smtpFrom
    ? nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        ...(env.smtpUser && env.smtpPassword
          ? { auth: { user: env.smtpUser, pass: env.smtpPassword } }
          : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      })
    : null

  const entries = [...owners.entries()]
  let nextOwner = 0
  const sendWorker = async () => {
    while (nextOwner < entries.length) {
      const [key, owner] = entries[nextOwner++]
      const lookup = emails.get(key)
      const entry: DeletionNotification = {
        username: owner.username,
        email: lookup?.email ?? null,
        affected_items: [...owner.affected.values()].map(({ item_id, title }) => ({ item_id, title })),
        status: 'skipped',
      }
      if (emailLookupError) {
        entry.status = 'failed'
        entry.reason = emailLookupError
      } else if (lookup?.error) {
        entry.status = 'failed'
        entry.reason = lookup.error
      } else if (!lookup?.email) {
        entry.reason = 'No email address was available from ArcGIS.'
      } else if (!transport) {
        entry.reason = 'SMTP is not configured.'
      } else {
        try {
          const affectedByDeleted = new Map<string, {
            title: string
            affected: Map<string, { item_id: string; title: string }>
          }>()
          for (const affected of owner.affected.values()) {
            for (const deleted of affected.deleted_by.values()) {
              let group = affectedByDeleted.get(deleted.item_id)
              if (!group) {
                group = { title: deleted.title, affected: new Map() }
                affectedByDeleted.set(deleted.item_id, group)
              }
              group.affected.set(affected.item_id, {
                item_id: affected.item_id,
                title: affected.title,
              })
            }
          }
          const deletedGroups = [...affectedByDeleted.values()]
          const info = await transport.sendMail({
            from: env.smtpFrom!,
            to: lookup.email,
            subject: 'ArcGIS Content Deletion Notification',
            text: [
              deletedGroups.length > 1
                ? `Multiple ArcGIS items were deleted by ${initiator}, and one or more of your items may be affected by this deletion.`
                : `An ArcGIS item was deleted by ${initiator}, and one or more of your items may be affected by this deletion.`,
              '',
              ...deletedGroups.flatMap((group, index) => [
                `Deleted item: ${group.title}`,
                'Your affected items:',
                ...[...group.affected.values()].map((item) => `- ${item.title} (ID: ${item.item_id})`),
                ...(index < deletedGroups.length - 1 ? [''] : []),
              ]),
              '',
              'Please review your affected ArcGIS items to ensure they continue functioning as expected.',
              '',
              'This is an automated notification. No action is required regarding the deletion itself.',
            ].join('\n'),
          })
          if (info.accepted.length > 0) entry.status = 'sent'
          else {
            entry.status = 'failed'
            entry.reason = 'SMTP did not accept the message.'
          }
        } catch {
          entry.status = 'failed'
          entry.reason = 'SMTP could not send the message.'
        }
      }
      notifications.push(entry)
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, () => sendWorker()))
  } finally {
    transport?.close()
  }

  if (notifications.length === 0) {
    notifications.push(skipped(null, [], 'No surviving affected items required notification.'))
  }
  return { notifications }
}

function skipped(
  username: string | null,
  affected_items: { item_id: string; title: string }[],
  reason: string,
): DeletionNotification {
  return { username, email: null, affected_items, status: 'skipped', reason }
}

function failed(
  username: string | null,
  affected_items: { item_id: string; title: string }[],
  reason: string,
): DeletionNotification {
  return { username, email: null, affected_items, status: 'failed', reason }
}
