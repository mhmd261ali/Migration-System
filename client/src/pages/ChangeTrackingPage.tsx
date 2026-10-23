import { PageHeader } from '../components/ui'

export function ChangeTrackingPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Change Tracking"
        description="Differences found between a source and a target."
      />
      <div className="rounded-xl border border-dashed border-line bg-card px-6 py-10">
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          Comparisons will be listed here after a job has something to compare.
        </p>
      </div>
    </div>
  )
}
