#!/usr/bin/env node
// Cross-source dedup audit for the dining catalog.
//
// After a /api/cron/sync-dining run, some Google Places + Foursquare rows
// will refer to the same real-world restaurants that already exist as
// editorial (blog-scanner) rows. We do NOT auto-merge in the DB — keeping
// per-source rows preserves provenance for badge attribution. Dedup
// happens at PRESENTATION time in lib/planner/score.ts#dedupeByVenue
// (normalised name + ~200 m coordinate bucket).
//
// This script verifies that pairing is working by listing every
// Google/Foursquare row that has a coordinate-and-name-matching editorial
// row in the catalog. The output is a CSV the user can spot-check.
//
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local (loaded
// via `node --env-file`). Read-only — never writes to the DB.
//
// Usage:
//   node --env-file=.env.local scripts/audit-dining-dedup.mjs > dedup-audit.csv

import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required. Use --env-file=.env.local.')
  process.exit(2)
}

const supabase = createClient(URL, KEY)

// Same bucket size as lib/planner/score.ts (~220 m at SG latitude). Two
// rows whose lat/lng both round to the same bucketed pair AND whose names
// normalise the same will collapse at planner output.
const COORD_BUCKET_DEG = 0.002

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function bucketKey(lat, lng) {
  const a = Math.round(lat / COORD_BUCKET_DEG)
  const b = Math.round(lng / COORD_BUCKET_DEG)
  return `${a},${b}`
}

// Approx great-circle distance in metres. Used purely for CSV display so
// the user can sanity-check borderline matches.
function distMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

async function main() {
  // Load every active venue. The catalog is small (low thousands) so a
  // single pull beats round-tripping per row.
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, lat, lng, source, source_id')
    .eq('active', true)
  if (error) throw new Error(`supabase: ${error.message}`)

  const venues = data ?? []
  const editorial = venues.filter((v) => v.source === 'editorial')
  const api = venues.filter((v) => v.source === 'google_places' || v.source === 'foursquare')

  // Index editorial rows by bucket so we can look up neighbours quickly.
  // A bucket can contain multiple editorial rows (cross-blog duplicates,
  // which is normal — they collapse at planner output).
  const byBucket = new Map()
  for (const v of editorial) {
    const k = bucketKey(v.lat, v.lng)
    if (!byBucket.has(k)) byBucket.set(k, [])
    byBucket.get(k).push(v)
  }

  console.log(
    [
      'api_id',
      'api_source',
      'api_name',
      'blog_id',
      'blog_source_id',
      'blog_name',
      'distance_m',
      'name_match',
    ].join(',')
  )

  let pairs = 0
  for (const a of api) {
    const candidates = byBucket.get(bucketKey(a.lat, a.lng)) ?? []
    if (candidates.length === 0) continue
    const aNorm = normalizeName(a.name)
    for (const b of candidates) {
      const bNorm = normalizeName(b.name)
      // Exact normalised match OR one is a prefix/substring of the other.
      // The latter catches cases like "Burnt Ends" (API) vs "Burnt Ends —
      // Restaurant Review" (blog row name).
      const exact = aNorm === bNorm
      const subset =
        aNorm.length >= 4 && bNorm.length >= 4 && (aNorm.includes(bNorm) || bNorm.includes(aNorm))
      if (!exact && !subset) continue
      pairs++
      const d = distMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng })
      console.log(
        [
          a.id,
          a.source,
          csvField(a.name),
          b.id,
          csvField(b.source_id ?? ''),
          csvField(b.name),
          d,
          exact ? 'exact' : 'subset',
        ].join(',')
      )
    }
  }

  console.error(`\nAudit done.`)
  console.error(`  api rows checked:      ${api.length}`)
  console.error(`  editorial rows in db:  ${editorial.length}`)
  console.error(`  cross-source pairs:    ${pairs}`)
  console.error(
    `  pair rate:             ${api.length > 0 ? ((100 * pairs) / api.length).toFixed(1) : '0'}% of api rows have a blog match`
  )
  console.error(`\nExpected: low rate (most API rows are bigger/more obvious venues than blog picks).`)
  console.error(`If pair rate > 30%, dedup at planner output is doing real work — verify a sample plan.`)
}

function csvField(s) {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
