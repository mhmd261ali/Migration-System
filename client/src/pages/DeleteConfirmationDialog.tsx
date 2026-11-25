import { type FormEvent, useEffect, useRef, useState } from 'react'
import { api, useApi } from '../api'
import type { ContentRow, DependencyItem, ItemDependencies } from '../types'

export type DeleteAccess = {
  item_id: string
  allowed: boolean
  protected: boolean | null
  reason: string | null
  can_view_notification_summary: boolean
}

type DeleteItem = { item_id: string; title: string; type: string | null }
type DeleteCandidate = { id: string; title: string; type?: string | null; reason?: string | null }
type DeleteNotification = {
  username: string | null
  email: string | null
  affected_items?: { item_id: string; title: string }[]
  status: 'sent' | 'failed' | 'skipped'
  reason?: string
}
type DeleteResult = {
  ok: boolean
  message: string
  deleted_items: DeleteItem[]
  skipped_items: (DeleteItem & { reason: string })[]
  failed_items: (DeleteItem & { reason: string })[]
  blocking_items: DeleteItem[]
  notification_summary?: { notifications?: DeleteNotification[] } | null
}

export function DeleteConfirmationDialog({
  item,
  onAccessChecked,
  onClose,
}: {
  item: ContentRow
  onAccessChecked: (orgId: string, access: DeleteAccess) => void
  onClose: () => void
}) {
  const dependencies = useApi<ItemDependencies>(
    `/content/dependencies?org=${encodeURIComponent(item.org_id)}&item=${encodeURIComponent(item.item_id)}`,
  )
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [pendingAction, setPendingAction] = useState<'access' | 'preview' | 'delete'>('access')
  const [access, setAccess] = useState<DeleteAccess>()
  const [includeDependencies, setIncludeDependencies] = useState<boolean>()
  const [plan, setPlan] = useState<{ eligible: DeleteCandidate[]; restricted: DeleteCandidate[] }>()
  const [result, setResult] = useState<DeleteResult>()
  const [processing, setProcessing] = useState<'access' | 'checking' | 'deleting'>()
  const [error, setError] = useState('')
  const processingRef = useRef(false)
  const busy = processing !== undefined
  const canProceed = access?.allowed === true
  const canViewNotificationSummary = access?.can_view_notification_summary === true
  const noDependencies = dependencies.data?.check?.ok === true && dependencies.data.uses.length === 0
  const dependencyChoiceMade = includeDependencies !== undefined || noDependencies

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function deleteRequest<T>(
    action: 'access' | 'preview' | 'delete',
    body: Record<string, unknown> = {},
  ): Promise<T | null> {
    const response = await api<T & { needs_password?: boolean }>('/content/delete', {
      method: 'POST',
      body: JSON.stringify({
        action,
        portal_url: item.portal_url,
        item_id: item.item_id,
        ...(password ? { password } : {}),
        ...body,
      }),
    })
    if (response.needs_password) {
      setPendingAction(action)
      setNeedsPassword(true)
      return null
    }
    setNeedsPassword(false)
    return response
  }

  async function checkAccess() {
    if (processingRef.current) return
    processingRef.current = true
    setProcessing('access')
    setError('')
    try {
      const response = await deleteRequest<{ org_id: string; access: DeleteAccess }>('access')
      if (!response) return
      setAccess(response.access)
      onAccessChecked(response.org_id, response.access)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not verify ArcGIS access.')
    } finally {
      processingRef.current = false
      setProcessing(undefined)
    }
  }

  useEffect(() => {
    void checkAccess()
  }, [item.item_id])

  async function chooseDependencies(include: boolean) {
    if (processingRef.current) return
    if (!include) {
      setIncludeDependencies(false)
      setError('')
      return
    }
    processingRef.current = true
    setProcessing('checking')
    setError('')
    try {
      const response = await deleteRequest<{ eligible: DeleteCandidate[]; restricted: DeleteCandidate[] }>('preview')
      if (response) {
        setPlan(response)
        setIncludeDependencies(true)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not check the dependencies.')
    } finally {
      processingRef.current = false
      setProcessing(undefined)
    }
  }

  async function confirmDeletion() {
    if (processingRef.current) return
    processingRef.current = true
    setProcessing('deleting')
    setError('')
    try {
      const response = await deleteRequest<DeleteResult>('delete', {
        include_dependencies: includeDependencies === true,
        eligible_dependency_ids: plan?.eligible.map((candidate) => candidate.id) ?? [],
        restricted: plan?.restricted ?? [],
      })
      if (response) {
        setResult(response)
      }
    } catch (reason) {
      setError(`Deletion was not confirmed. Check ArcGIS Online before retrying. ${
        reason instanceof Error ? reason.message : ''
      }`)
    } finally {
      processingRef.current = false
      setProcessing(undefined)
    }
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault()
    if (pendingAction === 'access') void checkAccess()
    else if (pendingAction === 'preview') void chooseDependencies(true)
    else void confirmDeletion()
  }

  return (
    <div
      className="dialog-backdrop-enter fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-12"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        key={needsPassword ? 'password' : result ? 'result' : dependencyChoiceMade ? 'final-confirmation' : 'dependency-choice'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirmation-title"
        aria-busy={busy}
        className="dialog-panel-enter w-full max-w-md rounded-xl border border-line bg-card px-5 py-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="delete-confirmation-title" className="text-lg font-semibold text-ink">
          {needsPassword
            ? 'ArcGIS password required'
            : !access
              ? 'Checking delete access'
              : !canProceed
                ? 'Delete is not available'
                : result
                  ? result.ok ? 'Deletion complete' : 'Deletion needs attention'
                  : dependencies.loading && !dependencyChoiceMade
                    ? 'Checking item dependencies'
                    : dependencyChoiceMade
                    ? includeDependencies
                      ? 'Are you sure you want to delete this item with its dependencies?'
                      : 'Are you sure you want to delete this item?'
                    : "Do you want to delete this item's dependencies as well?"}
        </h2>
        {busy && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
            {processing === 'access'
              ? 'Checking ArcGIS access…'
              : processing === 'checking'
                ? 'Checking dependency permissions…'
                : includeDependencies
                  ? canViewNotificationSummary
                    ? 'Processing deletion and notifications...'
                    : 'Deleting item and dependencies…'
                  : canViewNotificationSummary
                    ? 'Processing deletion and notifications...'
                    : 'Deleting item…'}
          </p>
        )}
        {needsPassword ? (
          <>
            <p className="mt-1 truncate text-sm text-muted" title={item.title}>{item.title}</p>
            <p className="mt-2 text-sm text-muted">
              Enter the password for the existing ArcGIS account. It is used only in memory to continue this operation.
            </p>
            <form id="delete-password-form" onSubmit={submitPassword} className="mt-3">
              <label className="block text-sm text-muted">
                ArcGIS password
                <input
                  type="password"
                  autoComplete="off"
                  autoFocus
                  required
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </label>
            </form>
            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          </>
        ) : !access ? (
          <p className="mt-1 truncate text-sm text-muted" title={item.title}>{item.title}</p>
        ) : !canProceed ? (
          <>
            <p className="mt-1 truncate text-sm text-muted" title={item.title}>{item.title}</p>
            <p role="alert" className="mt-3 text-sm text-danger">
              {access.reason ?? 'This ArcGIS account does not have permission to delete this item.'}
            </p>
          </>
        ) : result ? (
          <DeleteResultDetails result={result} />
        ) : !dependencyChoiceMade || !includeDependencies ? (
          <p className="mt-1 truncate text-sm text-muted" title={item.title}>{item.title}</p>
        ) : (
          <DeleteTargets
            itemTitle={item.title}
            eligible={plan?.eligible ?? []}
            restricted={plan?.restricted ?? []}
          />
        )}
        {(!access || canProceed) && !result && (!dependencyChoiceMade || noDependencies) && (
          <div className="mt-4 grid gap-3">
            <DeleteDependencySection
              title="Dependencies"
              rows={dependencies.data?.uses}
              loading={dependencies.loading}
              unavailable={Boolean(dependencies.error) || (!dependencies.loading && !dependencies.data?.uses)}
            />
            <DeleteDependencySection
              title="Affected items"
              rows={dependencies.data?.usedBy}
              loading={dependencies.loading}
              unavailable={Boolean(dependencies.error) || (!dependencies.loading && !dependencies.data?.usedBy)}
            />
          </div>
        )}
        {error && !needsPassword && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {!access || needsPassword ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
              >
                Cancel
              </button>
              {needsPassword && (
                <button
                  type="submit"
                  form="delete-password-form"
                  disabled={busy || !password}
                  className="cursor-pointer rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  Continue
                </button>
              )}
            </>
          ) : !canProceed || result ? (
            <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">
              Close
            </button>
          ) : dependencies.loading && !dependencyChoiceMade ? (
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
            >
              Cancel
            </button>
          ) : dependencyChoiceMade ? (
            <>
              {includeDependencies && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setIncludeDependencies(undefined)
                    setPlan(undefined)
                    setError('')
                  }}
                  className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmDeletion()}
                className="cursor-pointer rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Confirm
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void chooseDependencies(false)}
                className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
              >
                No
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void chooseDependencies(true)}
                className="cursor-pointer rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Yes
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DeleteTargets({
  itemTitle,
  eligible,
  restricted,
}: {
  itemTitle: string
  eligible: DeleteCandidate[]
  restricted: DeleteCandidate[]
}) {
  return (
    <section className="mt-3 rounded-lg bg-paper px-3 py-2">
      <p className="mb-2 truncate text-sm text-ink" title={itemTitle}>{itemTitle}</p>
      {eligible.length === 0 && restricted.length === 0 && (
        <p className="text-xs text-muted">No dependencies recorded.</p>
      )}
      {eligible.length > 0 && (
        <>
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Dependencies to delete</h3>
          <ul className="mt-1 max-h-40 divide-y divide-line overflow-y-auto">
            {eligible.map((row) => (
              <li key={row.id} className="space-y-0.5 py-2 text-xs">
                <p>Name: {row.title}</p>
                <p>Type: {row.type ?? '—'}</p>
                <p className="break-all font-mono text-[11px]">ID: {row.id}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {restricted.length > 0 && (
        <>
          <h3 className="mt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Restricted dependencies</h3>
          <ul className="mt-1 max-h-40 divide-y divide-line overflow-y-auto">
            {restricted.map((row) => (
              <li key={row.id} className="space-y-0.5 py-2 text-xs">
                <p>Name: {row.title}</p>
                <p>Type: {row.type ?? '—'}</p>
                <p className="break-all font-mono text-[11px]">ID: {row.id}</p>
                <p className="text-danger">{row.reason}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function DeleteResultDetails({ result }: { result: DeleteResult }) {
  function section(title: string, rows: (DeleteItem & { reason?: string })[]) {
    if (!rows.length) return null
    return (
      <section className="mt-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{title}</h3>
        <ul className="mt-1 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.item_id} className="py-2 text-xs">
              <p>{row.title}</p>
              {row.reason && <p className="mt-0.5 text-danger">{row.reason}</p>}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <div className="mt-2">
      <p className="text-sm text-muted">{result.message}</p>
      {section('Deleted', result.deleted_items)}
      {section('Skipped', result.skipped_items)}
      {section('Failed', result.failed_items)}
      {section('Blocking items', result.blocking_items)}
      {result.notification_summary != null && (
        <NotificationSummary notifications={result.notification_summary.notifications ?? []} />
      )}
    </div>
  )
}

function NotificationSummary({ notifications }: { notifications: DeleteNotification[] }) {
  const sentCount = notifications.filter((notification) => notification.status === 'sent').length

  return (
    <section className="mt-4 rounded-lg border border-line bg-paper px-3 py-3">
      <h3 className="text-sm font-medium text-ink">Email notification summary</h3>
      {sentCount > 0 && (
        <p className="mt-2 text-sm font-medium text-teal">Emails sent: {sentCount}</p>
      )}
      {notifications.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No notification results were returned.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {notifications.map((notification, index) => {
            const affectedItems = notification.affected_items ?? []
            return (
              <li
                key={`${notification.username ?? notification.status}-${index}`}
                className="py-2 text-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-all text-ink">
                    {notification.username ?? 'Unknown user'}
                    <span className="text-muted"> · {notification.email ?? 'No email address'}</span>
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                      notification.status === 'sent'
                        ? 'bg-teal/10 text-teal'
                        : notification.status === 'failed'
                          ? 'bg-danger/10 text-danger'
                          : 'bg-line text-muted'
                    }`}
                  >
                    {notification.status}
                  </span>
                </div>
                {affectedItems.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                    {affectedItems.map((affected) => (
                      <li key={affected.item_id}>
                        {affected.title} <span className="font-mono text-[11px]">({affected.item_id})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-muted">No affected items listed.</p>
                )}
                {notification.reason && (
                  <p className={`mt-1 ${notification.status === 'failed' ? 'text-danger' : 'text-muted'}`}>
                    {notification.reason}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function DeleteDependencySection({
  title,
  rows,
  loading,
  unavailable,
}: {
  title: string
  rows: DependencyItem[] | undefined
  loading: boolean
  unavailable: boolean
}) {
  return (
    <section className="min-w-0 rounded-lg bg-paper px-3 py-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{title}</h3>
      {loading ? (
        <p className="mt-1 text-xs text-muted">Loading dependency information…</p>
      ) : unavailable ? (
        <p className="mt-1 text-xs text-danger">Dependency information unavailable.</p>
      ) : rows?.length ? (
        <ul className="mt-1 max-h-32 divide-y divide-line overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="space-y-0.5 py-2 text-xs">
              <p className="flex items-start gap-2">
                <span className="shrink-0 text-muted">Name</span>
                <span className="min-w-0 break-words text-ink">{row.title ?? '—'}</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="shrink-0 text-muted">Type</span>
                <span className="min-w-0 break-words text-ink">{row.type ?? '—'}</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="shrink-0 text-muted">ID</span>
                <span className="min-w-0 break-all font-mono text-[11px] text-ink">{row.id}</span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted">No items recorded.</p>
      )}
    </section>
  )
}
