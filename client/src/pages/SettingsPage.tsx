import { useSession } from '../auth/AuthProvider'
import { keycloakConfig } from '../auth/keycloak'
import { PageHeader } from '../components/ui'

export function SettingsPage() {
  const session = useSession()
  const issuer = `${keycloakConfig.url}/realms/${keycloakConfig.realm}`

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Settings"
        description="The account you are signed in with, and the Keycloak realm this console uses."
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-card px-5 py-2">
          <h2 className="pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Account</h2>
          <dl>
            <Row label="Name" value={session.name} />
            <Row label="Username" value={session.username} mono />
            <Row label="Email" value={session.email || '—'} />
            <Row label="Roles" value={session.roles.length ? session.roles.join(', ') : 'None assigned'} />
          </dl>
        </section>
        <section className="rounded-xl border border-line bg-card px-5 py-2">
          <h2 className="pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Identity</h2>
          <dl>
            <Row label="Provider" value="Keycloak" />
            <Row label="Realm" value={keycloakConfig.realm} mono />
            <Row label="Client" value={keycloakConfig.clientId} mono />
            <Row label="Issuer" value={issuer} mono />
          </dl>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 last:border-0 sm:grid-cols-[120px_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`break-all text-sm text-ink ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</dd>
    </div>
  )
}
