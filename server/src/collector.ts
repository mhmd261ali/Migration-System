import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ensureOrganization, pool } from './db.js'
import { collectorDir, env } from './env.js'

// item_details.py reads dependencies for every due item with no time budget; a first
// full read of a large organization can take most of an hour.
const runLimitMs = 90 * 60 * 1000
const logDir = path.join(collectorDir, 'logs')

type Job = {
  connectionId: string
  connectionName: string
  portalUrl: string
  username: string
  password: string
  actor: string
}

function pythonBin() {
  if (process.env.COLLECTOR_PYTHON) return process.env.COLLECTOR_PYTHON
  const venv = process.platform === 'win32'
    ? path.join(collectorDir, '.venv', 'Scripts', 'python.exe')
    : path.join(collectorDir, '.venv', 'bin', 'python')
  return fs.existsSync(venv) ? venv : 'python'
}

function describeRun(
  run: { status: string; summary: { baseline?: boolean; changes?: number } | null } | undefined,
  portalUrl: string,
) {
  if (run?.status !== 'succeeded') return { action: 'collection failed', target: portalUrl }
  if (run.summary?.baseline) return { action: 'collected the organization', target: portalUrl }
  const changes = run.summary?.changes ?? 0
  if (changes === 0) return { action: 'checked the organization', target: `${portalUrl} · no changes` }
  return {
    action: 'updated the organization',
    target: `${portalUrl} · ${changes} ${changes === 1 ? 'change' : 'changes'}`,
  }
}

export async function startCollection(job: Job) {
  const orgId = await ensureOrganization(job.portalUrl, job.connectionName, job.connectionId)

  const running = await pool.query(
    `select run_id from report_runs
     where org_id = $1 and status = 'running' and started_at > now() - make_interval(secs => $2)
     limit 1`,
    [orgId, runLimitMs / 1000],
  )
  if (running.rows[0]) return null

  const created = await pool.query<{ run_id: string }>(
    `insert into report_runs (org_id, connection_id, status, signed_in_username, requested_by)
     values ($1, $2, 'running', $3, $4)
     returning run_id`,
    [orgId, job.connectionId, job.username, job.actor],
  )
  const runId = created.rows[0].run_id

  fs.mkdirSync(logDir, { recursive: true })
  const log = fs.openSync(logPath(runId), 'w')

  // Detached, with stderr in a file rather than a pipe, so the collector keeps
  // running when the API restarts (tsx watch restarts on every source change).
  const child = spawn(pythonBin(), [path.join(collectorDir, 'run.py')], {
    cwd: collectorDir,
    env: { ...process.env, DATABASE_URL: env.databaseUrl, PYTHONIOENCODING: 'utf-8' },
    stdio: ['pipe', 'ignore', log],
    detached: true,
    windowsHide: true,
  })
  fs.closeSync(log)

  if (child.pid) {
    await pool.query(`update report_runs set collector_pid = $2 where run_id = $1`, [runId, child.pid])
  }

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, runLimitMs)

  let settled = false
  const settle = (failure: string | null) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    void finishRun(runId, failure).catch(console.error)
  }

  child.on('error', (error) => settle(`Could not start the collector: ${error.message}`))
  child.on('close', (code) => {
    if (code === 0) return settle(null)
    if (timedOut) {
      const last = logTail(runId)
      return settle(`Stopped after ${runLimitMs / 60000} minutes without finishing.${last ? ` Last step: ${last}` : ''}`)
    }
    settle(logTail(runId) || `Collector exited with code ${code}`)
  })

  child.stdin?.on('error', () => {})
  child.stdin?.end(JSON.stringify({
    run_id: runId,
    org_id: orgId,
    portal_url: job.portalUrl,
    username: job.username,
    password: job.password,
  }))

  return runId
}

export function runReport(orgId: string, kind: 'json' | 'xlsx', rowLimit = 500): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), [path.join(collectorDir, 'report_export.py'), orgId, kind, String(rowLimit)], {
      cwd: collectorDir,
      env: { ...process.env, DATABASE_URL: env.databaseUrl, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    const timer = setTimeout(() => child.kill(), 120_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(stderr.trim().split('\n').pop() || `The report exited with code ${code}.`))
    })
  })
}

// After an API restart: keep watching collectors that are still alive, and fail
// runs whose collector is gone.
export async function recoverRuns() {
  const result = await pool.query<{ run_id: string; collector_pid: number | null; started_at: Date }>(
    `select run_id, collector_pid, started_at from report_runs where status = 'running'`,
  )
  for (const run of result.rows) {
    if (!run.collector_pid || !alive(run.collector_pid)) {
      await finishRun(run.run_id, logTail(run.run_id) || 'The collector stopped before this run finished.')
      continue
    }
    const pid = run.collector_pid
    const deadline = run.started_at.getTime() + runLimitMs
    const watch = setInterval(() => {
      if (alive(pid) && Date.now() < deadline) return
      clearInterval(watch)
      if (alive(pid)) {
        try {
          process.kill(pid)
        } catch {}
      }
      void finishRun(run.run_id, 'The collector did not finish.').catch(console.error)
    }, 5000)
  }
}

async function finishRun(runId: string, failure: string | null) {
  if (failure) {
    await pool.query(
      `update report_runs
       set status = 'failed', finished_at = now(), errors = errors + 1,
           error_details = coalesce(error_details, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('section', 'collection', 'error', $2::text))
       where run_id = $1 and status = 'running'`,
      [runId, failure],
    )
  }
  const outcome = await pool.query<{
    status: string
    summary: { baseline?: boolean; changes?: number } | null
    requested_by: string | null
    url: string
  }>(
    `select r.status, r.summary, r.requested_by, o.url
     from report_runs r join organizations o on o.org_id = r.org_id
     where r.run_id = $1`,
    [runId],
  )
  const run = outcome.rows[0]
  if (!run) return
  const { action, target } = describeRun(run, run.url)
  await pool.query(
    `insert into activity_events (actor, action, target) values ($1, $2, $3)`,
    [run.requested_by ?? 'operator', action, target],
  )
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function logPath(runId: string) {
  return path.join(logDir, `${runId}.log`)
}

function logTail(runId: string) {
  try {
    const text = fs.readFileSync(logPath(runId), 'utf8').trim()
    return text.split('\n').slice(-2).join(' ').slice(-1000)
  } catch {
    return ''
  }
}
