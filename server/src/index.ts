import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { requireAuth } from './auth.js'
import { databaseStatus, pool, prepareDatabase } from './db.js'
import { env } from './env.js'
import { identityStatus, prepareKeycloak } from './keycloak.js'

const app = express()
app.use(cors({ origin: env.webOrigin }))
app.use(express.json())

app.get('/api/health', asyncRoute(async (_req, res) => {
  const [database, identity] = await Promise.all([
    Promise.resolve(databaseStatus()),
    identityStatus(),
  ])
  res.json({
    api: 'ok',
    database,
    identity,
    identityUrl: `${env.keycloakUrl}/realms/${env.keycloakRealm}`,
  })
}))

app.get('/api/overview', requireAuth, asyncRoute(async (_req, res) => {
  const [users, groups, content, connections, jobs, activity, identity] = await Promise.all([
    count('directory_users'),
    count('directory_groups'),
    count('content_items'),
    count('connections'),
    count('migration_jobs'),
    pool.query<{ id: string; actor: string; action: string; target: string | null; occurred_at: Date }>(
      `select id, actor, action, target, occurred_at
       from activity_events
       order by occurred_at desc
       limit 8`,
    ),
    identityStatus(),
  ])

  res.json({
    counts: {
      users,
      groups,
      content,
      connections,
      jobs,
    },
    services: {
      database: 'ok',
      identity,
    },
    activity: activity.rows,
  })
}))

app.get('/api/users', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `select id, username, display_name, email, role_name, source, status, last_seen_at
     from directory_users
     order by display_name asc`,
  )
  res.json({ items: result.rows })
}))

app.get('/api/groups', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `select id, name, group_type, member_count, owner_name, source
     from directory_groups
     order by name asc`,
  )
  res.json({ items: result.rows })
}))

app.get('/api/content', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `select id, title, item_type, owner_name, folder, portal, modified_at
     from content_items
     order by title asc`,
  )
  res.json({ items: result.rows })
}))

app.get('/api/connections', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `select id, name, kind, portal_url, username, status, created_at
     from connections
     order by created_at desc`,
  )
  res.json({ items: result.rows })
}))

app.post('/api/connections', requireAuth, asyncRoute(async (req, res) => {
  const portalUrl = readPortalUrl(req.body?.url)
  const usernames = readUsernames(req.body)
  if (!portalUrl) {
    res.status(400).json({ error: 'Enter a valid http or https URL.' })
    return
  }
  if (usernames.length === 0) {
    res.status(400).json({ error: 'Enter a username.' })
    return
  }

  const existing = await pool.query<{ name: string; kind: string }>(
    `select name, kind from connections where portal_url = $1 limit 1`,
    [portalUrl],
  )
  const portal = existing.rows[0]
  const name = portal?.name ?? new URL(portalUrl).hostname
  const kind = portal?.kind ?? 'portal'

  for (const username of usernames) {
    const duplicate = await pool.query(
      `select id from connections where portal_url = $1 and lower(username) = lower($2)`,
      [portalUrl, username],
    )
    if (duplicate.rows[0]) {
      res.status(409).json({ error: `${username} is already on this portal.` })
      return
    }
  }

  const created = []
  for (const [index, username] of usernames.entries()) {
    try {
      const result = await pool.query(
        `insert into connections (name, kind, portal_url, username, status)
         values ($1, $2, $3, $4, 'saved')
         returning id, name, kind, portal_url, username, status, created_at`,
        [name, kind, portalUrl, username],
      )
      created.push(result.rows[0])
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: `${username} is already on this portal.` })
        return
      }
      throw error
    }

    const action = portal || index > 0 ? 'added a user' : 'added a connection'
    await pool.query(
      `insert into activity_events (actor, action, target) values ($1, $2, $3)`,
      [req.auth?.username ?? 'operator', action, `${username} · ${portalUrl}`],
    )
  }

  res.status(201).json({ items: created })
}))

app.post('/api/connections/:id/connect', requireAuth, asyncRoute(async (req, res) => {
  const id = req.params.id
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(404).json({ error: 'Connection not found.' })
    return
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!password) {
    res.status(400).json({ error: 'Enter a password.' })
    return
  }

  const found = await pool.query<{ id: string; portal_url: string; username: string }>(
    `select id, portal_url, username from connections where id = $1`,
    [id],
  )
  const row = found.rows[0]
  if (!row) {
    res.status(404).json({ error: 'Connection not found.' })
    return
  }
  if (!row.username) {
    res.status(400).json({ error: 'This connection has no username.' })
    return
  }

  try {
    await generatePortalToken(row.portal_url, row.username, password)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not connect.'
    res.status(502).json({ error: message })
    return
  }

  await pool.query(`update connections set status = 'connected' where id = $1`, [row.id])
  await pool.query(
    `insert into activity_events (actor, action, target) values ($1, 'connected', $2)`,
    [req.auth?.username ?? 'operator', row.portal_url],
  )
  res.json({ status: 'connected' })
}))

app.get('/api/jobs', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `select id, name, status, created_at
     from migration_jobs
     order by created_at desc`,
  )
  res.json({ items: result.rows })
}))

app.get('/api/activity', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `select id, actor, action, target, occurred_at
     from activity_events
     order by occurred_at desc
     limit 200`,
  )
  res.json({ items: result.rows })
}))

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  res.status(503).json({ error: 'Database is not ready.' })
})

app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`)
})

void prepareDatabase()
if (!env.authDisabled) {
  void prepareKeycloak()
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next)
  }
}

function readPortalUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function readUsername(value: unknown) {
  if (typeof value !== 'string') return null
  const username = value.trim()
  if (!username || username.length > 200) return null
  return username
}

function readUsernames(body: { username?: unknown; usernames?: unknown }) {
  const raw = Array.isArray(body?.usernames) ? body.usernames : [body?.username]
  const names: string[] = []
  for (const value of raw) {
    const username = readUsername(value)
    if (!username) continue
    if (names.some((name) => name.toLowerCase() === username.toLowerCase())) continue
    names.push(username)
  }
  return names
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function tokenEndpoint(portalUrl: string) {
  const url = new URL(portalUrl)
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/sharing\/rest\/generateToken$/i, '')
    .replace(/\/sharing\/rest$/i, '')
    .replace(/\/sharing$/i, '')
    .replace(/\/home$/i, '')
  url.pathname = `${path}/sharing/rest/generateToken`
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function generatePortalToken(portalUrl: string, username: string, password: string) {
  const body = new URLSearchParams({
    username,
    password,
    client: 'referer',
    referer: env.webOrigin,
    expiration: '60',
    f: 'json',
  })

  let response: Response
  try {
    response = await fetch(tokenEndpoint(portalUrl), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Error('The portal did not respond.')
  }

  const json = (await response.json().catch(() => null)) as {
    token?: string
    error?: { message?: string; details?: string[] }
  } | null
  const detail = json?.error?.details?.filter(Boolean).join(' ')
  if (!response.ok || !json?.token) {
    throw new Error(detail || json?.error?.message || 'Could not connect to this portal.')
  }
}

async function count(table: string) {
  const allowed = new Set([
    'directory_users',
    'directory_groups',
    'content_items',
    'connections',
    'migration_jobs',
  ])
  if (!allowed.has(table)) {
    throw new Error(`Unknown table ${table}`)
  }
  const result = await pool.query<{ count: number }>(`select count(*)::int as count from ${table}`)
  return result.rows[0]?.count ?? 0
}
