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
    `select id, name, kind, portal_url, status, created_at
     from connections
     order by name asc`,
  )
  res.json({ items: result.rows })
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
