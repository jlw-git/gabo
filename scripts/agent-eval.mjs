#!/usr/bin/env node
// Ranker A/B harness for Gabo. Runs each fixture in scripts/agent-eval-fixtures.json
// against /api/plan on a configurable base URL and persists the JSON result so
// two runs (ranker on, ranker off) can be diffed offline.
//
// Why offline diff: env flags (AGENTIC_RANKER_ENABLED, AGENTIC_PLAN_ENABLED)
// only take effect in the server process. Toggling them mid-script is not
// possible. The workflow is:
//
//   1. Deploy a Vercel preview with AGENTIC_RANKER_ENABLED=true. Take its URL.
//   2. Deploy a Vercel preview with AGENTIC_RANKER_ENABLED unset. Take its URL.
//   3. node scripts/agent-eval.mjs capture --base-url=<on-url>  --label=on
//   4. node scripts/agent-eval.mjs capture --base-url=<off-url> --label=off
//   5. node scripts/agent-eval.mjs diff --a=on --b=off
//
// Outputs are written to scripts/agent-eval-out/<label>.json (gitignored).
//
// Usage:
//   node scripts/agent-eval.mjs capture --base-url=URL --label=NAME [--fixtures=path]
//   node scripts/agent-eval.mjs diff --a=LABEL --b=LABEL

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, 'agent-eval-out')
const DEFAULT_FIXTURES = join(__dirname, 'agent-eval-fixtures.json')

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]

if (cmd === 'capture') {
  await capture(args)
} else if (cmd === 'diff') {
  await diff(args)
} else {
  printUsage()
  process.exit(1)
}

async function capture(args) {
  const baseUrl = args['base-url']
  const label = args.label
  const fixturesPath = args.fixtures ?? DEFAULT_FIXTURES
  if (!baseUrl || !label) {
    console.error('capture requires --base-url=URL --label=NAME')
    process.exit(2)
  }

  const fixturesRaw = await readFile(fixturesPath, 'utf8')
  const { fixtures } = JSON.parse(fixturesRaw)
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    console.error(`No fixtures in ${fixturesPath}`)
    process.exit(2)
  }

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true })

  const results = []
  for (const fx of fixtures) {
    process.stdout.write(`POST ${fx.name} ... `)
    const started = Date.now()
    let payload
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fx.request),
      })
      const elapsed = Date.now() - started
      const body = await res.text()
      try {
        payload = { ok: res.ok, status: res.status, elapsed_ms: elapsed, body: JSON.parse(body) }
      } catch {
        payload = { ok: res.ok, status: res.status, elapsed_ms: elapsed, body }
      }
      console.log(`${res.status} (${elapsed}ms)`)
    } catch (err) {
      console.log(`FAIL ${err.message}`)
      payload = { ok: false, error: err.message }
    }
    results.push({ name: fx.name, payload })
  }

  const out = {
    label,
    base_url: baseUrl,
    captured_at: new Date().toISOString(),
    results,
  }
  const outPath = join(OUT_DIR, `${label}.json`)
  await writeFile(outPath, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${outPath}`)
}

async function diff(args) {
  const aLabel = args.a
  const bLabel = args.b
  if (!aLabel || !bLabel) {
    console.error('diff requires --a=LABEL --b=LABEL')
    process.exit(2)
  }
  const aPath = join(OUT_DIR, `${aLabel}.json`)
  const bPath = join(OUT_DIR, `${bLabel}.json`)
  if (!existsSync(aPath) || !existsSync(bPath)) {
    console.error(`Need both ${aPath} and ${bPath} — run capture for each label first`)
    process.exit(2)
  }
  const aDoc = JSON.parse(await readFile(aPath, 'utf8'))
  const bDoc = JSON.parse(await readFile(bPath, 'utf8'))

  console.log(`Comparing ${aLabel} (${aDoc.base_url}) vs ${bLabel} (${bDoc.base_url})\n`)

  const byNameB = new Map(bDoc.results.map((r) => [r.name, r]))
  const report = []
  let aggTop1Stable = 0
  let aggHasRankReason = 0
  let aggTotal = 0

  for (const { name, payload: aPayload } of aDoc.results) {
    const bResult = byNameB.get(name)
    if (!bResult) {
      report.push({ name, error: 'missing in b' })
      continue
    }
    const aBuckets = aPayload?.body?.buckets
    const bBuckets = bResult.payload?.body?.buckets
    if (!aBuckets || !bBuckets) {
      report.push({ name, error: 'no buckets' })
      continue
    }
    const aMeta = aPayload?.body?.meta ?? {}
    const bMeta = bResult.payload?.body?.meta ?? {}

    const diningTop3A = topN(aBuckets.dining, 3)
    const diningTop3B = topN(bBuckets.dining, 3)
    const eventsTop3A = topN(aBuckets.events, 3)
    const eventsTop3B = topN(bBuckets.events, 3)

    const diningTop1Stable = diningTop3A[0] && diningTop3A[0] === diningTop3B[0]
    const eventsTop1Stable =
      (!diningTop3A[0] && !diningTop3B[0]) ||
      (eventsTop3A[0] && eventsTop3A[0] === eventsTop3B[0])
    const top1Stable = Boolean(diningTop1Stable) && Boolean(eventsTop1Stable)

    const diningOverlap = countOverlap(diningTop3A, diningTop3B)
    const eventsOverlap = countOverlap(eventsTop3A, eventsTop3B)

    const cardsWithRankReason = [
      ...(aBuckets.dining ?? []),
      ...(aBuckets.events ?? []),
      ...(bBuckets.dining ?? []),
      ...(bBuckets.events ?? []),
    ].filter((c) => typeof c?.rank_reason === 'string' && c.rank_reason.length > 0).length

    aggTotal++
    if (top1Stable) aggTop1Stable++
    if (cardsWithRankReason > 0) aggHasRankReason++

    report.push({
      name,
      top1_stable: top1Stable,
      dining_top3_overlap: diningOverlap,
      events_top3_overlap: eventsOverlap,
      cards_with_rank_reason: cardsWithRankReason,
      ranker_meta: {
        a: aMeta.ranker,
        b: bMeta.ranker,
      },
      relaxation_meta: {
        a: aMeta.agent_relaxation ?? null,
        b: bMeta.agent_relaxation ?? null,
      },
      elapsed_ms: { a: aPayload?.elapsed_ms, b: bResult.payload?.elapsed_ms },
    })
  }

  for (const r of report) {
    console.log(JSON.stringify(r, null, 2))
  }

  console.log('\n=== Summary ===')
  console.log(`Fixtures compared: ${aggTotal}`)
  console.log(
    `Top-1 stable: ${aggTop1Stable}/${aggTotal} (${pct(aggTop1Stable, aggTotal)}) — rollout gate: ≥80%`
  )
  console.log(
    `Fixtures with ≥1 rank_reason: ${aggHasRankReason}/${aggTotal} (${pct(aggHasRankReason, aggTotal)}) — rollout gate: ≥70%`
  )
}

function topN(arr, n) {
  if (!Array.isArray(arr)) return []
  return arr.slice(0, n).map((c) => c?.id ?? '?')
}

function countOverlap(a, b) {
  const setB = new Set(b)
  return a.filter((x) => setB.has(x)).length
}

function pct(n, d) {
  if (!d) return '—'
  return `${((100 * n) / d).toFixed(0)}%`
}

function parseArgs(argv) {
  const out = { _: [] }
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      out[k] = v ?? true
    } else {
      out._.push(a)
    }
  }
  return out
}

function printUsage() {
  console.log(`Ranker A/B harness for Gabo /api/plan

  capture: hit /api/plan with each fixture; save JSON.
    node scripts/agent-eval.mjs capture --base-url=URL --label=NAME [--fixtures=path]

  diff: compare two previously-captured runs.
    node scripts/agent-eval.mjs diff --a=LABEL --b=LABEL
`)
}
