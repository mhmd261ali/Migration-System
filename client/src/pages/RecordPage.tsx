import type { ReactNode } from 'react'
import { useApi } from '../api'
import { PageHeader, PanelMessage } from '../components/ui'
import { countLabel } from '../format'
import type { ListResponse } from '../types'

type Column<T> = {
  header: string
  cell: (row: T) => ReactNode
}

export function RecordPage<T extends { id: string }>({
  title,
  description,
  path,
  singular,
  plural,
  empty,
  columns,
}: {
  title: string
  description: string
  path: string
  singular: string
  plural: string
  empty: string
  columns: Column<T>[]
}) {
  const query = useApi<ListResponse<T>>(path)
  const items = query.data?.items ?? []

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={title} description={description} />
      <p className="mb-3 text-sm text-muted">
        {query.loading ? 'Loading…' : countLabel(items.length, singular, plural)}
      </p>
      {query.error && (
        <PanelMessage title="These records could not be loaded." body={query.error} onRetry={query.reload} />
      )}
      {!query.error && (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">{title}</caption>
              <thead className="bg-paper/70 text-muted">
                <tr>
                  {columns.map((column) => (
                    <th key={column.header} scope="col" className="px-4 py-3 font-medium">
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!query.loading && items.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-10 text-sm leading-relaxed text-muted">
                      {empty}
                    </td>
                  </tr>
                )}
                {items.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    {columns.map((column) => (
                      <td key={column.header} className="px-4 py-3 align-middle text-ink">
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
