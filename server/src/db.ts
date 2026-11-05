import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { env, schemaDir } from './env.js'

const { Pool } = pg

export const pool = new Pool({ connectionString: env.databaseUrl, max: 10 })

pool.on('error', (error) => {
  console.error('Postgres pool error', error)
})

let schemaReady = false

export function databaseStatus(): 'ok' | 'starting' {
  return schemaReady ? 'ok' : 'starting'
}

export async function prepareDatabase() {
  for (;;) {
    try {
      await pool.query('select 1')
      for (const file of schemaFiles()) {
        const sql = fs.readFileSync(file, 'utf8')
        await pool.query(sql)
      }
      await backfillOrganizations()
      schemaReady = true
      console.log('Database schema is ready')
      return
    } catch (error) {
      schemaReady = false
      const message = error instanceof Error ? error.message : String(error)
      console.log(`Waiting for Postgres: ${message}`)
      await sleep(4000)
    }
  }
}

function schemaFiles() {
  return fs
    .readdirSync(schemaDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => path.join(schemaDir, name))
}

async function backfillOrganizations() {
  await pool.query(`
    insert into organizations (connection_id, name, url)
    select distinct on (c.portal_url)
      c.id,
      c.name,
      c.portal_url
    from connections c
    where not exists (
      select 1 from organizations o where o.url = c.portal_url
    )
    order by c.portal_url, c.created_at asc
    on conflict (url) do nothing
  `)
}

export async function ensureOrganization(portalUrl: string, name: string, connectionId: string) {
  const result = await pool.query<{ org_id: string }>(
    `
    insert into organizations (connection_id, name, url)
    values ($1, $2, $3)
    on conflict (url) do update
      set updated_at = now(),
          connection_id = coalesce(organizations.connection_id, excluded.connection_id)
    returning org_id
    `,
    [connectionId, name, portalUrl],
  )
  return result.rows[0].org_id
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
