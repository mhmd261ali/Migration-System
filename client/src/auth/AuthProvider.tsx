import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { beginLogin, initKeycloak, readSession, signOut, type Session } from './keycloak'

export type { Session }

const SessionContext = createContext<Session | null>(null)
const SignInContext = createContext<(() => Promise<void>) | null>(null)
const ReadyContext = createContext(false)

export function useSession() {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error('useSession must be used inside the signed-in console.')
  }
  return session
}

export function useOptionalSession() {
  return useContext(SessionContext)
}

export function useAuthReady() {
  return useContext(ReadyContext)
}

export function useSignIn() {
  const signIn = useContext(SignInContext)
  if (!signIn) {
    throw new Error('useSignIn must be used inside AuthProvider.')
  }
  return signIn
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    let cancelled = false
    sessionStorage.removeItem('migration.signedIn')
    initKeycloak()
      .then((ok) => {
        if (cancelled) return
        setAuthenticated(ok)
        setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setAuthenticated(false)
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const session = useMemo<Session | null>(() => {
    if (!authenticated) return null
    return { ...readSession(), signOut }
  }, [authenticated])

  return (
    <SignInContext.Provider value={beginLogin}>
      <ReadyContext.Provider value={ready}>
        <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
      </ReadyContext.Provider>
    </SignInContext.Provider>
  )
}
