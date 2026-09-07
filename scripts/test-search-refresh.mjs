import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const { refreshCatalogueIfStale, searchRefreshEnabled } = load('../lib/catalogue/refresh.ts', {})

// Execute the real handlers with network dependencies replaced. No API keys or
// live planner calls are needed to verify which requests can schedule spending.
function load(relativePath, mocks, env = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const compiled = { exports: {} }
  const execute = runInNewContext(`(function(require, module, exports) {${outputText}\n})`, {
    console: { warn() {}, error() {} }, process: { env }, AbortSignal,
    Request, Response, ReadableStream, TextEncoder,
  })
  execute((id) => {
    if (!(id in mocks)) throw new Error(`Unexpected dependency: ${id}`)
    return mocks[id]
  }, compiled, compiled.exports)
  return compiled.exports
}

function deps(overrides = {}) {
  return {
    claim: async () => 'token',
    refresh: async () => ({ scope: 'fresh-events', upserted: 1 }),
    finish: async () => true,
    warn() {},
    ...overrides,
  }
}

test('a denied or unavailable claim performs no refresh and no completion', async () => {
  for (const claim of [async () => null, async () => { throw new Error('DB unavailable') }]) {
    await refreshCatalogueIfStale(deps({
      claim,
      refresh: async () => assert.fail('must not spend without a lock'),
      finish: async () => assert.fail('no claim to finish'),
    }))
  }
})

test('refresh failure is recorded without retrying or leaking provider errors', async () => {
  let refreshes = 0
  const finished = []
  await refreshCatalogueIfStale(deps({
    refresh: async () => { refreshes++; throw new Error('secret provider details') },
    finish: async (...args) => { finished.push(args); return true },
  }))
  assert.equal(refreshes, 1)
  assert.equal(finished.length, 1)
  assert.equal(finished[0][0], 'token')
  assert.equal(finished[0][1], false)
  assert.doesNotMatch(JSON.stringify(finished), /secret provider details/)
})

test('success is completed with its original lease token', async () => {
  const finished = []
  await refreshCatalogueIfStale(deps({
    finish: async (...args) => { finished.push(args); return true },
  }))
  assert.deepEqual(finished, [['token', true, { scope: 'fresh-events', upserted: 1 }]])
})

test('expired leases or unavailable completion never cause a second attempt', async () => {
  for (const finish of [async () => false, async () => { throw new Error('unavailable') }]) {
    let refreshes = 0
    await refreshCatalogueIfStale(deps({
      refresh: async () => { refreshes++; return { upserted: 0 } }, finish,
    }))
    assert.equal(refreshes, 1)
  }
})

test('development, previews and explicit opt-outs cannot use the production budget', () => {
  assert.equal(searchRefreshEnabled({ NODE_ENV: 'production' }), true)
  assert.equal(searchRefreshEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'production' }), true)
  for (const flag of ['false', '0', 'OFF', ' false ']) {
    assert.equal(searchRefreshEnabled({ NODE_ENV: 'production', SEARCH_CATALOGUE_REFRESH_ENABLED: flag }), false)
  }
  assert.equal(searchRefreshEnabled({ NODE_ENV: 'development', SEARCH_CATALOGUE_REFRESH_ENABLED: 'true' }), false)
  assert.equal(searchRefreshEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }), false)
})

test('refresh waits for after-response callback; internal samples and incomplete chats skip it', async () => {
  const callbacks = []
  let connections = 0
  const { scheduleCatalogueRefresh } = load('../lib/catalogue/search-refresh.ts', {
    'next/server': { after: (callback) => callbacks.push(callback) },
    '@/lib/supabase/server': { createServiceRoleClient: () => { connections++; return {} } },
    './refresh': { refreshCatalogueIfStale: async () => {}, searchRefreshEnabled },
    './refresh-worker': { runBoundedCatalogueRefresh: async () => ({ upserted: 0 }) },
  }, { NODE_ENV: 'production' })
  const request = new Request('http://localhost/api/plan')
  scheduleCatalogueRefresh(new Request(request, { headers: { 'x-gabo-skip-catalogue-refresh': '1' } }))
  assert.equal(callbacks.length, 0)
  scheduleCatalogueRefresh(request, () => false)
  await callbacks.shift()()
  assert.equal(connections, 0)
  let planned = false
  scheduleCatalogueRefresh(request, () => planned)
  assert.equal(connections, 0)
  planned = true
  await callbacks.shift()()
  assert.equal(connections, 1)
})

test('missing migration and malformed claim responses never reach the paid worker', async () => {
  for (const reply of [{ error: { message: 'missing RPC' } }, { data: 'not-a-token' }, { data: null }]) {
    const callbacks = []
    let refreshed = false
    const { scheduleCatalogueRefresh } = load('../lib/catalogue/search-refresh.ts', {
      'next/server': { after: (callback) => callbacks.push(callback) },
      '@/lib/supabase/server': { createServiceRoleClient: () => ({ rpc: () => ({ abortSignal: async () => reply }) }) },
      './refresh': { refreshCatalogueIfStale, searchRefreshEnabled },
      './refresh-worker': { runBoundedCatalogueRefresh: async () => { refreshed = true; return {} } },
    }, { NODE_ENV: 'production' })
    scheduleCatalogueRefresh(new Request('http://localhost/api/plan'))
    await callbacks[0]()
    assert.equal(refreshed, false)
  }
})

test('normal plan schedules only after a successful response is prepared', async () => {
  let scheduled = 0
  let parsed = true
  let failPlan = false
  class PlanDateError extends Error {}
  const { POST } = load('../app/api/plan/route.ts', {
    'next/server': {},
    '@/lib/planner/request-validation': { parsePlanRequest: () => parsed ? {} : null },
    '@/lib/planner/plan-date': { PlanDateError, planDate: async () => {
      if (failPlan) throw new Error('planner failed')
      return { buckets: {} }
    } },
    '@/lib/catalogue/search-refresh': { scheduleCatalogueRefresh: () => { scheduled++ } },
  })
  const request = (body = '{}') => new Request('http://localhost/api/plan', { method: 'POST', body })
  assert.equal((await POST(request('invalid'))).status, 400)
  parsed = false
  assert.equal((await POST(request())).status, 400)
  parsed = true
  failPlan = true
  assert.equal((await POST(request())).status, 500)
  assert.equal(scheduled, 0)
  failPlan = false
  assert.equal((await POST(request())).status, 200)
  assert.equal(scheduled, 1)
})

test('streamed chat only refreshes when intake actually produced a plan', async () => {
  for (const outcome of ['planned', 'clarification', 'failed']) {
    let eligible
    const { POST } = load('../app/api/plan/chat/route.ts', {
      'next/server': {},
      '@/lib/planner/request-validation': { parsePlanRequest: () => ({ scheduled_for: '' }) },
      '@/lib/agentic-flags': { agenticFlag: () => true },
      '@/lib/agents/conversation': { runIntakeTurn: async () => {
        if (outcome === 'failed') throw new Error('provider failure')
        return { planned: outcome === 'planned', assistantMessage: 'Result', request: {} }
      } },
      '@/lib/catalogue/search-refresh': { scheduleCatalogueRefresh: (_request, check) => { eligible = check } },
    })
    const response = await POST(new Request('http://localhost/api/plan/chat', {
      method: 'POST', body: JSON.stringify({ message: 'Dinner tomorrow' }),
    }))
    await response.text()
    assert.equal(eligible(), outcome === 'planned')
  }
})
