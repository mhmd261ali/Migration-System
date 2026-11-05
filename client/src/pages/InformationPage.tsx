import { type ReactNode, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../api'
import { PageHeader, PanelMessage } from '../components/ui'
import { formatWhen } from '../format'

type Row = Record<string, unknown>

type Details = {
  organization: Row | null
  sections: Record<string, Row[]>
}

const sections: { key: string; title: string; note?: string }[] = [
  { key: 'runs', title: 'Collections', note: 'Each time the organization was read, newest first.' },
  { key: 'checks', title: 'Validation', note: 'Stored counts compared with what ArcGIS Online reported during the latest collection.' },
  { key: 'gaps', title: 'Not readable', note: 'Sections the signed-in account could not read during the latest collection.' },
  { key: 'subscription', title: 'Subscription' },
  { key: 'settings', title: 'Settings', note: 'Security, map, and organization settings.' },
  { key: 'userTypes', title: 'User types' },
  { key: 'roles', title: 'Roles' },
  { key: 'licenses', title: 'Licenses' },
  { key: 'invitations', title: 'Invitations' },
  { key: 'services', title: 'Services' },
  { key: 'credits', title: 'Credits' },
  { key: 'creditUsage', title: 'Credit usage', note: 'Credits used in the 30 days before the latest collection.' },
  { key: 'storage', title: 'Storage' },
  { key: 'changes', title: 'Change history', note: 'What changed between collections, newest first.' },
]

const hiddenOrgFields = new Set(['org_id', 'connection_id'])

export function InformationPage() {
  const [params] = useSearchParams()
  const portal = params.get('portal') ?? ''
  const { data, error, loading, reload } = useApi<Details>(
    `/organizations/details?portal=${encodeURIComponent(portal)}`,
  )

  const org = data?.organization

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/overview" className="text-sm font-medium text-teal">
        ← System Overview
      </Link>
      <div className="mt-3">
        <PageHeader
          title={org ? String(org.name) : 'Organization information'}
          description={portal ? `Everything collected from ${portal}.` : 'No portal selected.'}
        />
      </div>

      {error && <PanelMessage title="The information could not be loaded." body={error} onRetry={reload} />}
      {loading && !data && <p className="text-sm text-muted">Loading information.</p>}
      {data && !org && (
        <PanelMessage title="Nothing collected yet." body="Connect to this portal from System Overview first." />
      )}

      {data && org && (
        <>
          <nav className="mb-6 flex flex-wrap gap-2">
            <Jump id="organization" label="Organization" />
            {sections.map((section) => (
              <Jump
                key={section.key}
                id={section.key}
                label={`${section.title} (${data.sections[section.key]?.length ?? 0})`}
              />
            ))}
          </nav>

          <Section id="organization" title="Organization">
            <dl className="grid gap-x-6 sm:grid-cols-2">
              {Object.entries(org)
                .filter(([key]) => !hiddenOrgFields.has(key))
                .map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4 border-b border-line py-2 text-sm">
                    <dt className="text-muted">{label(key)}</dt>
                    <dd className="min-w-0 truncate text-right text-ink" title={text(key, value)}>
                      {text(key, value)}
                    </dd>
                  </div>
                ))}
            </dl>
          </Section>

          {sections.map((section) => (
            <Section key={section.key} id={section.key} title={section.title} note={section.note}>
              <Table rows={data.sections[section.key] ?? []} />
            </Section>
          ))}
        </>
      )}
    </div>
  )
}

function Jump({ id, label: name }: { id: string; label: string }) {
  return (
    <a
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault()
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }}
      className="rounded-full border border-line bg-card px-3 py-1 text-xs text-muted hover:border-teal hover:text-ink"
    >
      {name}
    </a>
  )
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-6 scroll-mt-4 rounded-xl border border-line bg-card px-5 py-4">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

const pageSize = 200

function Table({ rows }: { rows: Row[] }) {
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(pageSize)

  if (rows.length === 0) return <p className="text-sm text-muted">Nothing recorded.</p>

  const columns = Object.keys(rows[0])
  const needle = filter.trim().toLowerCase()
  const matching = needle
    ? rows.filter((row) => columns.some((column) => text(column, row[column]).toLowerCase().includes(needle)))
    : rows
  const shown = matching.slice(0, limit)

  return (
    <>
      {rows.length > 10 && (
        <input
          type="search"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value)
            setLimit(pageSize)
          }}
          placeholder={`Filter ${rows.length} rows`}
          className="mb-3 w-full max-w-xs rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink"
        />
      )}
      <div className="max-h-[32rem] overflow-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-paper">
            <tr>
              {columns.map((column) => (
                <th key={column} className="whitespace-nowrap px-3 py-2 text-xs font-medium text-muted">
                  {label(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => {
                  const value = text(column, row[column])
                  return (
                    <td key={column} className="max-w-[18rem] truncate px-3 py-1.5 text-ink" title={value}>
                      {value}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Showing {shown.length} of {matching.length}
        {matching.length > shown.length && (
          <button
            type="button"
            onClick={() => setLimit((value) => value + pageSize)}
            className="ml-2 font-medium text-teal"
          >
            Show more
          </button>
        )}
      </p>
    </>
  )
}

function label(key: string) {
  const words = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function text(key: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (key.endsWith('_bytes') && (typeof value === 'number' || typeof value === 'string')) return bytes(Number(value))
  if ((key.endsWith('_at') || key === 'gap_start' || key === 'period_start' || key === 'period_end') && typeof value === 'string') {
    return formatWhen(value)
  }
  if (Array.isArray(value)) return value.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function bytes(value: number) {
  if (!Number.isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}
