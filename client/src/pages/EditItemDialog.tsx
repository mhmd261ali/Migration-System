import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import type { ContentRow } from '../types'

type AccessLevel = 'private' | 'org' | 'public'
type EditAction = 'access' | 'update'
type EditOperation = {
  status: 'updated' | 'unchanged' | 'failed' | 'skipped'
  message: string
}
type LiveItem = {
  title: string
  snippet: string
  description: string
  tags: string[]
  access: string | null
  owner: string
}
type EditResponse = {
  needs_password?: boolean
  permissions?: { can_edit: boolean; can_reassign_owner: boolean }
  item?: LiveItem
  metadata?: EditOperation
  sharing?: EditOperation
  ownership?: EditOperation
  ok?: boolean
}
type EditResults = Pick<EditResponse, 'metadata' | 'sharing' | 'ownership'>

function accessLevel(value: string | null): AccessLevel {
  if (value?.toLowerCase() === 'public') return 'public'
  if (value?.toLowerCase() === 'org' || value?.toLowerCase() === 'organization') return 'org'
  return 'private'
}

function tagsForUpdate(value: string) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
}

function sameTags(left: string[], right: string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index])
}

export function EditItemDialog({ item, onClose }: { item: ContentRow; onClose: () => void }) {
  const [title, setTitle] = useState(item.title)
  const [summary, setSummary] = useState(item.snippet ?? '')
  const [tags, setTags] = useState(item.tags?.join(', ') ?? '')
  const [description, setDescription] = useState(item.description ?? '')
  const [access, setAccess] = useState<AccessLevel>(() => accessLevel(item.access))
  const [owner, setOwner] = useState(item.owner_username ?? '')
  const [permissions, setPermissions] = useState<EditResponse['permissions']>()
  const [original, setOriginal] = useState<LiveItem>()
  const [operations, setOperations] = useState<EditResults>()
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [passwordAction, setPasswordAction] = useState<EditAction>('access')

  async function run(action: EditAction, suppliedPassword?: string) {
    setBusy(true)
    setError(undefined)
    if (action === 'update') setOperations(undefined)
    try {
      const body: Record<string, unknown> = {
        action,
        portal_url: item.portal_url,
        item_id: item.item_id,
      }
      if (suppliedPassword) body.password = suppliedPassword
      if (action === 'update') {
        if (!original) {
          setError('The live ArcGIS item details are not loaded yet.')
          return
        }
        const metadata: { title?: string; snippet?: string; description?: string; tags?: string[] } = {}
        if (title !== original.title) metadata.title = title
        if (summary !== original.snippet) metadata.snippet = summary
        if (description !== original.description) metadata.description = description
        const nextTags = tagsForUpdate(tags)
        if (!sameTags(nextTags, original.tags)) metadata.tags = nextTags

        const changes: Record<string, unknown> = { metadata }
        if (access !== accessLevel(original.access)) changes.access = access
        if (permissions?.can_reassign_owner && owner.trim() !== original.owner.trim()) {
          changes.owner = owner
        }
        body.changes = changes
      }

      const response = await api<EditResponse>('/content/edit', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (response.needs_password) {
        if (action === 'update') {
          setOperations({
            metadata: response.metadata,
            sharing: response.sharing,
            ownership: response.ownership,
          })
        }
        setNeedsPassword(true)
        setPasswordAction(action)
        return
      }
      setNeedsPassword(false)
      setPassword('')
      if (action === 'access') {
        if (!response.permissions) {
          setError('ArcGIS did not return edit permissions.')
          return
        }
        setPermissions(response.permissions)
        if (!response.item) {
          setError('ArcGIS did not return the current item details.')
          return
        }
        setOriginal(response.item)
        setTitle(response.item.title)
        setSummary(response.item.snippet)
        setTags(response.item.tags.join(', '))
        setDescription(response.item.description)
        setAccess(accessLevel(response.item.access))
        setOwner(response.item.owner)
        return
      }
      if (response.ok) {
        closeDialog()
        return
      }
      const results = {
        metadata: response.metadata,
        sharing: response.sharing,
        ownership: response.ownership,
      }
      setOperations(results)
      if (!results.metadata || !results.sharing || !results.ownership) {
        setError('ArcGIS returned incomplete update results.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the ArcGIS item.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void run('access')
  }, [])

  function closeDialog() {
    if (closing) return
    setClosing(true)
    window.setTimeout(onClose, 150)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) {
      setError('Title cannot be empty.')
      return
    }
    if (needsPassword) {
      setError('Enter your ArcGIS password below before continuing.')
      return
    }
    void run('update')
  }

  function continueWithPassword() {
    if (!password) {
      setError('Enter your ArcGIS password.')
      return
    }
    const enteredPassword = password
    setPassword('')
    void run(passwordAction, enteredPassword)
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-12 transition-opacity duration-150 ease-out ${
        closing ? 'opacity-0' : 'dialog-backdrop-enter'
      }`}
      style={{ animationDuration: '140ms' }}
      onClick={closeDialog}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-item-title"
        className={`w-full max-w-lg rounded-xl border border-line bg-card px-5 py-4 shadow-xl transition-[opacity,transform] duration-150 ease-out ${
          closing ? 'translate-y-1 scale-[.98] opacity-0' : 'dialog-panel-enter'
        }`}
        style={{ animationDuration: '160ms' }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="edit-item-title" className="text-lg font-semibold text-ink">Edit item</h2>
        <p className="mt-1 truncate text-sm text-muted" title={title}>{title}</p>
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <section className="space-y-3 rounded-lg bg-paper p-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Item details</h3>
            <label className="block text-sm text-muted">
              Title
              <input
                type="text"
                required
                disabled={!original || busy}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-sm text-muted">
              Summary
              <input
                type="text"
                disabled={!original || busy}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-sm text-muted">
              Tags
              <input
                type="text"
                disabled={!original || busy}
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="tag one, tag two"
                className="mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-sm text-muted">
              Description
              <textarea
                rows={4}
                disabled={!original || busy}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1 block w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
              />
            </label>
          </section>

          <section className="space-y-3 rounded-lg bg-paper p-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Sharing</h3>
            <label className="block text-sm text-muted">
              Access level
              <select
                value={access}
                disabled={!original || busy}
                onChange={(event) => setAccess(accessLevel(event.target.value))}
                className="mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
              >
                <option value="private">Private</option>
                <option value="org">Organization</option>
                <option value="public">Public</option>
              </select>
            </label>
            {permissions?.can_reassign_owner && (
              <label className="block text-sm text-muted">
                Owner
                <input
                  type="text"
                  disabled={!original || busy}
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
                />
              </label>
            )}
          </section>

          {needsPassword && (
            <div className="space-y-2 rounded-lg border border-line bg-paper p-3">
              <label className="block text-sm text-muted">
                ArcGIS password required to continue
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
                />
              </label>
              <button
                type="button"
                onClick={continueWithPassword}
                disabled={busy}
                className="cursor-pointer rounded-lg border border-teal px-3 py-1.5 text-sm font-medium text-teal transition-colors hover:bg-teal hover:text-white disabled:opacity-60"
              >
                Continue
              </button>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {operations && (
            <section aria-live="polite" className="space-y-1 rounded-lg bg-paper p-3 text-sm">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Update results</h3>
              {([
                ['Metadata', operations.metadata],
                ['Sharing', operations.sharing],
                ['Ownership', operations.ownership],
              ] as const).map(([label, operation]) => {
                return operation ? (
                  <p key={label} className={operation.status === 'failed' ? 'text-danger' : 'text-ink'}>
                    <span className="font-medium">{label}:</span> {operation.message}
                  </p>
                ) : null
              })}
            </section>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || needsPassword || !original}
              className="cursor-pointer rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Working…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
