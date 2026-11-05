import { type FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { StatusPill } from '../components/ui'
import { blank, formatWhen } from '../format'
import type { ActivityRow, ConnectionRow, ContentRow, GroupRow, JobRow, UserRow } from '../types'
import { DependencyDialog } from './DependencyDialog'
import { RecordPage } from './RecordPage'

const userFilters = [
  { status: '', label: 'All users' },
  { status: 'attention', label: 'Inactive or disabled' },
  { status: 'inactive', label: 'Inactive' },
  { status: 'never_logged_in', label: 'Never logged in' },
  { status: 'disabled', label: 'Disabled' },
]

const groupFilters = [
  { status: '', label: 'All groups' },
  { status: 'attention', label: 'Empty, single-member, or stale' },
  { status: 'empty', label: 'Empty' },
  { status: 'single_member', label: 'Single member' },
  { status: 'stale', label: 'Stale (over 365 days)' },
]

const contentFilters = [
  { status: '', label: 'All items' },
  { status: 'attention', label: 'Needs attention' },
  { status: 'deprecated', label: 'Deprecated' },
  { status: 'never_modified', label: 'Never modified' },
  { status: 'owner_disabled', label: 'Owner disabled' },
  { status: 'empty', label: 'Empty' },
  { status: 'depends_on_empty', label: 'Uses an empty item' },
  { status: 'no_usage', label: 'No usage (30 days)' },
]

const contentSorts = [
  { status: '', label: 'Title' },
  { status: 'views', label: 'Most viewed' },
  { status: 'oldest', label: 'Not modified longest' },
  { status: 'largest', label: 'Largest' },
  { status: 'most_used', label: 'Most used (30 days)' },
  { status: 'least_used', label: 'Least used (30 days)' },
  { status: 'dependencies', label: 'Most dependencies' },
  { status: 'referenced', label: 'Most referenced' },
  { status: 'shares', label: 'Most group shares' },
  { status: 'score_high', label: 'Highest metadata score' },
  { status: 'score_low', label: 'Lowest metadata score' },
]

type Filter = { status: string; label: string }

function useFilter(path: string, filters: Filter[], sorts?: Filter[]) {
  const [params, setParams] = useSearchParams()
  const portal = params.get('portal') ?? ''
  const active = filters.find((filter) => filter.status === (params.get('status') ?? '')) ?? filters[0]
  const sort = sorts?.find((option) => option.status === (params.get('sort') ?? '')) ?? sorts?.[0]
  const query = new URLSearchParams()
  if (active.status) query.set('status', active.status)
  if (sort?.status) query.set('sort', sort.status)
  if (portal) query.set('portal', portal)
  const search = query.toString()

  function choose(next: string, key = 'status') {
    const updated = new URLSearchParams(params)
    if (next) updated.set(key, next)
    else updated.delete(key)
    setParams(updated, { replace: true })
  }

  const bar = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <button
          key={filter.status || 'all'}
          type="button"
          onClick={() => choose(filter.status)}
          aria-pressed={filter.status === active.status}
          className={`rounded-full border px-3 py-1 text-sm transition ${
            filter.status === active.status
              ? 'border-teal bg-teal text-white'
              : 'border-line text-muted hover:border-teal hover:text-ink'
          }`}
        >
          {filter.label}
        </button>
      ))}
      {sorts && (
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          Sort by
          <select
            value={sort?.status ?? ''}
            onChange={(event) => choose(event.target.value, 'sort')}
            className="rounded-lg border border-line bg-paper px-2 py-1 text-sm text-ink"
          >
            {sorts.map((option) => (
              <option key={option.status || 'default'} value={option.status}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {portal && (
        <span className={`${sorts ? 'w-full text-right' : 'ml-auto'} font-mono text-xs text-muted`}>{portal}</span>
      )}
    </div>
  )

  return { active, path: search ? `${path}?${search}` : path, bar }
}

export function UsersOverview() {
  const { active, path, bar } = useFilter('/users', userFilters)
  return (
    <RecordPage<UserRow>
      title={active.status ? `Users Overview · ${active.label}` : 'Users Overview'}
      description="Accounts this console knows about. They show up here after a connection is read."
      path={path}
      singular="user"
      plural="users"
      empty={active.status ? 'No users match this filter.' : 'No users recorded yet.'}
      banner={() => bar}
      columns={[
        { header: 'Name', width: 'w-[20%]', cell: (row) => row.full_name, text: (row) => row.full_name },
        {
          header: 'Username',
          width: 'w-[16%]',
          cell: (row) => <span className="font-mono text-[13px]">{row.username}</span>,
          text: (row) => row.username,
        },
        { header: 'User type', width: 'w-[14%]', cell: (row) => blank(row.user_type), text: (row) => blank(row.user_type) },
        { header: 'Role', width: 'w-[14%]', cell: (row) => blank(row.role_name), text: (row) => blank(row.role_name) },
        { header: 'Last login', width: 'w-[13%]', cell: (row) => formatWhen(row.last_login_at) },
        { header: 'Activity', width: 'w-[10%]', cell: (row) => activityLabel(row.activity_status) },
        { header: 'Items', width: 'w-[6%]', cell: (row) => row.items_owned },
        { header: 'Status', width: 'w-[7%]', cell: (row) => <StatusPill value={row.disabled ? 'disabled' : 'active'} /> },
      ]}
    />
  )
}

export function GroupsOverview() {
  const { active, path, bar } = useFilter('/groups', groupFilters)
  return (
    <RecordPage<GroupRow>
      title={active.status ? `Groups Overview · ${active.label}` : 'Groups Overview'}
      description="Groups this console knows about, including how many members each one has."
      path={path}
      singular="group"
      plural="groups"
      empty={active.status ? 'No groups match this filter.' : 'No groups recorded yet.'}
      banner={() => bar}
      columns={[
        { header: 'Name', width: 'w-[30%]', cell: (row) => row.title, text: (row) => row.title },
        { header: 'Access', width: 'w-[9%]', cell: (row) => blank(row.access) },
        { header: 'Members', width: 'w-[10%]', cell: (row) => row.member_count },
        { header: 'Items', width: 'w-[9%]', cell: (row) => row.item_count },
        {
          header: 'Owner',
          width: 'w-[16%]',
          cell: (row) => blank(row.owner_username),
          text: (row) => blank(row.owner_username),
        },
        { header: 'Last modified', width: 'w-[14%]', cell: (row) => formatWhen(row.modified_at) },
        {
          header: 'Days since',
          width: 'w-[12%]',
          cell: (row) => (row.days_since_modified == null ? '—' : row.days_since_modified),
        },
      ]}
    />
  )
}

export function ContentOverview() {
  const { active, path, bar } = useFilter('/content', contentFilters, contentSorts)
  const [selected, setSelected] = useState<ContentRow>()
  return (
    <RecordPage<ContentRow>
      title={active.status ? `Content Overview · ${active.label}` : 'Content Overview'}
      description="Maps, layers, and other portal items this console knows about. A dash means that detail has not been read for the item yet."
      path={path}
      singular="item"
      plural="items"
      empty={active.status ? 'No items match this filter.' : 'No content recorded yet.'}
      banner={() => (
        <>
          {bar}
          {selected && (
            <DependencyDialog
              orgId={selected.org_id}
              itemId={selected.item_id}
              portalUrl={selected.portal_url}
              onClose={() => setSelected(undefined)}
            />
          )}
        </>
      )}
      columns={[
        { header: 'Title', width: 'w-[17%]', cell: (row) => row.title, text: (row) => itemNotes(row) },
        { header: 'Type', width: 'w-[11%]', cell: (row) => row.type, text: (row) => row.type },
        {
          header: 'Owner',
          width: 'w-[12%]',
          cell: (row) => (
            <span className={row.owner_disabled ? 'text-danger' : undefined}>{blank(row.owner_username)}</span>
          ),
          text: (row) => (row.owner_disabled ? `${blank(row.owner_username)} (disabled)` : blank(row.owner_username)),
        },
        { header: 'Views', width: 'w-[7%]', cell: (row) => number(row.views) },
        { header: 'Size', width: 'w-[8%]', cell: (row) => bytes(row.size_bytes) },
        { header: 'Usage 30d', width: 'w-[8%]', cell: (row) => number(row.usage_30d) },
        { header: 'Groups', width: 'w-[7%]', cell: (row) => number(row.share_count) },
        {
          header: 'Dependencies',
          width: 'w-[12%]',
          cell: (row) => (
            <button
              type="button"
              onClick={() => setSelected(row)}
              className="rounded-md border border-line px-2 py-0.5 text-xs text-ink transition hover:border-teal hover:text-teal"
            >
              View · {number(row.dependency_count)} / {number(row.referenced_count)}
            </button>
          ),
          text: (row) => `Uses ${number(row.dependency_count)} items · used by ${number(row.referenced_count)}`,
        },
        { header: 'Score', width: 'w-[6%]', cell: (row) => number(row.completeness_score) },
        { header: 'Modified', width: 'w-[12%]', cell: (row) => formatWhen(row.modified_at) },
      ]}
    />
  )
}

function itemNotes(row: ContentRow) {
  const notes = [
    row.deprecated && 'deprecated',
    row.is_empty && 'empty',
    row.owner_disabled && 'owner disabled',
  ].filter(Boolean)
  return notes.length ? `${row.title} (${notes.join(', ')})` : row.title
}

function number(value: number | null | undefined) {
  return value == null ? '—' : new Intl.NumberFormat().format(value)
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
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function JobsPage() {
  return (
    <RecordPage<JobRow>
      title="Migration Jobs"
      description="Runs that have been queued or finished. A run is created from Migration Studio."
      path="/jobs"
      singular="job"
      plural="jobs"
      empty="No migration jobs yet."
      columns={[
        { header: 'Name', cell: (row) => row.name },
        { header: 'Status', cell: (row) => <StatusPill value={row.status} /> },
        { header: 'Created', cell: (row) => formatWhen(row.created_at) },
      ]}
    />
  )
}

export function HistoryPage() {
  return (
    <RecordPage<ActivityRow>
      title="History and Activity"
      description="Sign-ins and the actions this console records, newest first."
      path="/activity"
      singular="event"
      plural="events"
      empty="No activity recorded yet."
      columns={[
        { header: 'When', cell: (row) => formatWhen(row.occurred_at) },
        { header: 'Actor', cell: (row) => row.actor },
        { header: 'Action', cell: (row) => row.action },
        { header: 'Target', cell: (row) => blank(row.target) },
      ]}
    />
  )
}

export function ConnectionsPage() {
  return (
    <RecordPage<ConnectionRow>
      title="Connections"
      description="ArcGIS portals and other endpoints this console can read or write."
      path="/connections"
      singular="connection"
      plural="connections"
      empty="No connections configured yet."
      banner={(reload) => <AddConnectionForm onAdded={reload} />}
      columns={[
        { header: 'Name', cell: (row) => row.name },
        { header: 'Username', cell: (row) => row.username || '—' },
        { header: 'Kind', cell: (row) => row.kind },
        { header: 'Portal', cell: (row) => <span className="font-mono text-[13px]">{row.portal_url}</span> },
        { header: 'Status', cell: (row) => <StatusPill value={row.status} /> },
        { header: 'Added', cell: (row) => formatWhen(row.created_at) },
      ]}
    />
  )
}

function AddConnectionForm({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    try {
      await api('/connections', {
        method: 'POST',
        body: JSON.stringify({ url, username: username.trim() }),
      })
      setUrl('')
      setUsername('')
      onAdded()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add the connection.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-line bg-card px-5 py-4">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Add a connection</h2>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-end">
        <label className="block">
          <span className="text-sm text-muted">Portal</span>
          <input
            required
            type="url"
            name="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://portal.example.com/portal"
            autoComplete="url"
            className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="block">
          <span className="text-sm text-muted">Username</span>
          <input
            required
            type="text"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? 'Adding…' : 'Add connection'}
        </button>
      </div>
      {error && <p className="mt-3 text-sm leading-relaxed text-danger">{error}</p>}
    </form>
  )
}

function activityLabel(status: UserRow['activity_status']) {
  if (status === 'active') return 'Active'
  if (status === 'inactive') return 'Inactive'
  if (status === 'never_logged_in') return 'Never logged in'
  return 'Unknown'
}
