import { Fragment, type ReactNode, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../api'
import { PageHeader, PanelMessage } from '../components/ui'
import { blank, formatWhen } from '../format'
import type { GroupDetails } from '../types'

const dateFields = new Set(['created', 'modified', 'joined', 'lastViewed'])
const hiddenGroupFields = new Set(['id', 'title', 'owner', 'access', 'created', 'modified', 'thumbnail'])
const hiddenItemFields = new Set(['id', 'title', 'type', 'owner', 'access', 'numViews', 'modified', 'thumbnail'])

export function GroupDetailPage() {
  const [params] = useSearchParams()
  const orgId = params.get('org') ?? ''
  const groupId = params.get('id') ?? ''
  const { data, error, loading, reload } = useApi<GroupDetails>(
    `/groups/details?org=${encodeURIComponent(orgId)}&group=${encodeURIComponent(groupId)}`,
  )

  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
        <BackLink />
        <PanelMessage title="This group could not be loaded." body={error} onRetry={reload} />
      </div>
    )
  }
  if (loading && !data) return <p className="mx-auto max-w-6xl text-sm text-muted">Loading…</p>
  if (!data) return null

  const { group, members, statistics, items } = data
  const base = group.portal_url.replace(/\/+$/, '').replace(/\/home$/i, '')
  const read = group.details != null

  return (
    <div className="mx-auto max-w-6xl">
      <BackLink />
      <PageHeader
        title={group.title}
        description={`${blank(group.access)} group owned by ${blank(group.owner)} · last modified ${formatWhen(group.modified_at)}`}
      />
      <p className="-mt-4 mb-6 text-sm">
        <a
          href={`${base}/home/group.html?id=${encodeURIComponent(group.group_id)}`}
          target="_blank"
          rel="noreferrer"
          className="text-teal hover:underline"
        >
          Open in ArcGIS
        </a>
      </p>

      {data.lastError && (
        <p className="mb-4 rounded-lg bg-paper px-3 py-2 text-sm text-danger">
          The last read of this group's members or items failed: {data.lastError.reason}. The lists below are from
          an earlier read.
        </p>
      )}
      {!read && (
        <p className="mb-4 rounded-lg bg-paper px-3 py-2 text-sm text-muted">
          Full group details, member names, and join dates appear after the next Refresh data.
        </p>
      )}

      <Section title="Group information">
        <Fields
          values={{
            id: group.group_id,
            created: group.created_at,
            ...(group.details ?? {}),
          }}
          hidden={hiddenGroupFields}
          keep={['id', 'created']}
        />
      </Section>

      <Section title="Members">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Total members" value={statistics.total_members} />
          <Tile label="Administrators" value={statistics.total_admins} note="Including the owner" />
          <Tile label="Additional admins" value={statistics.additional_admins} />
          <Tile label="Regular members" value={statistics.regular_members} />
        </div>
        {statistics.admin_usernames.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            Administrators: <span className="font-mono text-[13px] text-ink">{statistics.admin_usernames.join(', ')}</span>
          </p>
        )}
        <Table
          headers={[
            ['Name', 'w-[30%]'],
            ['Username', 'w-[30%]'],
            ['Role', 'w-[15%]'],
            ['Joined', 'w-[25%]'],
          ]}
          empty="No members recorded for this group yet."
        >
          {members.map((member) => (
            <tr key={member.username} className="border-t border-line">
              <td className="truncate px-4 py-2.5" title={member.full_name ?? undefined}>
                {blank(member.full_name)}
                {member.disabled && <span className="ml-2 text-xs text-danger">disabled</span>}
                {!member.in_org && <span className="ml-2 text-xs text-muted">other organization</span>}
              </td>
              <td className="truncate px-4 py-2.5 font-mono text-[13px]">{member.username}</td>
              <td className="px-4 py-2.5 capitalize">{blank(member.member_role)}</td>
              <td className="px-4 py-2.5">{formatWhen(member.joined_at)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title={`Shared items (${items.length})`}>
        <ItemTable items={items} base={base} />
      </Section>
    </div>
  )
}

function ItemTable({ items, base }: { items: GroupDetails['items']; base: string }) {
  const [open, setOpen] = useState<string>()
  return (
    <Table
      headers={[
        ['Title', 'w-[28%]'],
        ['Type', 'w-[15%]'],
        ['Owner', 'w-[15%]'],
        ['Access', 'w-[9%]'],
        ['Views', 'w-[8%]'],
        ['Modified', 'w-[15%]'],
        ['', 'w-[10%]'],
      ]}
      empty="No items recorded for this group yet."
    >
      {items.map((item) => (
        <Fragment key={item.item_id}>
          <tr className="border-t border-line">
            <td className="truncate px-4 py-2.5" title={item.title}>
              <button
                type="button"
                onClick={() => setOpen(open === item.item_id ? undefined : item.item_id)}
                aria-expanded={open === item.item_id}
                className="max-w-full truncate text-left text-ink hover:text-teal"
              >
                {item.title}
              </button>
              {!item.in_org && <span className="ml-2 text-xs text-muted">other organization</span>}
            </td>
            <td className="truncate px-4 py-2.5">{blank(item.type)}</td>
            <td className="truncate px-4 py-2.5">{blank(item.owner)}</td>
            <td className="px-4 py-2.5">{blank(item.access)}</td>
            <td className="px-4 py-2.5">{item.views == null ? '—' : new Intl.NumberFormat().format(item.views)}</td>
            <td className="px-4 py-2.5">{formatWhen(item.modified_at)}</td>
            <td className="px-4 py-2.5 text-right">
              <a
                href={`${base}/home/item.html?id=${encodeURIComponent(item.item_id)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ink transition hover:border-teal hover:text-teal"
              >
                See
              </a>
            </td>
          </tr>
          {open === item.item_id && (
            <tr className="bg-paper/50">
              <td colSpan={7} className="px-4 py-3">
                {item.item ? (
                  <Fields values={{ id: item.item_id, ...item.item }} hidden={hiddenItemFields} keep={['id']} />
                ) : (
                  <p className="text-sm text-muted">Item details appear after the next Refresh data.</p>
                )}
              </td>
            </tr>
          )}
        </Fragment>
      ))}
    </Table>
  )
}

function BackLink() {
  return (
    <Link to="/groups" className="mb-3 inline-block text-sm font-medium text-teal">
      ← Groups Overview
    </Link>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-line bg-card px-5 py-4">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{title}</h2>
      {children}
    </section>
  )
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-semibold text-ink">{new Intl.NumberFormat().format(value)}</p>
      {note && <p className="text-[11px] text-muted">{note}</p>}
    </div>
  )
}

function Table({ headers, empty, children }: { headers: [string, string][]; empty: string; children: ReactNode[] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-paper/70 text-muted">
          <tr>
            {headers.map(([header, width], index) => (
              <th key={header || index} scope="col" className={`px-4 py-2.5 font-medium ${width}`}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-6 text-sm text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  )
}

function Fields({ values, hidden, keep }: { values: Record<string, unknown>; hidden: Set<string>; keep: string[] }) {
  const rows = Object.entries(values)
    .filter(([key]) => keep.includes(key) || !hidden.has(key))
    .map(([key, value]) => [key, display(key, value)] as const)
    .filter(([, value]) => value !== '')
  if (rows.length === 0) return <p className="text-sm text-muted">No details recorded.</p>
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
      {rows.map(([key, value]) => (
        <Fragment key={key}>
          <dt className="text-muted">{label(key)}</dt>
          <dd className="break-words text-ink">{value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

function label(key: string) {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return words === 'id' ? 'ID' : words.charAt(0).toUpperCase() + words.slice(1)
}

function display(key: string, value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (dateFields.has(key) && (typeof value === 'number' || typeof value === 'string')) {
    return value === -1 ? '' : formatWhen(typeof value === 'number' ? new Date(value).toISOString() : value)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'object' ? JSON.stringify(entry) : String(entry))).join(', ')
  }
  if (typeof value === 'object') return Object.keys(value).length ? JSON.stringify(value) : ''
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
