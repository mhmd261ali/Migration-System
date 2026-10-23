import { getToken } from './auth/keycloak'
import type { Health } from './types'
import { useEffect, useState } from 'react'

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken()
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  })

  if (response.status === 401) {
    const { keycloak } = await import('./auth/keycloak')
    void keycloak.login({ redirectUri: `${window.location.origin}/overview` })
    throw new Error('Sign-in required.')
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed (${response.status}).`)
  }

  return response.json() as Promise<T>
}

export function useApi<T>(path: string) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    api<T>(path)
      .then((next) => {
        if (active) setData(next)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Request failed.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [path, attempt])

  return {
    data,
    error,
    loading,
    reload: () => setAttempt((value) => value + 1),
  }
}

export async function fetchHealth(): Promise<Health> {
  let response: Response
  try {
    response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
  } catch {
    throw new Error('The console API is not running. From the project folder, run npm run dev.')
  }
  if (!response.ok) {
    throw new Error('The console API could not report status.')
  }
  return response.json() as Promise<Health>
}
