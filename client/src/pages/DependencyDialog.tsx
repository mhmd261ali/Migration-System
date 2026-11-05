import { useEffect, useState } from 'react'
import { useApi } from '../api'
import { PanelMessage } from '../components/ui'
import { formatWhen } from '../format'
import type { DependencyItem, ItemDependencies } from '../types'

export function DependencyDialog({
  orgId,
  itemId,
  portalUrl,
  onClose,
}: {
  orgId: string
  itemId: string
  portalUrl: string
  onClose: () => void
}) {
  const [current, setCurrent] = useState(itemId)
  const [trail, setTrail] = useState<string[]>([])
  const { data, error, loading, reload } = useApi<ItemDependencies>(
    `/content/dependencies?org=${encodeURIComponent(orgId)}&item=${encodeURIComponent(current)}`,
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function open(id: string) {
    setTrail((previous) => [...previous, current])
    setCurrent(id)
  }

  function back() {
    setCurrent(trail[trail.length - 1])
    setTrail((previous) => previous.slice(0, -1))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-12"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dependency-title"
        className="w-full max-w-2xl rounded-xl border border-line bg-card px-5 py-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {trail.length > 0 && (
              <button type="button" onClick={back} className="mb-1 text-xs font-medium text-teal">
                ← Back
              </button>
            )}
            <h2 id="dependency-title" className="truncate text-lg font-semibold text-ink">
              {data?.item.title ?? 'Dependencies'}
            </h2>
            {data && (
              <p className="text-xs text-muted">
                {data.item.type}
                {data.item.owner_username ? ` · ${data.item.owner_username}` : ''}
                {data.item.is_empty ? ' · empty' : ''}
                {' · '}
                <a
                  href={itemPage(portalUrl, data.item.item_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-teal hover:underline"
                >
                  Open in ArcGIS
                </a>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-line px-2 py-1 text-sm text-muted hover:border-teal hover:text-ink"
          >
            ✕
          </button>
        </div>

        {error && <PanelMessage title="Dependencies could not be loaded." body={error} onRetry={reload} />}
        {loading && !data && <p className="py-6 text-sm text-muted">Loading…</p>}

        {data && (
          <>
            <CheckStatus check={data.check} />
            <DependencyList
              title={`Uses (${data.uses.length})`}
              empty={data.check?.ok ? 'This item does not use other items.' : 'Not read yet.'}
              rows={data.uses}
              onOpen={open}
              portalUrl={portalUrl}
            />
            <DependencyList
              title={`Used by (${data.usedBy.length})`}
              empty="No item read so far uses this one."
              rows={data.usedBy}
              onOpen={open}
              portalUrl={portalUrl}
            />
          </>
        )}
      </div>
    </div>
  )
}

function CheckStatus({ check }: { check: ItemDependencies['check'] }) {
  if (!check) {
    return (
      <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-xs text-muted">
        This item's dependencies have not been read yet. Each Refresh data reads more items.
      </p>
    )
  }
  if (!check.ok) {
    return (
      <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-xs text-danger" title={check.error ?? undefined}>
        Reading dependencies failed {formatWhen(check.checked_at)}: {(check.error ?? '').slice(0, 200)}
      </p>
    )
  }
  return <p className="mt-3 text-xs text-muted">Dependencies read {formatWhen(check.checked_at)}.</p>
}

function itemPage(portalUrl: string, id: string) {
  const base = portalUrl.replace(/\/+$/, '').replace(/\/home$/i, '')
  return `${base}/home/item.html?id=${encodeURIComponent(id)}`
}

function DependencyList({
  title,
  empty,
  rows,
  onOpen,
  portalUrl,
}: {
  title: string
  empty: string
  rows: DependencyItem[]
  onOpen: (id: string) => void
  portalUrl: string
}) {
  return (
    <section className="mt-4">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-1 max-h-64 divide-y divide-line overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              {row.in_org ? (
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="min-w-0 truncate text-left text-ink hover:text-teal"
                  title={row.title ?? row.id}
                >
                  {row.title ?? row.id}
                  {row.is_empty && <span className="ml-2 text-xs text-danger">empty</span>}
                </button>
              ) : (
                <span
                  className="min-w-0 truncate font-mono text-xs text-muted"
                  title={`${row.id}: from another organization, not visible to this account, or not an item`}
                >
                  {row.id}
                </span>
              )}
              <span className="flex shrink-0 items-baseline gap-3 text-xs text-muted">
                {row.in_org ? row.type : /^https?:/.test(row.id) ? 'Service URL' : 'Not an item here'}
                <a
                  href={/^https?:/.test(row.id) ? row.id : itemPage(portalUrl, row.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-line px-2 py-0.5 font-medium text-ink transition hover:border-teal hover:text-teal"
                >
                  See
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
