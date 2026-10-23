import { Mark } from '../components/ui'

export function OpeningConsole() {
  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6 py-12">
      <div className="w-full max-w-md">
        <Mark />
        <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.16em] text-teal">RD-NEW</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">Migration System</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">Keycloak accepted the sign-in. Opening the console.</p>
        <div className="mt-6 h-0.5 overflow-hidden rounded bg-line">
          <div className="wait-bar h-full w-1/3 bg-teal" />
        </div>
      </div>
    </div>
  )
}
