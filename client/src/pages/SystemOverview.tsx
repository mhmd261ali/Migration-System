import { Link } from 'react-router-dom'
import { useSession } from '../auth/AuthProvider'
import { useApi } from '../api'
import { PageHeader, PanelMessage } from '../components/ui'
import { formatWhen } from '../format'
import type { OverviewResponse } from '../types'

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
