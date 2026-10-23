import fs from 'node:fs'
import pg from 'pg'
import { env, schemaPath } from './env.js'

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
  const sql = fs.readFileSync(schemaPath, 'utf8')
  for (;;) {
    try {
      await pool.query('select 1')
      await pool.query(sql)
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
