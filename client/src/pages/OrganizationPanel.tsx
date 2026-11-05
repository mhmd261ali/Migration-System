import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '../api'
import { formatWhen } from '../format'
import type { ChangeRow, OrgSummary } from '../types'

const numbers = new Intl.NumberFormat()

export function OrganizationPanel({ portal, refresh }: { portal: string; refresh: number }) {
  const { data, error, loading, reload } = useApi<OrgSummary>(
    `/organizations/summary?portal=${encodeURIComponent(portal)}`,
  )
  const first = useRef(true)
  const running = data?.lastRun?.status === 'running'

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    reload()
  }, [refresh])

  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(reload, 4000)
    return () => window.clearTimeout(timer)
  }, [running, data])

  if (error) {
    return (
      <section className="mb-6 rounded-xl border border-line bg-card px-5 py-4">
        <p className="text-sm leading-relaxed text-danger">{error}</p>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="mb-6 rounded-xl border border-line bg-card px-5 py-4">
        <p className="text-sm text-muted">{loading ? 'Loading organization.' : ''}</p>
      </section>
    )
  }

  const org = data.organization
  const run = data.lastRun

  if (!org || !run) {
    return (
      <section className="mb-6 rounded-xl border border-line bg-card px-5 py-4">
        <p className="text-sm leading-relaxed text-muted">
          Nothing collected for this portal yet. Connect above to read the organization.
        </p>
      </section>
    )
  }

  const collected = run.status === 'succeeded' || Boolean(org.last_fetched_at)
  const limited = run.summary?.full_view === false
  const gaps = run.status === 'succeeded' ? run.error_details ?? [] : []
  const totals = data.totals
  const storage = data.storage

  return (
    <section className="mb-6 rounded-xl border border-line bg-card px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight text-ink">{org.name}</h2>
          <p className="mt-0.5 truncate font-mono text-[12px] text-muted">{org.url}</p>
          <p className="mt-1 text-xs text-muted">
            {[org.region, org.culture, org.portal_version && `Version ${org.portal_version}`, org.is_enterprise ? 'Enterprise' : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <RunStatus run={run} lastFetched={org.last_fetched_at} />
          <div className="flex gap-2">
            <Link
              to={`/reports?portal=${encodeURIComponent(portal)}`}
              className="rounded-lg border border-teal px-3 py-1.5 text-sm font-medium text-teal"
            >
              Reports
            </Link>
            <Link
              to={`/information?portal=${encodeURIComponent(portal)}`}
              className="rounded-lg bg-teal px-3 py-1.5 text-sm font-medium text-white"
            >
              View information
            </Link>
          </div>
        </div>
      </div>

      {limited && (
        <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-xs leading-relaxed text-muted">
          Read as {run.signed_in_username ?? 'a non-administrator'} ({run.signed_in_role ?? 'no admin role'}). Only
          groups and items shared with this account are counted.
        </p>
      )}

      {collected && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Members" value={count(data.members)} caption={seats(data.subscription?.max_members)} to="/users" />
            <Stat label="Groups" value={count(totals?.groups)} to="/groups" />
            <Stat label="Items" value={count(totals?.items)} caption={hosted(totals?.hosted_services)} to="/content" />
            <Stat label="Item views" value={count(totals?.views)} />
            <Stat label="Credits" value={count(data.credits, 2)} />
            <Stat
              label="Storage"
              value={bytes(storage?.used_bytes)}
              caption={storage?.quota_bytes ? `of ${bytes(storage.quota_bytes)}` : undefined}
            />
          </div>

          <div className="mt-4 grid gap-3">
            <List
              title="User types"
              to="/users"
              empty="Not readable with this account."
              rows={(data.userTypes ?? []).map((row) => ({
                name: row.name,
                value:
                  row.purchased_seats != null
                    ? `${count(row.assigned_count)} / ${count(row.purchased_seats)}`
                    : count(row.assigned_count),
              }))}
            />
            <List
              title="Roles"
              to="/users"
              empty="Not readable with this account."
              rows={(data.roles ?? []).slice(0, 4).map((row) => ({ name: row.name, value: count(row.member_count) }))}
            />
            <List
              title="Licenses"
              empty="Not readable with this account."
              rows={(data.licenses ?? []).map((row) => ({
                name: row.license_name,
                value: row.assigned_count != null ? count(row.assigned_count) : kindLabel(row.license_kind),
              }))}
            />
          </div>

          {data.health && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Findings
                title="Inactive users and disabled accounts"
                to={recordsLink('users', portal, 'attention')}
                empty={data.health.users === 0 ? 'Members not collected yet. Use Refresh data.' : undefined}
                rows={[
                  {
                    name: `Inactive (no login for ${data.health.inactive_days ?? 90} days)`,
                    value: data.health.inactive,
                    to: recordsLink('users', portal, 'inactive'),
                  },
                  { name: 'Never logged in', value: data.health.never_logged_in, to: recordsLink('users', portal, 'never_logged_in') },
                  { name: 'Disabled accounts', value: data.health.disabled, to: recordsLink('users', portal, 'disabled') },
                ]}
              />
              <Findings
                title="Empty, single-member, and stale groups"
                empty={totals?.groups === 0 ? 'No groups collected.' : undefined}
                to={recordsLink('groups', portal, 'attention')}
                rows={[
                  {
                    name: 'Empty (no items)',
                    value: data.health.empty_groups,
                    to: recordsLink('groups', portal, 'empty'),
                  },
                  {
                    name: 'Single member',
                    value: data.health.single_member_groups,
                    to: recordsLink('groups', portal, 'single_member'),
                  },
                  {
                    name: `Stale (not modified for ${data.health.stale_days} days)`,
                    value: data.health.stale_groups,
                    to: recordsLink('groups', portal, 'stale'),
                  },
                ]}
              />
              {data.itemHealth && (
                <Findings
                  className="md:col-span-2"
                  title="Content findings"
                  to={recordsLink('content', portal, 'attention')}
                  empty={data.itemHealth.items === 0 ? 'No items collected.' : undefined}
                  columns
                  rows={[
                    { name: 'Deprecated', value: data.itemHealth.deprecated, to: recordsLink('content', portal, 'deprecated') },
                    {
                      name: 'Never modified since creation',
                      value: data.itemHealth.never_modified,
                      to: recordsLink('content', portal, 'never_modified'),
                    },
                    {
                      name: 'Owned by disabled accounts',
                      value: data.itemHealth.owner_disabled,
                      to: recordsLink('content', portal, 'owner_disabled'),
                    },
                    { name: 'Empty items', value: data.itemHealth.empty, to: recordsLink('content', portal, 'empty') },
                    {
                      name: 'Using an empty item',
                      value: data.itemHealth.depends_on_empty,
                      to: recordsLink('content', portal, 'depends_on_empty'),
                    },
                    {
                      name: 'No usage in 30 days',
                      value: data.itemHealth.no_usage,
                      to: recordsLink('content', portal, 'no_usage'),
                    },
                  ]}
                  note={`Read so far: dependencies for ${count(data.itemHealth.dependencies_read)} of ${count(
                    data.itemHealth.items,
                  )} items, empty check for ${count(data.itemHealth.empty_read)} of ${count(
                    data.itemHealth.empty_checkable,
                  )}, usage for ${count(data.itemHealth.usage_read)} of ${count(
                    data.itemHealth.items,
                  )}. Each Refresh data reads more.`}
                />
              )}
            </div>
          )}

          {data.subscription && (
            <p className="mt-3 text-xs text-muted">
              Subscription: {[data.subscription.type, data.subscription.state].filter(Boolean).join(' · ') || '—'}
              {data.subscription.expires_at ? ` · expires ${formatWhen(data.subscription.expires_at)}` : ''}
            </p>
          )}

          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Recent changes</h3>
            {(data.changes ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                No changes detected yet. The first collection is the starting point; later connections record what
                changed.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {(data.changes ?? []).map((change) => (
                  <li key={change.id} className="flex items-baseline justify-between gap-4 py-2">
                    <span className="min-w-0 text-sm text-ink">{describeChange(change)}</span>
                    <span className="shrink-0 text-xs text-muted">{formatWhen(change.detected_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {gaps.length > 0 && (
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer">
                {gaps.length} {gaps.length === 1 ? 'section' : 'sections'} could not be read with this account
              </summary>
              <ul className="mt-2 space-y-1">
                {gaps.map((gap) => (
                  <li key={gap.section}>
                    <span className="font-mono">{gap.section}</span> · {gap.error.slice(0, 160)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}

function RunStatus({ run, lastFetched }: { run: NonNullable<OrgSummary['lastRun']>; lastFetched: string | null }) {
  if (run.status === 'running') {
    return <p className="text-xs font-medium text-teal">Collecting…</p>
  }
  if (run.status === 'failed') {
    const reason = run.error_details?.[0]?.error
    return (
      <div className="max-w-xs text-right">
        <p className="text-xs font-medium text-danger">Last collection failed · {formatWhen(run.finished_at)}</p>
        {reason && <p className="mt-0.5 truncate text-xs text-muted" title={reason}>{reason}</p>}
      </div>
    )
  }
  return <p className="text-xs text-muted">Collected {formatWhen(run.finished_at ?? lastFetched)}</p>
}

function Stat({ label, value, caption, to }: { label: string; value: string; caption?: string; to?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      {caption && <p className="mt-0.5 text-xs text-muted">{caption}</p>}
    </>
  )
  if (to) {
    return (
      <Link to={to} className="rounded-lg border border-line px-3 py-3 transition hover:border-teal">
        {body}
      </Link>
    )
  }
  return <div className="rounded-lg border border-line px-3 py-3">{body}</div>
}

function List({
  title,
  rows,
  empty,
  to,
}: {
  title: string
  rows: { name: string; value: string }[]
  empty: string
  to?: string
}) {
  const navigate = useNavigate()
  return (
    <div
      onClick={to ? () => navigate(to) : undefined}
      onKeyDown={to ? (event) => event.key === 'Enter' && navigate(to) : undefined}
      role={to ? 'link' : undefined}
      tabIndex={to ? 0 : undefined}
      className={`rounded-lg border border-line px-3 py-2 ${to ? 'cursor-pointer transition hover:border-teal' : ''}`}
    >
      <h3 className="pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto">
          {rows.map((row) => (
            <li key={row.name} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate text-ink" title={row.name}>{row.name}</span>
              <span className="shrink-0 pr-2 tabular-nums text-muted">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function recordsLink(page: 'users' | 'groups' | 'content', portal: string, status: string) {
  return `/${page}?portal=${encodeURIComponent(portal)}&status=${status}`
}

function Findings({
  title,
  to,
  rows,
  empty,
  note,
  columns,
  className = '',
}: {
  title: string
  to?: string
  rows: { name: string; value: number; to: string }[]
  empty?: string
  note?: string
  columns?: boolean
  className?: string
}) {
  const heading = 'pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted'
  return (
    <div className={`rounded-lg border border-line px-3 py-2 ${className}`}>
      {to ? (
        <h3 className={heading}>
          <Link to={to} className="hover:text-teal hover:underline">
            {title} →
          </Link>
        </h3>
      ) : (
        <h3 className={heading}>{title}</h3>
      )}
      {empty ? (
        <p className="py-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className={columns ? 'grid gap-x-6 md:grid-cols-2' : undefined}>
          {rows.map((row) => (
            <li key={row.name}>
              <Link
                to={row.to}
                className="flex items-baseline justify-between gap-3 rounded py-1.5 text-sm hover:text-teal"
              >
                <span className="min-w-0 truncate text-ink">{row.name}</span>
                <span className={`shrink-0 pr-2 tabular-nums ${row.value > 0 ? 'font-medium text-ink' : 'text-muted'}`}>
                  {numbers.format(row.value)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {note && !empty && <p className="pb-1 pt-1 text-xs text-muted">{note}</p>}
    </div>
  )
}

function count(value: number | null | undefined, digits = 0) {
  if (value == null) return '—'
  return numbers.format(Number(value.toFixed(digits)))
}

function seats(max: number | null | undefined) {
  return max ? `of ${numbers.format(max)} allowed` : undefined
}

function hosted(value: number | null | undefined) {
  return value ? `${numbers.format(value)} hosted services` : undefined
}

function bytes(value: number | null | undefined) {
  if (value == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function kindLabel(kind: string) {
  return kind === 'add_on' ? 'Add-on' : kind === 'bundle' ? 'Bundle' : 'App'
}

const entityNames: Record<string, string> = {
  organization: 'Organization',
  security_setting: 'Security setting',
  map_setting: 'Map setting',
  org_setting: 'Setting',
  subscription: 'Subscription',
  role: 'Role',
  user_type: 'User type',
  members: 'Members',
  invitation: 'Invitation',
  group: 'Group',
  item: 'Item',
  license_add_on: 'Add-on license',
  license_app: 'App license',
  license_bundle: 'License bundle',
}

function describeChange(change: ChangeRow) {
  const kind = entityNames[change.entity_type] ?? change.entity_type
  const name = change.label ?? change.entity_id
  if (change.action === 'created') return `${kind} added · ${name}`
  if (change.action === 'deleted') return `${kind} removed · ${name}`
  const field = change.field_name && change.field_name !== name ? ` ${change.field_name}` : ''
  return `${kind} ${name}${field}: ${short(change.old_value)} → ${short(change.new_value)}`
}

function short(value: unknown) {
  if (value == null) return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}
