import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../api'
import { getToken } from '../auth/keycloak'
import { PageHeader, PanelMessage } from '../components/ui'
import { formatWhen } from '../format'
import type { ReportSheet } from '../types'

const FIRST_ITEM_SHEET = 'Item summary'

function sheetSections(sheets: ReportSheet[]) {
  const split = sheets.findIndex((sheet) => sheet.name === FIRST_ITEM_SHEET)
  const indexes = sheets.map((_, index) => index)
  if (split < 0) return [{ title: 'Users and groups', indexes }]
  return [
    { title: 'Users and groups', indexes: indexes.slice(0, split) },
    { title: 'Items', indexes: indexes.slice(split) },
  ]
}

export function ReportsPage() {
  const [params] = useSearchParams()
  const portal = params.get('portal') ?? ''
  const { data, error, loading, reload } = useApi<{ sheets: ReportSheet[] }>(
    `/organizations/analysis?portal=${encodeURIComponent(portal)}`,
  )
  const [chosen, setChosen] = useState<number>()
  const wanted = data?.sheets.findIndex((entry) => entry.name === params.get('sheet')) ?? -1
  const active = chosen ?? (wanted >= 0 ? wanted : 0)
  const setActive = setChosen
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string>()
  const sheet = data?.sheets[active]

  async function download() {
    setDownloading(true)
    setDownloadError(undefined)
    try {
      const token = await getToken()
      const response = await fetch(`/api/organizations/report.xlsx?portal=${encodeURIComponent(portal)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Download failed (${response.status}).`)
      }
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? 'report.xlsx'
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/overview" className="text-sm font-medium text-teal">
        ← System Overview
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Organization report"
          description={`Users, groups, and items for ${portal || 'this portal'}. Inactive means no login for 90 days. Item rankings show the top 1,000.`}
        />
        <button
          type="button"
          onClick={download}
          disabled={downloading || !data}
          className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {downloading ? 'Preparing…' : 'Download Excel'}
        </button>
      </div>
      {downloadError && <p className="mb-4 text-sm text-danger">{downloadError}</p>}

      {error && <PanelMessage title="The report could not be built." body={error} onRetry={reload} />}
      {loading && !data && <p className="text-sm text-muted">Building the report.</p>}

      {data && (
        <>
          {sheetSections(data.sheets).map((section) => (
            <nav key={section.title} className="mb-3 flex flex-wrap items-center gap-2">
              <span className="w-full text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                {section.title}
              </span>
              {section.indexes.map((index) => (
                <button
                  key={data.sheets[index].name}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    index === active
                      ? 'border-teal bg-teal-soft text-teal'
                      : 'border-line bg-card text-muted hover:border-teal hover:text-ink'
                  }`}
                >
                  {data.sheets[index].name} ({data.sheets[index].total})
                </button>
              ))}
            </nav>
          ))}

          {sheet && (
            <section className="rounded-xl border border-line bg-card px-5 py-4">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{sheet.name}</h2>
              {sheet.rows.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Nothing to list.</p>
              ) : (
                <div className="mt-3 max-h-[36rem] overflow-auto rounded-lg border border-line">
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="sticky top-0 bg-paper">
                      <tr>
                        {sheet.columns.map((column) => (
                          <th key={column} className="truncate px-3 py-2 text-xs font-medium text-muted" title={column}>
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {sheet.rows.map((row, index) => (
                        <tr key={index}>
                          {row.map((value, cell) => {
                            const text = show(value)
                            return (
                              <td key={cell} className="truncate px-3 py-1.5 text-ink" title={text}>
                                {text}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sheet.total > sheet.rows.length && (
                <p className="mt-2 text-xs text-muted">
                  Showing the first {sheet.rows.length} of {sheet.total}. The Excel file has every row.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function show(value: unknown) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatWhen(value)
  return String(value)
}
