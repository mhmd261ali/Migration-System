export class ExpiredTokenError extends Error {}

export type LiveItem = {
  id: string
  title: string
  owner: string
  protected: boolean | null
}

export type DeleteLine = { id: string; title: string; reason?: string }

const DELETE_PRIVILEGE = 'portal:admin:deleteItems'

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

export function permissionReason(item: LiveItem | null, username: string, privileges: string[], otherDependents = false) {
  if (!item) return 'The item is unavailable.'
  const owner = item.owner.toLowerCase() === username.toLowerCase()
  if (!owner && !canAdminDelete(privileges)) return "You are not the owner of this item and don't have the administrative permissions required to delete it."
  if (item.protected === null) return 'Could not verify deletion protection.'
  if (item.protected) return 'Deletion protection is enabled. Edit the item to disable deletion protection.'
  if (otherDependents) return 'Other items depend on this item.'
  return null
}

export async function previewDependencies(input: {
  dependencyIds: string[]
  titles: Record<string, string>
  username: string
  privileges: string[]
  otherDependents: Record<string, boolean>
  load: (id: string) => Promise<LiveItem | null>
}) {
  const eligible: (DeleteLine & { eligible: true })[] = []
  const restricted: (DeleteLine & { eligible: false })[] = []
  for (const id of [...new Set(input.dependencyIds)]) {
    try {
      const item = await input.load(id)
      const reason = permissionReason(item, input.username, input.privileges, input.otherDependents[id])
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
  otherDependents: Record<string, boolean>
  usedBy: DeleteLine[]
  load: (id: string) => Promise<LiveItem | null>
  remove: (item: LiveItem) => Promise<string | null>
}) {
  const deleted: DeleteLine[] = []
  const skipped: DeleteLine[] = []
  const failed: DeleteLine[] = []
  let selected: LiveItem | null
  try {
    selected = await input.load(input.selectedId)
  } catch (error) {
    if (error instanceof ExpiredTokenError) throw error
    return { ok: false, message: errorMessage(error), deleted, skipped, failed: [{ id: input.selectedId, title: input.selectedTitle, reason: errorMessage(error) }], blocking: [] }
  }
  if (!selected) {
    const reason = 'The item is unavailable.'
    failed.push({ id: input.selectedId, title: input.selectedTitle, reason })
    return { ok: false, message: reason, deleted, skipped, failed, blocking: [] }
  }
  const selectedReason = permissionReason(selected, input.username, input.privileges)
  if (selectedReason) {
    failed.push({ id: input.selectedId, title: selected?.title || input.selectedTitle, reason: selectedReason })
    return { ok: false, message: selectedReason, deleted, skipped, failed, blocking: [] }
  }

  let selectedError: string | null
  try {
    selectedError = await input.remove(selected)
  } catch (error) {
    if (error instanceof ExpiredTokenError) throw error
    selectedError = errorMessage(error)
  }
  if (selectedError) {
    const blocking = isDependentBlock(selectedError) ? input.usedBy : []
    failed.push({ id: input.selectedId, title: selected.title || input.selectedTitle, reason: selectedError })
    return { ok: false, message: blocking.length ? 'Other items are blocking deletion. An administrator must resolve this first.' : selectedError, deleted, skipped, failed, blocking }
  }
  deleted.push({ id: input.selectedId, title: selected.title || input.selectedTitle })
  if (!input.includeDependencies) return { ok: true, message: 'The item was deleted.', deleted, skipped, failed, blocking: [] }

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
    const reason = permissionReason(dependency, input.username, input.privileges, input.otherDependents[id])
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
  const ok = failed.length === 0
  const message = authenticationRequired
    ? 'The selected item was deleted, but ArcGIS authentication expired before all approved dependencies could be processed. Verify the remaining items in ArcGIS Online.'
    : ok ? 'Deletion finished.' : 'Deletion finished with failures.'
  return { ok, message, deleted, skipped, failed, blocking: [] }
}

function isDependentBlock(message: string) {
  return /(depend|referenc|used by|in use|blocking)/i.test(message)
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
    username?: string
    privileges?: unknown[]
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
