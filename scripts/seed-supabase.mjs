#!/usr/bin/env node
// One-shot seed into Supabase via the REST API using the service_role key.
// Requires Node ≥ 22 for --experimental-strip-types (tested on Node 25).
//
// Run: node --experimental-strip-types scripts/seed-supabase.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Load .env.local manually so we don't need an extra dep.
const envContent = readFileSync(join(root, '.env.local'), 'utf8')
const env = Object.fromEntries(
  envContent
    .split('\n')
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const url = env.SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// Import the TS catalog directly (Node strips types at runtime).
const { catalog } = await import(join(root, 'lib/venues/catalog.ts'))
const rows = catalog.map((venue) => {
  const row = { ...venue }
  delete row.id
  return row
})

// 1. Wipe existing venues so reruns don't duplicate.
const del = await fetch(`${url}/rest/v1/venues?id=not.is.null`, {
  method: 'DELETE',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: 'return=minimal',
  },
})
console.log(`reset: HTTP ${del.status}`)

// 2. Insert fresh catalog.
const res = await fetch(`${url}/rest/v1/venues`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify(rows),
})

const text = await res.text()
console.log(`insert: HTTP ${res.status}`)
if (!res.ok) {
  console.error(text)
  process.exit(1)
}

try {
  const inserted = JSON.parse(text)
  console.log(`inserted ${inserted.length} venues:`)
  inserted.forEach((v) => console.log(`  · ${v.name}`))
} catch {
  console.log(text)
}
