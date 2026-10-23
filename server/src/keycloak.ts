import { env } from './env.js'

export type IdentityState = 'ok' | 'starting' | 'down'

export async function identityStatus(): Promise<IdentityState> {
  const realmUrl = `${env.keycloakUrl}/realms/${env.keycloakRealm}/.well-known/openid-configuration`
  const masterUrl = `${env.keycloakUrl}/realms/master/.well-known/openid-configuration`

  try {
    const realm = await fetch(realmUrl, { signal: AbortSignal.timeout(3000) })
    if (realm.ok) return 'ok'
  } catch {
    return 'down'
  }

  try {
    const master = await fetch(masterUrl, { signal: AbortSignal.timeout(3000) })
    return master.ok ? 'starting' : 'down'
  } catch {
    return 'down'
  }
}

export function prepareKeycloak() {
  void (async () => {
    for (;;) {
      try {
        await ensureConsoleRealm()
        console.log(`Keycloak realm "${env.keycloakRealm}" is ready`)
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(`Waiting for Keycloak: ${message}`)
        await sleep(4000)
      }
    }
  })()
}

async function ensureConsoleRealm() {
  const token = await adminToken()
  await ensureRealm(token)
  await ensureClient(token)
  await ensureRole(token, 'admin', 'Full access to the console')
  await ensureRole(token, 'operator', 'Operate migrations')
  await ensureRole(token, 'viewer', 'Read the console')
  await ensureOperator(token)
}

async function adminToken() {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: env.keycloakAdmin,
    password: env.keycloakAdminPassword,
  })
  const response = await fetch(`${env.keycloakUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) {
    throw new Error(`admin login failed (${response.status})`)
  }
  const json = (await response.json()) as { access_token: string }
  return json.access_token
}

async function kc(path: string, token: string, init?: RequestInit) {
  return fetch(`${env.keycloakUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  })
}

const displayName = 'RD-NEW'

async function ensureRealm(token: string) {
  const existing = await kc(`/admin/realms/${env.keycloakRealm}`, token)
  if (existing.status === 200) {
    const realm = (await existing.json()) as { displayName?: string }
    if (realm.displayName === displayName) return
    const updated = await kc(`/admin/realms/${env.keycloakRealm}`, token, {
      method: 'PUT',
      body: JSON.stringify({ ...realm, displayName }),
    })
    if (!updated.ok) {
      throw new Error(`could not rename realm (${updated.status})`)
    }
    return
  }
  if (existing.status !== 404) {
    throw new Error(`could not read realm (${existing.status})`)
  }

  const created = await kc('/admin/realms', token, {
    method: 'POST',
    body: JSON.stringify({
      realm: env.keycloakRealm,
      enabled: true,
      displayName,
      sslRequired: 'none',
      registrationAllowed: false,
      loginWithEmailAllowed: true,
      bruteForceProtected: true,
    }),
  })
  if (created.status !== 201 && created.status !== 409) {
    const detail = await created.text()
    throw new Error(`could not create realm (${created.status}) ${detail}`)
  }
}

async function ensureClient(token: string) {
  const listed = await kc(
    `/admin/realms/${env.keycloakRealm}/clients?clientId=${encodeURIComponent(env.keycloakClientId)}`,
    token,
  )
  if (!listed.ok) {
    throw new Error(`could not list clients (${listed.status})`)
  }
  const clients = (await listed.json()) as { id: string; clientId: string }[]
  if (clients.some((client) => client.clientId === env.keycloakClientId)) return

  const created = await kc(`/admin/realms/${env.keycloakRealm}/clients`, token, {
    method: 'POST',
    body: JSON.stringify({
      clientId: env.keycloakClientId,
      name: 'Migration Console',
      enabled: true,
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      implicitFlowEnabled: false,
      protocol: 'openid-connect',
      rootUrl: env.webOrigin,
      baseUrl: env.webOrigin,
      redirectUris: [env.webOrigin, `${env.webOrigin}/`, `${env.webOrigin}/*`],
      webOrigins: [env.webOrigin],
      attributes: {
        'pkce.code.challenge.method': 'S256',
        'post.logout.redirect.uris': `${env.webOrigin}##${env.webOrigin}/##${env.webOrigin}/*`,
      },
    }),
  })
  if (created.status !== 201 && created.status !== 409) {
    const detail = await created.text()
    throw new Error(`could not create client (${created.status}) ${detail}`)
  }
}

async function ensureRole(token: string, name: string, description: string) {
  const existing = await kc(`/admin/realms/${env.keycloakRealm}/roles/${name}`, token)
  if (existing.status === 200) return
  if (existing.status !== 404) {
    throw new Error(`could not read role ${name} (${existing.status})`)
  }
  const created = await kc(`/admin/realms/${env.keycloakRealm}/roles`, token, {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  })
  if (created.status !== 201 && created.status !== 409) {
    throw new Error(`could not create role ${name} (${created.status})`)
  }
}

async function ensureOperator(token: string) {
  const username = env.operatorUsername
  const listed = await kc(
    `/admin/realms/${env.keycloakRealm}/users?username=${encodeURIComponent(username)}&exact=true`,
    token,
  )
  if (!listed.ok) {
    throw new Error(`could not list users (${listed.status})`)
  }
  const users = (await listed.json()) as { id: string; username: string }[]
  let user = users.find((entry) => entry.username === username)

  if (!user) {
    const created = await kc(`/admin/realms/${env.keycloakRealm}/users`, token, {
      method: 'POST',
      body: JSON.stringify({
        username,
        enabled: true,
        emailVerified: true,
        email: `${username}@localhost`,
        firstName: 'Migration',
        lastName: 'Operator',
      }),
    })
    if (created.status !== 201) {
      const detail = await created.text()
      throw new Error(`could not create operator (${created.status}) ${detail}`)
    }
    const again = await kc(
      `/admin/realms/${env.keycloakRealm}/users?username=${encodeURIComponent(username)}&exact=true`,
      token,
    )
    const createdUsers = (await again.json()) as { id: string; username: string }[]
    user = createdUsers.find((entry) => entry.username === username)
    if (!user) throw new Error('operator was created but could not be read back')

    const password = await kc(`/admin/realms/${env.keycloakRealm}/users/${user.id}/reset-password`, token, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: env.operatorPassword, temporary: false }),
    })
    if (!password.ok) {
      throw new Error(`could not set operator password (${password.status})`)
    }
  }

  const roleNames = ['admin', 'operator']
  const roles = []
  for (const name of roleNames) {
    const response = await kc(`/admin/realms/${env.keycloakRealm}/roles/${name}`, token)
    if (!response.ok) throw new Error(`could not read role ${name}`)
    roles.push((await response.json()) as { id: string; name: string })
  }

  const assignedResponse = await kc(
    `/admin/realms/${env.keycloakRealm}/users/${user.id}/role-mappings/realm`,
    token,
  )
  if (!assignedResponse.ok) {
    throw new Error(`could not read operator roles (${assignedResponse.status})`)
  }
  const assigned = (await assignedResponse.json()) as { name: string }[]
  const missing = roles.filter((role) => !assigned.some((entry) => entry.name === role.name))
  if (missing.length === 0) return

  const mapped = await kc(`/admin/realms/${env.keycloakRealm}/users/${user.id}/role-mappings/realm`, token, {
    method: 'POST',
    body: JSON.stringify(missing),
  })
  if (!mapped.ok) {
    throw new Error(`could not assign operator roles (${mapped.status})`)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
