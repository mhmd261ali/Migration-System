import { PageHeader } from '../components/ui'

export function StudioPage() {
  return (
    <Workspace
      title="Migration Studio"
      description="Compose a migration: pick a source, pick a target, and choose which users, groups, and content move."
      note="The studio workspace is the next brick. Connections and jobs are already in place around it."
    />
  )
}

function Workspace({ title, description, note }: { title: string; description: string; note: string }) {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={title} description={description} />
      <div className="rounded-xl border border-dashed border-line bg-card px-6 py-10">
        <p className="max-w-xl text-sm leading-relaxed text-muted">{note}</p>
      </div>
    </div>
  )
}
