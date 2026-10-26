import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../auth/AuthProvider'
import { api, useApi } from '../api'
import { PageHeader, PanelMessage } from '../components/ui'
import { formatWhen } from '../format'
import type { ConnectionRow, ListResponse, OverviewResponse } from '../types'

const cards = [
  { key: 'users', label: 'Users', to: '/users', caption: 'People recorded' },
  { key: 'groups', label: 'Groups', to: '/groups', caption: 'Groups recorded' },
  { key: 'content', label: 'Content', to: '/content', caption: 'Items recorded' },
  { key: 'connections', label: 'Connections', to: '/connections', caption: 'Portals configured' },
] as const

export function SystemOverview() {
  const session = useSession()
  const { data, error, loading, reload } = useApi<OverviewResponse>('/overview')

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="System Overview"
        description="A reading of this console right now: the signed-in account, whether Postgres and Keycloak are reachable, and what has been recorded."
      />

      <ConnectionBar />

      {error && (
        <PanelMessage title="The overview could not be loaded." body={error} onRetry={reload} />
      )}

      {!error && (
      <>
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Recorded</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            to={card.to}
            className="rounded-xl border border-line bg-card px-4 py-4 transition hover:border-teal"
          >
            <p className="text-sm text-muted">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-ink">
              {loading || !data ? '…' : data.counts[card.key]}
            </p>
            <p className="mt-2 text-xs text-muted">{card.caption}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-xl border border-line bg-card px-5 py-2">
          <h2 className="pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Services</h2>
          <ServiceRow label="Signed in" value={session.name} />
          <ServiceRow label="Username" value={session.username} mono />
          <ServiceRow label="Roles" value={session.roles.length ? session.roles.join(', ') : 'None assigned'} />
          <ServiceRow
            label="Database"
            value={serviceLabel(data?.services.database, loading)}
            ok={readyDot(data?.services.database)}
          />
          <ServiceRow
            label="Identity"
            value={serviceLabel(data?.services.identity, loading)}
            ok={readyDot(data?.services.identity)}
          />
          <div className="flex items-center justify-between gap-4 py-3">
            <span className="text-sm text-muted">Migration jobs</span>
            <Link to="/jobs" className="text-sm font-medium text-teal">
              {loading || !data ? '…' : data.counts.jobs} recorded
            </Link>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-card px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Recent activity</h2>
            <Link to="/history" className="text-xs font-medium text-teal">
              History
            </Link>
          </div>
          {loading && <p className="mt-4 text-sm text-muted">Loading activity.</p>}
          {!loading && data && data.activity.length === 0 && (
            <p className="mt-4 text-sm leading-relaxed text-muted">
              No activity recorded yet. Actions taken in this console will be listed here.
            </p>
          )}
          {!loading && data && data.activity.length > 0 && (
            <ul className="mt-2 divide-y divide-line">
              {data.activity.map((event) => (
                <li key={event.id} className="py-3">
                  <p className="text-sm text-ink">
                    <span className="font-medium">{event.actor}</span> {event.action}
                    {event.target ? ` · ${event.target}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{formatWhen(event.occurred_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      </>
      )}
    </div>
  )
}

const portalStorageKey = 'migration.portal'

function ConnectionBar() {
  const query = useApi<ListResponse<ConnectionRow>>('/connections')
  const items = query.data?.items ?? []
  const portals = uniquePortals(items)
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem(portalStorageKey) ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [connectError, setConnectError] = useState<string>()
  const [attempt, setAttempt] = useState<'connected' | 'failed' | null>(null)
  const [success, setSuccess] = useState<{ portal: string; at: number }>()
  const selected = items.find((row) => row.id === selectedId) ?? items[0]
  const connected = attempt === 'connected' || (attempt !== 'failed' && selected?.status === 'connected')
  const portalUsers = selected
    ? items
        .filter((row) => row.portal_url === selected.portal_url)
        .slice()
        .sort((a, b) => a.username.localeCompare(b.username))
    : []

  useEffect(() => {
    const match = items.find((row) => row.id === selectedId)
    if (match) {
      localStorage.setItem(portalStorageKey, match.id)
      return
    }
    if (!query.loading && items[0] && selectedId !== items[0].id) {
      setSelectedId(items[0].id)
    }
  }, [items, query.loading, selectedId])

  useEffect(() => {
    setAttempt(null)
  }, [selected?.id])

  function choose(id: string) {
    setSelectedId(id)
    setPassword('')
    setConnectError(undefined)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setConnectError(undefined)
    try {
      await api(`/connections/${selected.id}/connect`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setPassword('')
      setAttempt('connected')
      setSuccess({ portal: selected.portal_url, at: Date.now() })
      query.reload()
    } catch (reason) {
      setAttempt('failed')
      setConnectError(reason instanceof Error ? reason.message : 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="relative mb-6 rounded-xl border border-line bg-card px-5 py-4 pr-12">
      <span
        className="absolute top-4 right-4 flex h-2.5 w-2.5"
        title={connected ? 'Connected' : 'Not connected'}
        aria-label={connected ? 'Connected' : 'Not connected'}
      >
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${connected ? 'bg-green-600' : 'bg-red-600'}`}
        />
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-600' : 'bg-red-600'}`} />
      </span>
      {success && (
        <SuccessNotice key={success.at} portal={success.portal} onClose={() => setSuccess(undefined)} />
      )}
      {query.loading && <p className="text-sm text-muted">Loading connection.</p>}
      {query.error && <p className="text-sm leading-relaxed text-danger">{query.error}</p>}
      {!query.loading && !query.error && items.length === 0 && (
        <p className="text-sm leading-relaxed text-muted">
          No connection yet.{' '}
          <Link to="/connections" className="font-medium text-teal">
            Add one
          </Link>
        </p>
      )}
      {selected && (
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-3 md:items-end">
          <label className="block min-w-0">
            <span className="text-sm text-muted">Portal</span>
            <select
              value={selected.portal_url}
              onChange={(event) => {
                const next = items.find((row) => row.portal_url === event.target.value)
                if (next) choose(next.id)
              }}
              className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
            >
              {portals.map((portal) => (
                <option key={portal} value={portal}>
                  {portal}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-sm text-muted">User</span>
            <select
              value={selected.id}
              onChange={(event) => choose(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
            >
              {portalUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username || '—'}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-sm text-muted">Password</span>
            <span className="mt-1.5 flex gap-2">
              <input
                required
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </span>
          </label>
        </form>
      )}
      {connectError && <p className="mt-3 text-sm leading-relaxed text-danger">{connectError}</p>}
    </section>
  )
}

function uniquePortals(items: ConnectionRow[]) {
  const urls: string[] = []
  for (const row of items) {
    if (!urls.includes(row.portal_url)) urls.push(row.portal_url)
  }
  return urls
}

function SuccessNotice({ portal, onClose }: { portal: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="fixed top-16 right-4 z-50 w-64 rounded-xl border border-teal/30 bg-card px-3.5 py-3 shadow-[0_10px_28px_rgba(23,33,30,0.14)] md:top-4"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Connection successful</p>
          <p className="mt-0.5 truncate font-mono text-[12px] text-muted" title={portal}>
            {portal}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="text-lg leading-none text-muted hover:text-ink"
        >
          ×
        </button>
      </div>
    </div>
  )
}

function ServiceRow({
  label,
  value,
  mono = false,
  ok,
}: {
  label: string
  value: string
  mono?: boolean
  ok?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`flex items-center gap-2 text-sm font-medium text-ink ${mono ? 'font-mono text-[13px]' : ''}`}>
        {ok !== undefined && (
          <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-teal' : 'bg-danger'}`} aria-hidden="true" />
        )}
        {value}
      </span>
    </div>
  )
}

function readyDot(value: string | undefined) {
  if (value === 'ok') return true
  if (value === 'down') return false
  return undefined
}

function serviceLabel(value: string | undefined, loading: boolean) {
  if (loading || !value) return 'Checking'
  if (value === 'ok') return 'Ready'
  if (value === 'starting') return 'Starting'
  return 'Not reachable'
}
