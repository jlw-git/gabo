#!/usr/bin/env node
// Audits the chope_url field on every dining venue in the catalog.
// Reports: ok / not-found / redirected / placeholder. Outputs CSV to stdout
// so you can spreadsheet-edit the curated overrides.
//
// Run:    node scripts/audit-chope-urls.mjs > chope-audit.csv
// Notes:  Ignores events (no Chope booking). Doesn't write to Supabase.

import { catalog } from '../lib/venues/catalog.ts'

const CONCURRENCY = 6
const TIMEOUT_MS = 8000

const dining = catalog.filter((v) => !v.cuisine_tags.includes('experience'))

async function probe(url) {
  if (!url) return { status: 'missing', code: null, redirected_to: null }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 GaboAudit/1.0' },
    })
    clearTimeout(t)
    if (res.status === 404) return { status: 'not_found', code: 404, redirected_to: null }
    if (res.status >= 400) return { status: 'http_error', code: res.status, redirected_to: null }
    if (res.url !== url) return { status: 'redirected', code: res.status, redirected_to: res.url }
    return { status: 'ok', code: res.status, redirected_to: null }
  } catch (err) {
    return { status: 'error', code: null, redirected_to: String(err.message ?? err) }
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const idx = i++
        if (idx >= items.length) return
        out[idx] = await fn(items[idx], idx)
      }
    })
  )
  return out
}

console.log('venue_id,name,chope_url,status,http_code,redirected_to,suggested_google_search')
const results = await pool(dining, CONCURRENCY, async (v) => {
  const r = await probe(v.chope_url)
  return { v, ...r }
})

for (const { v, status, code, redirected_to } of results) {
  const fallback = `https://www.google.com/search?q=${encodeURIComponent(v.name + ' singapore reservation')}`
  const cells = [
    v.id,
    JSON.stringify(v.name),
    v.chope_url ?? '',
    status,
    code ?? '',
    redirected_to ?? '',
    fallback,
  ]
  console.log(cells.join(','))
}

const summary = results.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1
  return acc
}, {})
console.error('\nSummary:', JSON.stringify(summary, null, 2))
