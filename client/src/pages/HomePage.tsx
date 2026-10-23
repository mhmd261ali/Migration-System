import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useOptionalSession, useSignIn } from '../auth/AuthProvider'
import { Mark } from '../components/ui'

export function HomePage() {
  const session = useOptionalSession()
  const signIn = useSignIn()
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (session) {
    return <Navigate to="/overview" replace />
  }

  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6 py-12">
      <div className="w-full max-w-md">
        <Mark />
        <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.16em] text-teal">RD-NEW</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">Migration System</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Log in continues on Keycloak. After it succeeds, the console opens.
        </p>
        <button
          type="button"
          disabled={leaving}
          onClick={() => {
            setLeaving(true)
            setError(null)
            void signIn().catch((reason: unknown) => {
              setLeaving(false)
              setError(reason instanceof Error ? reason.message : 'Keycloak did not open.')
            })
          }}
          className="mt-8 rounded-lg bg-teal px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {leaving ? 'Opening Keycloak…' : 'Log in'}
        </button>
        {error && <p className="mt-4 text-sm leading-relaxed text-danger">{error}</p>}
      </div>
    </div>
  )
}
