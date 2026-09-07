#!/usr/bin/env node
// Run with: node scripts/test-search-refresh-db.mjs
// Requires initdb, pg_ctl and psql on PATH. Always creates a disposable cluster;
// never reads application credentials or connects to an existing database.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const migration = join(repoRoot, 'supabase/migrations/0010_search_catalog_refresh.sql')
const lifecycleTests = join(repoRoot, 'scripts/test-search-refresh-db.sql')
// Ignore connection/service settings inherited from a developer's environment.
const testEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')))
const activeChildren = new Set()
let clusterRoot

function runSync(binary, args) {
  return execFileSync(binary, args, {
    cwd: repoRoot,
    env: testEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
  }).trim()
}

function runAsync(binary, args) {
  return new Promise((resolveResult, reject) => {
    const child = execFile(binary, args, {
      cwd: repoRoot,
      env: testEnv,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      activeChildren.delete(child)
      if (error) reject(new Error(`${binary} failed: ${stderr || error.message}`))
      else resolveResult(stdout.trim())
    })
    activeChildren.add(child)
  })
}

function cleanup() {
  for (const child of activeChildren) child.kill('SIGTERM')
  if (!clusterRoot) return
  const dataDir = join(clusterRoot, 'data')
  if (existsSync(join(dataDir, 'postmaster.pid'))) {
    try {
      runSync('pg_ctl', ['-D', dataDir, '-w', '-t', '15', 'stop', '-m', 'fast'])
    } catch (error) {
      // Never delete a cluster while its server may still be running.
      console.error(`Could not stop temporary PostgreSQL; retained ${clusterRoot}: ${error.message}`)
      process.exitCode = 1
      return
    }
  }
  rmSync(clusterRoot, { recursive: true, force: true })
  clusterRoot = undefined
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    cleanup()
    process.exit(code)
  })
}

try {
  for (const binary of ['initdb', 'pg_ctl', 'psql']) {
    try {
      runSync(binary, ['--version'])
    } catch {
      throw new Error(`PostgreSQL tests require ${binary} on PATH. Install PostgreSQL server tools and rerun.`)
    }
  }

  // A short path avoids macOS's Unix socket path limit. mkdtemp creates a
  // private directory; listen_addresses is empty so no network port opens.
  clusterRoot = mkdtempSync('/tmp/gabo-refresh-db-')
  const dataDir = join(clusterRoot, 'data')
  runSync('initdb', ['-D', dataDir, '-A', 'trust', '-U', 'gabo_refresh_test', '--no-locale'])
  runSync('pg_ctl', [
    '-D', dataDir, '-l', join(clusterRoot, 'postgres.log'), '-w', '-t', '15',
    '-o', `-h '' -k '${clusterRoot}' -p 55491`, 'start',
  ])
  const psqlArgs = [
    '-X', '-w', '-h', clusterRoot, '-p', '55491', '-U', 'gabo_refresh_test',
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt',
  ]
  const sql = (query) => runSync('psql', [...psqlArgs, '-c', query])
  sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
  runSync('psql', [...psqlArgs, '-f', migration, '-f', lifecycleTests])
  console.log('Database lifecycle and service-role permissions: passed.')

  // Every winner keeps its transaction open briefly so the other connections
  // contend for the same row and recheck the cooldown after it commits.
  const attempts = await Promise.allSettled(Array.from({ length: 32 }, () => runAsync('psql', [
    ...psqlArgs, '-c',
    "BEGIN; SET LOCAL ROLE service_role; SELECT COALESCE(public.claim_catalog_refresh()::text, 'blocked'); SELECT pg_sleep(0.2); COMMIT;",
  ])))
  const connectionErrors = attempts.filter((result) => result.status === 'rejected')
  assert.equal(connectionErrors.length, 0, connectionErrors.map((result) => result.reason.message).join('\n'))
  const results = attempts.map((result) => result.value)
  const winners = results.filter((result) => result !== 'blocked')
  assert.equal(winners.length, 1, `Expected one successful claim; got ${JSON.stringify(results)}`)
  assert.match(winners[0], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  console.log('32 concurrent transactions: one claim, 31 blocked.')

  const beforeReapply = sql('SELECT row_to_json(s)::text FROM public.catalog_refresh_state s')
  runSync('psql', [...psqlArgs, '-f', migration])
  assert.equal(sql('SELECT row_to_json(s)::text FROM public.catalog_refresh_state s'), beforeReapply)
  assert.equal(sql('SET ROLE service_role; SELECT public.claim_catalog_refresh() IS NULL'), 't')
  console.log('Migration reapplication preserves active lease and consumed cooldown: passed.')
} catch (error) {
  console.error(error.stderr?.toString().trim() || error.message)
  process.exitCode = 1
} finally {
  cleanup()
}
