import Keycloak from 'keycloak-js'

function required(name: keyof ImportMetaEnv) {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(`Missing ${name}. Add it to client/.env.`)
  }
  return value
}

export const keycloakConfig = {
  url: required('VITE_KEYCLOAK_URL'),
  realm: required('VITE_KEYCLOAK_REALM'),
  clientId: required('VITE_KEYCLOAK_CLIENT_ID'),
}

export const keycloak = new Keycloak({
  url: keycloakConfig.url,
  realm: keycloakConfig.realm,
  clientId: keycloakConfig.clientId,
})

type TokenClaims = {
  preferred_username?: string
  given_name?: string
  family_name?: string
  name?: string
  email?: string
  realm_access?: { roles?: string[] }
}

export type Session = {
  username: string
  name: string
  email: string
  roles: string[]
  signOut: () => void
}

let initPromise: Promise<boolean> | null = null
let hooksReady = false

export function initKeycloak() {
  if (!hooksReady) {
    hooksReady = true
    keycloak.onTokenExpired = () => {
      void keycloak.updateToken(30).catch(() => {
        void keycloak.login({ redirectUri: `${window.location.origin}/overview` })
      })
    }
  }

  if (!initPromise) {
    initPromise = keycloak
      .init({
        onLoad: 'check-sso',
        pkceMethod: 'S256',
        checkLoginIframe: false,
        silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      })
      .catch((error: unknown) => {
        initPromise = null
        throw error
      })
  }

  return initPromise
}

export async function getToken() {
  if (!keycloak.authenticated) {
    throw new Error('Sign-in required.')
  }
  try {
    await keycloak.updateToken(30)
  } catch {
    void keycloak.login({ redirectUri: `${window.location.origin}/overview` })
    throw new Error('Sign-in required.')
  }
  if (!keycloak.token) {
    throw new Error('Sign-in required.')
  }
  return keycloak.token
}

export function readSession(): Omit<Session, 'signOut'> {
  const token = keycloak.tokenParsed as TokenClaims | undefined
  const username = token?.preferred_username ?? 'unknown'
  const name =
    token?.name ||
    [token?.given_name, token?.family_name].filter(Boolean).join(' ') ||
    username
  const roles = (token?.realm_access?.roles ?? []).filter(
    (role) => !role.startsWith('default-roles-') && role !== 'offline_access' && role !== 'uma_authorization',
  )
  return {
    username,
    name,
    email: token?.email ?? '',
    roles,
  }
}

export async function beginLogin() {
  await initKeycloak()
  await keycloak.login({ redirectUri: `${window.location.origin}/overview` })
}

export function signOut() {
  void keycloak.logout({ redirectUri: `${window.location.origin}/` })
}
