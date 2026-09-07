// Network-isolated tests. Run: node --test scripts/test-catalogue-refresh-worker.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')

function loadTs(file, dependencies = {}, globals = {}) {
  const filename = resolve(root, file)
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  })
  const compiledModule = { exports: {} }
  runInNewContext(outputText, {
    module: compiledModule,
    exports: compiledModule.exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    Date, Intl, Set, Map, URL, AbortSignal, AbortController, setTimeout, clearTimeout,
    console,
    process: { env: { GOOGLE_GEMINI_API_KEY: 'unit-test-key' } },
    fetch: () => { throw new Error('Unmocked network access') },
    ...globals,
  }, { filename })
  return compiledModule.exports
}

function event(index = 0) {
  const today = new Date()
  const nextWeek = new Date(today.getTime() + 7 * 86_400_000)
  return {
    name: `Current event ${index}`,
    source_url: `https://example.com/event-${index}`,
    venue_name: 'Test venue',
    venue_address: '1 Singapore Road',
    starts_at: today.toISOString().slice(0, 10),
    ends_at: nextWeek.toISOString().slice(0, 10),
    category_tags: ['art'],
  }
}

function workerFixture({ output = '[]', completion, sourceStatus = 200, locationError, dbError } = {}) {
  const calls = { completions: [], sources: [], locations: [], upserts: [] }
  const discovery = loadTs('lib/sources/fresh-event-discovery.ts', {
    '@/lib/agents/models': { EXTRACTION_MODEL: 'gemini-2.5-flash' },
    '@/lib/agents/provider': {
      chatComplete: async (options) => {
        calls.completions.push(options)
        return completion ? completion(options) : output
      },
    },
    '@/lib/onemap/client': {
      searchPlaces: async (...args) => {
        calls.locations.push(args)
        if (locationError) throw new Error(locationError)
        return [{ lat: 1.3, lng: 103.8, address: '1 Singapore Road' }]
      },
    },
  }, {
    fetch: async (...args) => {
      calls.sources.push(args)
      return new Response('', { status: sourceStatus })
    },
  })
  const worker = loadTs('lib/catalogue/refresh-worker.ts', {
    '@/lib/sources/fresh-event-discovery': discovery,
    '@/lib/sources/editorial-events': loadTs('lib/sources/editorial-events.ts'),
    '@/lib/supabase/server': {
      createServiceRoleClient: () => ({
        from(table) {
          assert.equal(table, 'venues')
          return {
            upsert(rows, options) {
              calls.upserts.push({ rows, options })
              return {
                async abortSignal(signal) {
                  assert.ok(signal instanceof AbortSignal)
                  return { error: dbError ? { message: dbError } : null, count: rows.length }
                },
              }
            },
          }
        },
      }),
    },
  })
  return { ...worker, ...discovery, calls }
}

test('one paid call and ten candidates despite oversized model output', async () => {
  const fixture = workerFixture({ output: JSON.stringify(Array.from({ length: 50 }, (_, i) => event(i))) })
  const summary = await fixture.runBoundedCatalogueRefresh()
  assert.equal(summary.scope, 'fresh-events')
  assert.equal(summary.upserted, 10)
  assert.equal(fixture.calls.completions.length, 1)
  assert.equal(fixture.calls.completions[0].singleAttempt, true)
  assert.equal(fixture.calls.completions[0].feature, 'catalogue-refresh')
  assert.equal(fixture.calls.completions[0].maxOutputTokens, 4096)
  assert.equal(fixture.calls.completions[0].thinkingBudget, 1024)
  assert.equal(fixture.calls.sources.length, 10)
  assert.equal(fixture.calls.locations.length, 10)
  assert.equal(fixture.calls.upserts.length, 1)
  assert.equal(fixture.calls.upserts[0].options.onConflict, 'source,source_id')
  assert.equal(fixture.calls.upserts[0].rows[0].source, 'editorial')
  assert.match(fixture.calls.upserts[0].rows[0].source_id, /^discovered-/)
  assert.ok(fixture.calls.sources.every(([, options]) => options.signal instanceof AbortSignal))
  assert.ok(fixture.calls.locations.every(([, , signal]) => signal instanceof AbortSignal))
})

test('a valid empty array completes without any verification or database write', async () => {
  const fixture = workerFixture()
  assert.equal((await fixture.runBoundedCatalogueRefresh()).upserted, 0)
  assert.equal(fixture.calls.sources.length, 0)
  assert.equal(fixture.calls.upserts.length, 0)
})

for (const output of ['', 'provider unavailable', '[{bad json}]', '{}', '[{}]', 'error []']) {
  test(`invalid provider output fails without marking a successful empty refresh: ${JSON.stringify(output)}`, async () => {
    const fixture = workerFixture({ output })
    await assert.rejects(fixture.runBoundedCatalogueRefresh(), /Fresh-event discovery/)
    assert.equal(fixture.calls.sources.length, 0)
    assert.equal(fixture.calls.upserts.length, 0)
  })
}

test('provider exception propagates as refresh failure', async () => {
  const fixture = workerFixture({ completion: () => { throw new Error('provider failed') } })
  await assert.rejects(fixture.runBoundedCatalogueRefresh(), /provider failed/)
  assert.equal(fixture.calls.upserts.length, 0)
})

test('source outage fails without writing partially verified data', async () => {
  const fixture = workerFixture({ output: JSON.stringify([event()]), sourceStatus: 503 })
  await assert.rejects(fixture.runBoundedCatalogueRefresh(), /verification failed \(503\)/)
  assert.equal(fixture.calls.upserts.length, 0)
})

test('rejecting every proposed event is a failed refresh, not fresh empty content', async () => {
  const fixture = workerFixture({ output: JSON.stringify([event()]), sourceStatus: 404 })
  await assert.rejects(fixture.runBoundedCatalogueRefresh(), /could not verify any proposed events/)
  assert.equal(fixture.calls.upserts.length, 0)
})

test('normalised source-id collisions produce a single upsert row', async () => {
  const events = [{ ...event(), name: 'Art / Music' }, { ...event(), name: 'Art - Music' }]
  const fixture = workerFixture({ output: JSON.stringify(events) })
  assert.equal((await fixture.runBoundedCatalogueRefresh()).upserted, 1)
  assert.equal(fixture.calls.upserts[0].rows.length, 1)
})

test('location outage fails instead of treating the catalogue as fresh', async () => {
  const fixture = workerFixture({ output: JSON.stringify([event()]), locationError: 'OneMap timeout' })
  await assert.rejects(fixture.runBoundedCatalogueRefresh(), /OneMap timeout/)
  assert.equal(fixture.calls.upserts.length, 0)
})

test('database write failure propagates', async () => {
  const fixture = workerFixture({ output: JSON.stringify([event()]), dbError: 'database unavailable' })
  await assert.rejects(fixture.runBoundedCatalogueRefresh(), /Catalogue refresh upsert failed/)
})

test('an aborted discovery cannot start paid work', async () => {
  const fixture = workerFixture()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fixture.discoverFreshEvents(new Date(), { strict: true, signal: controller.signal }))
  assert.equal(fixture.calls.completions.length, 0)
})

function providerFixture(genai, globals) {
  return loadTs('lib/agents/provider.ts', {
    '@google/genai': genai,
    '@/lib/agents/models': { OPENROUTER_FALLBACK_MODEL: '' },
    '@/lib/agents/gemini-usage-log': { recordGeminiUsage: async () => {} },
  }, globals)
}

test('bounded provider opts out of SDK retries at client and request levels', async () => {
  const clients = []
  const requests = []
  class GoogleGenAI {
    constructor(options) {
      clients.push(options)
      this.models = { generateContent: async (request) => { requests.push(request); return { text: '[]' } } }
    }
  }
  const provider = providerFixture({ GoogleGenAI })
  assert.equal(await provider.chatComplete({ model: 'gemini-2.5-flash', prompt: 'test', grounded: true, singleAttempt: true, maxOutputTokens: 4096, thinkingBudget: 1024 }), '[]')
  assert.equal(clients[0].httpOptions.retryOptions.attempts, 1)
  assert.equal(requests[0].config.httpOptions.retryOptions.attempts, 1)
  assert.equal(requests[0].config.maxOutputTokens, 4096)
  assert.equal(requests[0].config.thinkingConfig.thinkingBudget, 1024)
  assert.ok(requests[0].config.abortSignal instanceof AbortSignal)
  await provider.chatComplete({ model: 'gemini-2.5-flash', prompt: 'test' })
  assert.equal(clients[1].httpOptions, undefined)
})

test('installed Gemini SDK makes only one HTTP attempt on a retryable response', async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({ error: { message: 'Unavailable' } }), { status: 503 })
  }
  try {
    const provider = providerFixture(require('@google/genai'))
    assert.equal(await provider.chatComplete({ model: 'gemini-2.5-flash', prompt: 'test', grounded: true, singleAttempt: true }), '')
    assert.equal(requests, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('installed Gemini SDK receives cancellation on timeout', async () => {
  const originalFetch = globalThis.fetch
  let requestSignal
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
  }
  try {
    const provider = providerFixture(require('@google/genai'))
    assert.equal(await provider.chatComplete({ model: 'gemini-2.5-flash', prompt: 'test', singleAttempt: true, timeoutMs: 30 }), '')
    assert.equal(requestSignal.aborted, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OneMap abort cancels token exchange and prevents an unauthenticated retry', async () => {
  let requests = 0
  let requestSignal
  const oneMap = loadTs('lib/onemap/client.ts', {
    '@/lib/planner/sg-time': {},
    './cache': { tokenStore: { get: () => null, set: () => {} } },
  }, {
    process: { env: { ONEMAP_EMAIL: 'test@example.com', ONEMAP_PASSWORD: 'test-password' } },
    fetch: async (_url, options) => {
      requests += 1
      requestSignal = options.signal
      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    },
  })
  const controller = new AbortController()
  const pending = oneMap.searchPlaces('Singapore', 1, controller.signal)
  controller.abort()
  await assert.rejects(pending)
  assert.equal(requestSignal.aborted, true)
  assert.equal(requests, 1)
})
