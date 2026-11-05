import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { requireAuth } from './auth.js'
import { recoverRuns, runReport, startCollection } from './collector.js'
import { databaseStatus, ensureOrganization, pool, prepareDatabase } from './db.js'
import { env } from './env.js'
import { identityStatus, prepareKeycloak } from './keycloak.js'

const app = express()
app.use(cors({ origin: env.webOrigin }))
app.use(express.json())

app.get('/api/health', asyncRoute(async (_req, res) => {
  const [database, identity] = await Promise.all([
    Promise.resolve(databaseStatus()),
    identityStatus(),
  ])
  res.json({
    api: 'ok',
    database,
    identity,
    identityUrl: `${env.keycloakUrl}/realms/${env.keycloakRealm}`,
  })
}))

app.get('/api/overview', requireAuth, asyncRoute(async (_req, res) => {
  const [users, groups, content, connections, jobs, activity, identity] = await Promise.all([
    count('users'),
    count('groups'),
    count('items'),
    count('connections'),
    count('migration_jobs'),
    pool.query<{ id: string; actor: string; action: string; target: string | null; occurred_at: Date }>(
      `select id, actor, action, target, occurred_at
       from activity_events
       order by occurred_at desc
       limit 8`,
    ),
    identityStatus(),
  ])

  res.json({
    counts: {
      users,
      groups,
      content,
      connections,
      jobs,
    },
    services: {
      database: 'ok',
      identity,
    },
    activity: activity.rows,
  })
}))

const staleGroupDays = 365
const emptyCheckTypes = ['Web Map', 'Feature Service', 'Feature Collection', 'CSV', 'Map Service']

const itemFilters: Record<string, string> = {
  deprecated: `i.deprecated`,
  never_modified: `i.never_modified`,
  owner_disabled: `i.owner_disabled`,
  empty: `i.is_empty`,
  depends_on_empty: `i.depends_on_empty`,
  no_usage: `i.usage_30d = 0`,
}

const itemSorts: Record<string, string> = {
  title: `i.title asc`,
  views: `i.views desc nulls last, i.title`,
  oldest: `i.modified_at asc nulls last, i.title`,
  largest: `i.size_bytes desc nulls last, i.title`,
  most_used: `i.usage_30d desc nulls last, i.title`,
  least_used: `(i.usage_30d = 0), i.usage_30d asc nulls last, i.title`,
  dependencies: `i.dependency_count desc nulls last, i.title`,
  referenced: `i.referenced_count desc, i.title`,
  shares: `i.share_count desc, i.title`,
  score_high: `i.completeness_score desc nulls last, i.title`,
  score_low: `i.completeness_score asc nulls last, i.title`,
}

app.get('/api/organizations/summary', requireAuth, asyncRoute(async (req, res) => {
  const portalUrl = readPortalUrl(req.query.portal)
  if (!portalUrl) {
    res.status(400).json({ error: 'A portal URL is required.' })
    return
  }
  const found = await pool.query<{
    org_id: string
    name: string
    url: string
    region: string | null
    culture: string | null
    portal_version: string | null
    is_enterprise: boolean | null
    last_fetched_at: Date | null
  }>(
    `select org_id, name, url, region, culture, portal_version, is_enterprise, last_fetched_at
     from organizations where url = $1`,
    [portalUrl],
  )
  const org = found.rows[0]
  if (!org) {
    res.json({ organization: null })
    return
  }
  const id = org.org_id

  const [
    lastRun, lastSuccess, subscription, credits, storage, totals, userTypes, roles, licenses, changes, health,
    itemHealth,
  ] =
    await Promise.all([
      pool.query(
        `select status, started_at, finished_at, signed_in_username, signed_in_role, summary, error_details
         from report_runs where org_id = $1 order by started_at desc limit 1`,
        [id],
      ),
      pool.query(
        `select summary from report_runs
         where org_id = $1 and status = 'succeeded' order by started_at desc limit 1`,
        [id],
      ),
      pool.query(
        `select type, state, expires_at, max_members from subscriptions where org_id = $1`,
        [id],
      ),
      pool.query(
        `select balance::float as balance from credit_snapshots
         where org_id = $1 and balance is not null order by collected_at desc limit 1`,
        [id],
      ),
      pool.query(
        `select used_bytes::float as used_bytes, quota_bytes::float as quota_bytes
         from storage_snapshots where org_id = $1 order by collected_at desc limit 1`,
        [id],
      ),
      pool.query(
        `select
           (select count(*)::int from groups where org_id = $1) as groups,
           (select count(*)::int from items where org_id = $1) as items,
           (select coalesce(sum(views), 0)::float from items where org_id = $1) as views,
           (select count(*)::int from item_services where org_id = $1 and hosted) as hosted_services,
           (select count(*)::int from invitations where org_id = $1) as invitations`,
        [id],
      ),
      pool.query(
        `select name, assigned_count, purchased_seats from user_types
         where org_id = $1 order by assigned_count desc nulls last, name`,
        [id],
      ),
      pool.query(
        `select name, member_count from roles
         where org_id = $1 order by member_count desc nulls last, name`,
        [id],
      ),
      pool.query(
        `select license_name, license_kind, assigned_count from licenses
         where org_id = $1 order by license_kind, license_name`,
        [id],
      ),
      pool.query(
        `select history_id as id, entity_type, entity_id, action, field_name,
                old_value, new_value, details_json->>'label' as label, detected_at
         from change_history where org_id = $1
         order by detected_at desc limit 8`,
        [id],
      ),
      pool.query(
        `select
           (select count(*)::int from v_users where org_id = $1) as users,
           (select count(*)::int from v_users where org_id = $1 and activity_status = 'inactive') as inactive,
           (select count(*)::int from v_users where org_id = $1 and activity_status = 'never_logged_in') as never_logged_in,
           (select count(*)::int from v_users where org_id = $1 and disabled) as disabled,
           (select max(inactive_days) from v_users where org_id = $1) as inactive_days,
           (select count(*)::int from v_groups where org_id = $1 and item_count = 0) as empty_groups,
           (select count(*)::int from v_groups where org_id = $1 and member_count = 1) as single_member_groups,
           (select count(*)::int from v_groups where org_id = $1 and days_since_modified > $2) as stale_groups`,
        [id, staleGroupDays],
      ),
      pool.query(
        `select
           count(*)::int as items,
           count(*) filter (where ${itemFilters.deprecated})::int as deprecated,
           count(*) filter (where ${itemFilters.never_modified})::int as never_modified,
           count(*) filter (where ${itemFilters.owner_disabled})::int as owner_disabled,
           count(*) filter (where ${itemFilters.empty})::int as empty,
           count(*) filter (where ${itemFilters.depends_on_empty})::int as depends_on_empty,
           count(*) filter (where ${itemFilters.no_usage})::int as no_usage,
           count(i.dependency_count)::int as dependencies_read,
           count(i.is_empty)::int as empty_read,
           count(*) filter (where i.type = any($2))::int as empty_checkable,
           count(i.usage_30d)::int as usage_read
         from v_items i where i.org_id = $1`,
        [id, emptyCheckTypes],
      ),
    ])

  const summary = (lastSuccess.rows[0]?.summary ?? null) as { members?: number } | null
  res.json({
    organization: org,
    lastRun: lastRun.rows[0] ?? null,
    members: typeof summary?.members === 'number' ? summary.members : null,
    subscription: subscription.rows[0] ?? null,
    credits: credits.rows[0]?.balance ?? null,
    storage: storage.rows[0] ?? null,
    totals: totals.rows[0],
    userTypes: userTypes.rows,
    roles: roles.rows,
    licenses: licenses.rows,
    changes: changes.rows,
    health: { ...health.rows[0], stale_days: staleGroupDays },
    itemHealth: itemHealth.rows[0],
  })
}))

const detailQueries: Record<string, string> = {
  settings: `select section, setting_name, setting_value, fetched_at
             from organization_settings where org_id = $1 order by section, setting_name`,
  subscription: `select * from subscriptions where org_id = $1`,
  roles: `select * from roles where org_id = $1 order by member_count desc nulls last, name`,
  userTypes: `select * from user_types where org_id = $1 order by assigned_count desc nulls last, name`,
  licenses: `select * from licenses where org_id = $1 order by license_kind, license_name`,
  invitations: `select invitation_id, invited_email, invited_at, status, role, user_type, expires_at, fetched_at
                from invitations where org_id = $1 order by invited_at desc nulls last`,
  services: `select s.item_id, i.title, s.service_type, s.hosted, s.referenced, s.tiled, s.service_url, s.detected_at
             from item_services s left join items i on i.org_id = s.org_id and i.item_id = s.item_id
             where s.org_id = $1 order by i.title`,
  credits: `select collected_at, balance, budgeting_enabled, default_limit, member_count, sum_of_default_caps
            from credit_snapshots where org_id = $1 order by collected_at desc limit 20`,
  creditUsage: `select period_start, period_end, category, credits_used
                from credit_usage where org_id = $1
                  and run_id = (select run_id from credit_usage where org_id = $1 and run_id is not null
                                order by fetched_at desc limit 1)
                order by credits_used desc nulls last`,
  storage: `select collected_at, used_bytes, quota_bytes, feature_store_percent, feature_store_at
            from storage_snapshots where org_id = $1 order by collected_at desc limit 20`,
  runs: `select started_at, finished_at, status, signed_in_username, signed_in_role, items_processed, errors, summary
         from report_runs where org_id = $1 order by started_at desc limit 20`,
  checks: `select check_name, expected, actual, ok, details, checked_at
           from collection_checks where org_id = $1
             and run_id = (select run_id from collection_checks where org_id = $1
                           order by checked_at desc limit 1)
           order by checked_at, check_name`,
  gaps: `select source_name, severity, reason, gap_start
         from audit_coverage_gaps where org_id = $1
           and run_id = (select run_id from report_runs where org_id = $1 order by started_at desc limit 1)
         order by source_name`,
  changes: `select detected_at, entity_type, entity_id, details_json->>'label' as label, action, field_name,
                   old_value, new_value
            from change_history where org_id = $1 order by detected_at desc limit 500`,
}

app.get('/api/organizations/details', requireAuth, asyncRoute(async (req, res) => {
  const portalUrl = readPortalUrl(req.query.portal)
  if (!portalUrl) {
    res.status(400).json({ error: 'A portal URL is required.' })
    return
  }
  const found = await pool.query(`select * from organizations where url = $1`, [portalUrl])
  const organization = found.rows[0]
  if (!organization) {
    res.json({ organization: null, sections: {} })
    return
  }
  const names = Object.keys(detailQueries)
  const results = await Promise.all(names.map((name) => pool.query(detailQueries[name], [organization.org_id])))
  const sections: Record<string, Record<string, unknown>[]> = {}
  names.forEach((name, index) => {
    sections[name] = results[index].rows.map(({ org_id: _org, ...row }) => row)
  })
  res.json({ organization, sections })
}))

async function findOrg(portal: unknown) {
  const portalUrl = readPortalUrl(portal)
  if (!portalUrl) return null
  const found = await pool.query<{ org_id: string; name: string }>(
    `select org_id, name from organizations where url = $1`,
    [portalUrl],
  )
  return found.rows[0] ?? null
}

app.get('/api/organizations/analysis', requireAuth, asyncRoute(async (req, res) => {
  const org = await findOrg(req.query.portal)
  if (!org) {
    res.status(404).json({ error: 'Nothing collected for this portal yet.' })
    return
  }
  const output = await runReport(org.org_id, 'json', 500)
  res.type('application/json').send(output)
}))

app.get('/api/organizations/report.xlsx', requireAuth, asyncRoute(async (req, res) => {
  const org = await findOrg(req.query.portal)
  if (!org) {
    res.status(404).json({ error: 'Nothing collected for this portal yet.' })
    return
  }
  const output = await runReport(org.org_id, 'xlsx')
  const safeName = org.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'organization'
  const day = new Date().toISOString().slice(0, 10)
  res
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .attachment(`${safeName}_${day}.xlsx`)
    .send(output)
}))

const userFilters: Record<string, string> = {
  attention: `(u.activity_status in ('inactive', 'never_logged_in') or u.disabled)`,
  inactive: `u.activity_status = 'inactive'`,
  never_logged_in: `u.activity_status = 'never_logged_in'`,
  disabled: `u.disabled`,
}

app.get('/api/users', requireAuth, asyncRoute(async (req, res) => {
  const where: string[] = []
  const params: string[] = []
  const filter = userFilters[String(req.query.status ?? '')]
  if (filter) where.push(filter)
  if (req.query.portal) {
    const org = await findOrg(req.query.portal)
    if (!org) {
      res.json({ items: [] })
      return
    }
    params.push(org.org_id)
    where.push(`u.org_id = $${params.length}`)
  }
  const result = await pool.query(
    `select
       (u.org_id::text || ':' || u.username) as id,
       u.org_id,
       u.username,
       coalesce(u.full_name, u.username) as full_name,
       u.user_type,
       u.role_name,
       u.disabled,
       u.last_login_at,
       u.activity_status,
       u.items_owned,
       o.url as portal_url
     from v_users u
     join organizations o on o.org_id = u.org_id
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by coalesce(u.full_name, u.username) asc`,
    params,
  )
  res.json({ items: result.rows })
}))

const groupFilters: Record<string, string> = {
  attention: `(g.item_count = 0 or g.member_count = 1 or g.days_since_modified > ${staleGroupDays})`,
  empty: `g.item_count = 0`,
  single_member: `g.member_count = 1`,
  stale: `g.days_since_modified > ${staleGroupDays}`,
}

app.get('/api/groups', requireAuth, asyncRoute(async (req, res) => {
  const where: string[] = []
  const params: string[] = []
  const filter = groupFilters[String(req.query.status ?? '')]
  if (filter) where.push(filter)
  if (req.query.portal) {
    const org = await findOrg(req.query.portal)
    if (!org) {
      res.json({ items: [] })
      return
    }
    params.push(org.org_id)
    where.push(`g.org_id = $${params.length}`)
  }
  const result = await pool.query(
    `select
       (g.org_id::text || ':' || g.group_id) as id,
       g.org_id,
       g.group_id,
       g.title,
       g.access,
       g.owner as owner_username,
       g.member_count,
       g.item_count,
       g.modified_at,
       g.days_since_modified,
       o.url as portal_url
     from v_groups g
     join organizations o on o.org_id = g.org_id
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by g.title asc`,
    params,
  )
  res.json({ items: result.rows })
}))

app.get('/api/content', requireAuth, asyncRoute(async (req, res) => {
  const where: string[] = []
  const params: string[] = []
  const status = String(req.query.status ?? '')
  if (status === 'attention') {
    where.push(`(${Object.values(itemFilters).map((filter) => `coalesce(${filter}, false)`).join(' or ')})`)
  } else if (itemFilters[status]) {
    where.push(itemFilters[status])
  }
  if (req.query.portal) {
    const org = await findOrg(req.query.portal)
    if (!org) {
      res.json({ items: [] })
      return
    }
    params.push(org.org_id)
    where.push(`i.org_id = $${params.length}`)
  }
  const order = itemSorts[String(req.query.sort ?? '')] ?? itemSorts.title
  const result = await pool.query(
    `select
       (i.org_id::text || ':' || i.item_id) as id,
       i.org_id,
       i.item_id,
       i.title,
       i.type,
       i.owner_username,
       i.access,
       i.modified_at,
       i.views,
       i.size_bytes::float as size_bytes,
       i.completeness_score::float as completeness_score,
       i.usage_30d,
       i.share_count,
       i.dependency_count,
       i.referenced_count,
       i.is_empty,
       i.deprecated,
       i.owner_disabled,
       o.url as portal_url
     from v_items i
     join organizations o on o.org_id = i.org_id
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by ${order}`,
    params,
  )
  res.json({ items: result.rows })
}))

app.get('/api/content/dependencies', requireAuth, asyncRoute(async (req, res) => {
  const orgId = String(req.query.org ?? '')
  const itemId = String(req.query.item ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !itemId) {
    res.status(400).json({ error: 'org and item are required.' })
    return
  }
  const [item, check, uses, usedBy] = await Promise.all([
    pool.query(
      `select item_id, title, type, owner_username, is_empty from items where org_id = $1 and item_id = $2`,
      [orgId, itemId],
    ),
    pool.query(
      `select ok, error, checked_at from item_checks
       where org_id = $1 and item_id = $2 and check_name = 'dependencies'`,
      [orgId, itemId],
    ),
    pool.query(
      `select d.dependency_item_id as id, i.title, i.type, i.owner_username, i.is_empty,
              (i.item_id is not null) as in_org
       from item_dependencies d
       left join items i on i.org_id = d.org_id and i.item_id = d.dependency_item_id
       where d.org_id = $1 and d.item_id = $2
       order by i.title nulls last, d.dependency_item_id`,
      [orgId, itemId],
    ),
    pool.query(
      `select i.item_id as id, i.title, i.type, i.owner_username, i.is_empty, true as in_org
       from item_dependencies d
       join items i on i.org_id = d.org_id and i.item_id = d.item_id
       where d.org_id = $1 and d.dependency_item_id = $2
       order by i.title`,
      [orgId, itemId],
    ),
  ])
  if (!item.rows[0]) {
    res.status(404).json({ error: 'Item not found.' })
    return
  }
  res.json({ item: item.rows[0], check: check.rows[0] ?? null, uses: uses.rows, usedBy: usedBy.rows })
}))

app.get('/api/connections', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `select id, name, kind, portal_url, username, status, created_at
     from connections
     order by created_at desc`,
  )
  res.json({ items: result.rows })
}))

app.post('/api/connections', requireAuth, asyncRoute(async (req, res) => {
  const portalUrl = readPortalUrl(req.body?.url)
  const usernames = readUsernames(req.body)
  if (!portalUrl) {
    res.status(400).json({ error: 'Enter a valid http or https URL.' })
    return
  }
  if (usernames.length === 0) {
    res.status(400).json({ error: 'Enter a username.' })
    return
  }

  const existing = await pool.query<{ name: string; kind: string }>(
    `select name, kind from connections where portal_url = $1 limit 1`,
    [portalUrl],
  )
  const portal = existing.rows[0]
  const name = portal?.name ?? new URL(portalUrl).hostname
  const kind = portal?.kind ?? 'portal'

  for (const username of usernames) {
    const duplicate = await pool.query(
      `select id from connections where portal_url = $1 and lower(username) = lower($2)`,
      [portalUrl, username],
    )
    if (duplicate.rows[0]) {
      res.status(409).json({ error: `${username} is already on this portal.` })
      return
    }
  }

  const created = []
  for (const [index, username] of usernames.entries()) {
    try {
      const result = await pool.query(
        `insert into connections (name, kind, portal_url, username, status)
         values ($1, $2, $3, $4, 'saved')
         returning id, name, kind, portal_url, username, status, created_at`,
        [name, kind, portalUrl, username],
      )
      created.push(result.rows[0])
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: `${username} is already on this portal.` })
        return
      }
      throw error
    }

    const action = portal || index > 0 ? 'added a user' : 'added a connection'
    await pool.query(
      `insert into activity_events (actor, action, target) values ($1, $2, $3)`,
      [req.auth?.username ?? 'operator', action, `${username} · ${portalUrl}`],
    )
  }

  if (created[0]) {
    await ensureOrganization(portalUrl, name, created[0].id)
  }

  res.status(201).json({ items: created })
}))

app.post('/api/connections/:id/connect', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(404).json({ error: 'Connection not found.' })
    return
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!password) {
    res.status(400).json({ error: 'Enter a password.' })
    return
  }

  const found = await pool.query<{ id: string; name: string; portal_url: string; username: string }>(
    `select id, name, portal_url, username from connections where id = $1`,
    [id],
  )
  const row = found.rows[0]
  if (!row) {
    res.status(404).json({ error: 'Connection not found.' })
    return
  }
  if (!row.username) {
    res.status(400).json({ error: 'This connection has no username.' })
    return
  }

  try {
    await generatePortalToken(row.portal_url, row.username, password)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not connect.'
    res.status(502).json({ error: message })
    return
  }

  await pool.query(`update connections set status = 'connected' where id = $1`, [row.id])
  await pool.query(
    `insert into activity_events (actor, action, target) values ($1, 'connected', $2)`,
    [req.auth?.username ?? 'operator', row.portal_url],
  )

  // Connecting only signs in. The organization is collected the first time, or when asked to refresh.
  const collected = await pool.query(
    `select 1 from report_runs r join organizations o on o.org_id = r.org_id
     where o.url = $1 and r.status = 'succeeded' limit 1`,
    [row.portal_url],
  )
  const refresh = req.body?.refresh === true || collected.rowCount === 0
  if (!refresh) {
    res.json({ status: 'connected', runId: null })
    return
  }

  let runId: string | null = null
  try {
    runId = await startCollection({
      connectionId: row.id,
      connectionName: row.name,
      portalUrl: row.portal_url,
      username: row.username,
      password,
      actor: req.auth?.username ?? 'operator',
    })
  } catch (error) {
    console.error('Could not start collection', error)
  }
  res.json({ status: 'connected', runId })
}))

app.get('/api/jobs', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `select id, name, status, created_at
     from migration_jobs
     order by created_at desc`,
  )
  res.json({ items: result.rows })
}))

app.get('/api/activity', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `select id, actor, action, target, occurred_at
     from activity_events
     order by occurred_at desc
     limit 200`,
  )
  res.json({ items: result.rows })
}))

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  res.status(503).json({ error: 'Database is not ready.' })
})

app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`)
})

void prepareDatabase().then(recoverRuns).catch(console.error)
if (!env.authDisabled) {
  void prepareKeycloak()
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next)
  }
}

function readPortalUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function readUsername(value: unknown) {
  if (typeof value !== 'string') return null
  const username = value.trim()
  if (!username || username.length > 200) return null
  return username
}

function readUsernames(body: { username?: unknown; usernames?: unknown }) {
  const raw = Array.isArray(body?.usernames) ? body.usernames : [body?.username]
  const names: string[] = []
  for (const value of raw) {
    const username = readUsername(value)
    if (!username) continue
    if (names.some((name) => name.toLowerCase() === username.toLowerCase())) continue
    names.push(username)
  }
  return names
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function tokenEndpoint(portalUrl: string) {
  const url = new URL(portalUrl)
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/sharing\/rest\/generateToken$/i, '')
    .replace(/\/sharing\/rest$/i, '')
    .replace(/\/sharing$/i, '')
    .replace(/\/home$/i, '')
  url.pathname = `${path}/sharing/rest/generateToken`
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function generatePortalToken(portalUrl: string, username: string, password: string) {
  const body = new URLSearchParams({
    username,
    password,
    client: 'referer',
    referer: env.webOrigin,
    expiration: '60',
    f: 'json',
  })

  let response: globalThis.Response
  try {
    response = await fetch(tokenEndpoint(portalUrl), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Error('The portal did not respond.')
  }

  const json = (await response.json().catch(() => null)) as {
    token?: string
    error?: { message?: string; details?: string[] }
  } | null
  const detail = json?.error?.details?.filter(Boolean).join(' ')
  if (!response.ok || !json?.token) {
    throw new Error(detail || json?.error?.message || 'Could not connect to this portal.')
  }
}

async function count(table: string) {
  const allowed = new Set([
    'users',
    'groups',
    'items',
    'connections',
    'migration_jobs',
  ])
  if (!allowed.has(table)) {
    throw new Error(`Unknown table ${table}`)
  }
  const result = await pool.query<{ count: number }>(`select count(*)::int as count from ${table}`)
  return result.rows[0]?.count ?? 0
}
