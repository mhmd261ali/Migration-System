export class ExpiredTokenError extends Error {}

export type LiveItem = {
  id: string
  title: string
  owner: string
  protected: boolean | null
  snippet: string
  description: string
  access: string | null
  tags: string[]
  type: string
}

export type DeleteLine = { id: string; title: string; reason?: string }
export type ItemAccess = 'private' | 'org' | 'public'
export type EditItemChanges = {
  metadata: Partial<{ title: string; snippet: string; description: string; tags: string[] }>
  access?: ItemAccess
  owner?: string
}
export type EditOperation = {
  status: 'updated' | 'unchanged' | 'failed' | 'skipped'
  message: string
}
export type EditItemResult = {
  ok: boolean
  needs_password?: boolean
  metadata: EditOperation
  sharing: EditOperation
  ownership: EditOperation
}

const DELETE_PRIVILEGE = 'portal:admin:deleteItems'
const UPDATE_ITEMS_PRIVILEGE = 'portal:admin:updateItems'
const REASSIGN_ITEMS_PRIVILEGE = 'portal:admin:reassignItems'
const SHARE_TO_ORG_PRIVILEGE = 'portal:user:shareToOrg'
const SHARE_TO_PUBLIC_PRIVILEGE = 'portal:user:shareToPublic'
const ADMIN_SHARE_TO_ORG_PRIVILEGE = 'portal:admin:shareToOrg'
const ADMIN_SHARE_TO_PUBLIC_PRIVILEGE = 'portal:admin:shareToPublic'

export function sharingRest(portalUrl: string) {
  const url = new URL(portalUrl)
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/sharing\/rest\/generateToken$/i, '')
    .replace(/\/sharing\/rest$/i, '')
    .replace(/\/sharing$/i, '')
    .replace(/\/home$/i, '')
  return `${url.origin}${path}/sharing/rest`
}

export function canAdminDelete(privileges: string[]) {
  return privileges.includes(DELETE_PRIVILEGE)
}

export async function getPortalUser(portalUrl: string, token: string, referer: string) {
  const json = await portalJson(
    `${sharingRest(portalUrl)}/community/self?f=json&token=${encodeURIComponent(token)}`,
    { headers: { Referer: referer } },
  )
  if (json.error) {
    if (isExpiredToken(json.error.code)) throw new ExpiredTokenError(json.error.message)
    throw new Error(json.error.message || 'Could not verify the ArcGIS account.')
  }
  if (typeof json.username !== 'string') throw new Error('Could not verify the ArcGIS account.')
  return {
    username: json.username,
    privileges: Array.isArray(json.privileges)
      ? json.privileges.filter((value): value is string => typeof value === 'string')
      : [],
  }
}

export async function getLiveItem(portalUrl: string, token: string, referer: string, itemId: string): Promise<LiveItem | null> {
  const json = await portalJson(
    `${sharingRest(portalUrl)}/content/items/${encodeURIComponent(itemId)}?f=json&token=${encodeURIComponent(token)}`,
    { headers: { Referer: referer } },
  )
  if (json?.error) {
    if (isExpiredToken(json.error.code)) throw new ExpiredTokenError(json.error.message)
    if (json.error.code === 400 || json.error.code === 404) return null
    throw new Error(json.error.message || 'Could not retrieve the ArcGIS item.')
  }
  if (!json?.id) return null
  return {
    id: String(json.id),
    title: typeof json.title === 'string' ? json.title : itemId,
    owner: typeof json.owner === 'string' ? json.owner : '',
    protected: typeof json.protected === 'boolean' ? json.protected : null,
    snippet: typeof json.snippet === 'string' ? json.snippet : '',
    description: typeof json.description === 'string' ? json.description : '',
    access: typeof json.access === 'string' ? json.access : null,
    tags: Array.isArray(json.tags) ? json.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    type: typeof json.type === 'string' ? json.type : '',
  }
}

export function getItemEditPermissions(item: LiveItem, user: Awaited<ReturnType<typeof getPortalUser>>) {
  const isOwner = item.owner.toLowerCase() === user.username.toLowerCase()
  return {
    can_edit: isOwner || user.privileges.includes(UPDATE_ITEMS_PRIVILEGE),
    can_reassign_owner: user.privileges.includes(REASSIGN_ITEMS_PRIVILEGE),
  }
}

export async function updateLiveItem(
  portalUrl: string,
  token: string,
  referer: string,
  item: LiveItem,
  user: Awaited<ReturnType<typeof getPortalUser>>,
  changes: EditItemChanges,
): Promise<EditItemResult> {
  const permissions = getItemEditPermissions(item, user)
  let tokenExpired = false
  const unchanged = (message: string): EditOperation => ({ status: 'unchanged', message })
  const failed = (message: string): EditOperation => ({ status: 'failed', message })
  const skipped = (): EditOperation => ({
    status: 'skipped',
    message: 'Not attempted because the ArcGIS token expired during this update.',
  })
  const attempt = async (operation: () => Promise<string | void>): Promise<EditOperation> => {
    if (tokenExpired) return skipped()
    try {
      const message = await operation()
      return { status: 'updated', message: message || 'Updated successfully.' }
    } catch (error) {
      if (error instanceof ExpiredTokenError) {
        tokenExpired = true
        return failed('ArcGIS token expired; enter the password to continue.')
      }
      return failed(errorMessage(error))
    }
  }

  const metadata: Partial<{ title: string; snippet: string; description: string; tags: string[] }> = {}
  const requested = changes.metadata
  if (requested.title !== undefined && !requested.title.trim()) {
    metadata.title = ''
  } else if (requested.title !== undefined && requested.title.trim() !== item.title) {
    metadata.title = requested.title.trim()
  }
  if (requested.snippet !== undefined && requested.snippet !== item.snippet) metadata.snippet = requested.snippet
  if (requested.description !== undefined && requested.description !== item.description) {
    metadata.description = requested.description
  }
  if (requested.tags !== undefined && !sameTags(requested.tags, item.tags)) metadata.tags = requested.tags

  let metadataResult = unchanged('No metadata changes.')
  if (Object.keys(metadata).length > 0) {
    if (metadata.title === '') {
      metadataResult = failed('Title cannot be empty.')
    } else if (!permissions.can_edit) {
      metadataResult = failed('This ArcGIS account cannot update this item.')
    } else {
      metadataResult = await attempt(async () => {
        const body = new URLSearchParams({ f: 'json', token })
        if (metadata.title !== undefined) body.set('title', metadata.title)
        if (metadata.snippet !== undefined) body.set('snippet', metadata.snippet)
        if (metadata.description !== undefined) body.set('description', metadata.description)
        if (metadata.tags !== undefined) body.set('tags', metadata.tags.join(','))
        const json = await portalJson(
          `${sharingRest(portalUrl)}/content/users/${encodeURIComponent(item.owner)}/items/${encodeURIComponent(item.id)}/update`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer }, body },
        )
        assertPortalSuccess(json)
        return `Updated ${Object.keys(metadata).join(', ')}.`
      })
    }
  }

  const targetAccess = changes.access
  const currentAccess = normalizeAccess(item.access)
  let sharingResult = unchanged('Access level was not changed.')
  if (targetAccess !== undefined && targetAccess !== currentAccess) {
    const isOwner = item.owner.toLowerCase() === user.username.toLowerCase()
    const requiredPrivileges = new Set<string>()
    if (targetAccess === 'public' || currentAccess === 'public') {
      requiredPrivileges.add(isOwner ? SHARE_TO_PUBLIC_PRIVILEGE : ADMIN_SHARE_TO_PUBLIC_PRIVILEGE)
    }
    if (targetAccess === 'org' || currentAccess === 'org') {
      requiredPrivileges.add(isOwner ? SHARE_TO_ORG_PRIVILEGE : ADMIN_SHARE_TO_ORG_PRIVILEGE)
    }
    const missingPrivilege = [...requiredPrivileges].find((privilege) => !user.privileges.includes(privilege))
    if (missingPrivilege) {
      sharingResult = failed(
        missingPrivilege.endsWith('shareToPublic')
          ? 'This ArcGIS account cannot change public sharing.'
          : 'This ArcGIS account cannot change organization sharing.',
      )
    } else {
      sharingResult = await attempt(async () => {
        const body = new URLSearchParams({
          f: 'json',
          token,
          everyone: String(targetAccess === 'public'),
          org: String(targetAccess === 'org'),
        })
        if (targetAccess === 'private') body.set('groups', '')
        const json = await portalJson(
          `${sharingRest(portalUrl)}/content/users/${encodeURIComponent(item.owner)}/items/${encodeURIComponent(item.id)}/share`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer }, body },
        )
        assertPortalSuccess(json)
        if (json.notSharedWith?.length) throw new Error('ArcGIS could not apply the sharing update to all groups.')
        return `Access changed to ${targetAccess}.`
      })
    }
  }

  let ownershipResult = unchanged('Owner was not changed.')
  const targetOwner = changes.owner?.trim()
  if (targetOwner !== undefined && targetOwner.toLowerCase() !== item.owner.toLowerCase()) {
    if (!targetOwner) {
      ownershipResult = failed('Owner cannot be empty.')
    } else if (!user.privileges.includes(REASSIGN_ITEMS_PRIVILEGE)) {
      ownershipResult = failed('This ArcGIS account lacks the portal:admin:reassignItems privilege.')
    } else {
      ownershipResult = await attempt(async () => {
        const body = new URLSearchParams({
          f: 'json',
          token,
          targetUsername: targetOwner,
          targetFolderName: '/',
        })
        const json = await portalJson(
          `${sharingRest(portalUrl)}/content/users/${encodeURIComponent(item.owner)}/items/${encodeURIComponent(item.id)}/reassign`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer }, body },
        )
        assertPortalSuccess(json)
        return `Owner reassigned to ${targetOwner}.`
      })
    }
  }

  const results = [metadataResult, sharingResult, ownershipResult]
  return {
    ok: results.every((result) => result.status === 'updated' || result.status === 'unchanged'),
    ...(tokenExpired ? { needs_password: true } : {}),
    metadata: metadataResult,
    sharing: sharingResult,
    ownership: ownershipResult,
  }
}

function sameTags(left: string[], right: string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index])
}

function normalizeAccess(value: string | null): ItemAccess {
  if (value?.toLowerCase() === 'public') return 'public'
  if (value?.toLowerCase() === 'org') return 'org'
  return 'private'
}

function assertPortalSuccess(json: Awaited<ReturnType<typeof portalJson>>) {
  if (json.error) {
    if (isExpiredToken(json.error.code)) throw new ExpiredTokenError(json.error.message)
    throw new Error(json.error.message || json.error.details?.filter((detail): detail is string => typeof detail === 'string').join(' ') || 'ArcGIS did not confirm the update.')
  }
  if (json.success === false || (json.success !== true && typeof json.itemId !== 'string')) {
    throw new Error('ArcGIS did not confirm the update.')
  }
}

export async function deleteLiveItem(portalUrl: string, token: string, referer: string, item: LiveItem) {
  const json = await portalJson(
    `${sharingRest(portalUrl)}/content/users/${encodeURIComponent(item.owner)}/items/${encodeURIComponent(item.id)}/delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer },
      body: new URLSearchParams({ f: 'json', token }),
    },
  )
  if (json?.error && isExpiredToken(json.error.code)) throw new ExpiredTokenError(json.error.message)
  if (json?.success === true) return null
  return json?.error?.details?.filter(Boolean).join(' ') || json?.error?.message || 'ArcGIS did not confirm deletion.'
}

export function permissionReason(item: LiveItem | null, username: string, privileges: string[]) {
  if (!item) return 'The item is unavailable.'
  const owner = item.owner.toLowerCase() === username.toLowerCase()
  if (!owner && !canAdminDelete(privileges)) return "You are not the owner of this item and don't have the administrative permissions required to delete it."
  return null
}

export async function previewDependencies(input: {
  dependencyIds: string[]
  titles: Record<string, string>
  username: string
  privileges: string[]
  load: (id: string) => Promise<LiveItem | null>
}) {
  const eligible: (DeleteLine & { eligible: true })[] = []
  const restricted: (DeleteLine & { eligible: false })[] = []
  for (const id of [...new Set(input.dependencyIds)]) {
    try {
      const item = await input.load(id)
      const reason = permissionReason(item, input.username, input.privileges)
      const line = { id, title: item?.title || input.titles[id] || id }
      if (reason) restricted.push({ ...line, reason, eligible: false })
      else eligible.push({ ...line, eligible: true })
    } catch (error) {
      if (error instanceof ExpiredTokenError) throw error
      restricted.push({
        id,
        title: input.titles[id] || id,
        reason: error instanceof Error ? error.message : 'Could not check this item.',
        eligible: false,
      })
    }
  }
  return { eligible, restricted }
}

export async function runDeletion(input: {
  selectedId: string
  selectedTitle: string
  includeDependencies: boolean
  eligibleDependencyIds: string[]
  restrictedReasons: Record<string, string>
  username: string
  privileges: string[]
  dependencyIds: string[]
  titles: Record<string, string>
  load: (id: string) => Promise<LiveItem | null>
  remove: (item: LiveItem) => Promise<string | null>
}) {
  const deleted: DeleteLine[] = []
  const skipped: DeleteLine[] = []
  const failed: DeleteLine[] = []
  const blocking: DeleteLine[] = []
  let selected: LiveItem | null
  try {
    selected = await input.load(input.selectedId)
  } catch (error) {
    if (error instanceof ExpiredTokenError) throw error
    return { ok: false, message: errorMessage(error), deleted, skipped, failed: [{ id: input.selectedId, title: input.selectedTitle, reason: errorMessage(error) }], blocking }
  }
  if (!selected) {
    const reason = 'The item is unavailable.'
    failed.push({ id: input.selectedId, title: input.selectedTitle, reason })
    return { ok: false, message: reason, deleted, skipped, failed, blocking }
  }
  const selectedReason = permissionReason(selected, input.username, input.privileges)
  if (selectedReason) {
    failed.push({ id: input.selectedId, title: selected?.title || input.selectedTitle, reason: selectedReason })
    return { ok: false, message: selectedReason, deleted, skipped, failed, blocking }
  }

  let selectedError: string | null
  try {
    selectedError = await input.remove(selected)
  } catch (error) {
    if (error instanceof ExpiredTokenError) throw error
    selectedError = errorMessage(error)
  }
  if (selectedError) {
    failed.push({ id: input.selectedId, title: selected.title || input.selectedTitle, reason: selectedError })
    return { ok: false, message: selectedError, deleted, skipped, failed, blocking }
  }
  deleted.push({ id: input.selectedId, title: selected.title || input.selectedTitle })
  if (!input.includeDependencies) return { ok: true, message: 'The item was deleted.', deleted, skipped, failed, blocking }

  const approved = new Set(input.eligibleDependencyIds)
  let authenticationRequired = false
  for (const id of [...new Set(input.dependencyIds)]) {
    if (!approved.has(id)) {
      skipped.push({ id, title: input.titles[id] || id, reason: input.restrictedReasons[id] || 'Not approved for deletion.' })
      continue
    }
    if (authenticationRequired) {
      failed.push({ id, title: input.titles[id] || id, reason: 'ArcGIS authentication expired; this dependency was not attempted.' })
      continue
    }
    let dependency: LiveItem | null
    try {
      dependency = await input.load(id)
    } catch (error) {
      if (error instanceof ExpiredTokenError) {
        authenticationRequired = true
        failed.push({ id, title: input.titles[id] || id, reason: 'ArcGIS authentication expired; this dependency was not checked or deleted.' })
        continue
      }
      failed.push({ id, title: input.titles[id] || id, reason: errorMessage(error) })
      continue
    }
    if (!dependency) {
      failed.push({ id, title: input.titles[id] || id, reason: 'The item is unavailable.' })
      continue
    }
    const reason = permissionReason(dependency, input.username, input.privileges)
    if (reason) {
      skipped.push({ id, title: dependency?.title || input.titles[id] || id, reason })
      continue
    }
    try {
      const deleteError = await input.remove(dependency)
      if (deleteError) failed.push({ id, title: dependency.title, reason: deleteError })
      else deleted.push({ id, title: dependency.title })
    } catch (error) {
      if (error instanceof ExpiredTokenError) {
        authenticationRequired = true
        failed.push({ id, title: dependency.title, reason: 'ArcGIS authentication expired; deletion was not confirmed.' })
        continue
      }
      failed.push({ id, title: dependency.title, reason: errorMessage(error) })
    }
  }
  const ok = failed.length === 0 && skipped.length === 0
  const message = authenticationRequired
    ? 'The selected item was deleted, but ArcGIS authentication expired before all approved dependencies could be processed. Verify the remaining items in ArcGIS Online.'
    : ok ? 'Deletion finished.' : skipped.length && failed.length
      ? 'Deletion finished with failures and skipped items.'
      : skipped.length
        ? 'Deletion finished with skipped items.'
        : 'Deletion finished with failures.'
  return { ok, message, deleted, skipped, failed, blocking }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'ArcGIS deletion failed.'
}

function isExpiredToken(code: unknown) {
  return code === 498 || code === 499
}

async function portalJson(url: string, init?: RequestInit) {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('The portal did not respond.')
  }
  const json = await response.json().catch(() => {
    throw new Error('The portal returned an invalid response.')
  }) as {
    id?: string
    title?: string
    owner?: string
    protected?: boolean
    type?: string
    username?: string
    privileges?: unknown[]
    snippet?: string
    description?: string
    access?: string
    tags?: unknown[]
    itemId?: string
    notSharedWith?: string[]
    token?: string
    expires?: number
    success?: boolean
    error?: { code?: number; message?: string; details?: string[] }
  }
  if (!response.ok) {
    if (json.error && isExpiredToken(json.error.code)) throw new ExpiredTokenError(json.error.message)
    const details = json.error?.details?.filter(Boolean).join(' ')
    throw new Error(details || json.error?.message || `The portal returned HTTP ${response.status}.`)
  }
  return json
}
