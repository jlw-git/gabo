// Dining catalog sync. Pulls real SG restaurant data from Google Places,
// falls back to Foursquare on quota / auth failure (per-query basis), dedupes
// across queries, and upserts to Supabase using (source, source_id) as the
// idempotency key.
//
// Run via /api/cron/sync-dining (scheduled in vercel.json) or manually.

import { createClient } from '@/lib/supabase/server'
import {
  GooglePlacesAuthError,
  GooglePlacesQuotaError,
  googlePlaceToVenue,
  textSearch as googleTextSearch,
} from './google-places'
import {
  FoursquareAuthError,
  FoursquareQuotaError,
  foursquarePlaceToVenue,
  searchPlaces as foursquareSearch,
} from './foursquare'

// Cuisine matrix — one search per cuisine. Each query returns up to 20
// results from the API; after dedup and quality filtering we typically end
// up with 80-150 unique venues.
const DINING_QUERIES: { query: string; tag: string }[] = [
  { query: 'japanese restaurant singapore', tag: 'japanese' },
  { query: 'omakase singapore', tag: 'japanese' },
  { query: 'italian restaurant singapore', tag: 'italian' },
  { query: 'chinese restaurant singapore', tag: 'chinese' },
  { query: 'korean bbq singapore', tag: 'korean' },
  { query: 'thai restaurant singapore', tag: 'thai' },
  { query: 'indian restaurant singapore', tag: 'indian' },
  { query: 'french restaurant singapore', tag: 'french' },
  { query: 'spanish tapas singapore', tag: 'spanish' },
  { query: 'mediterranean restaurant singapore', tag: 'mediterranean' },
  { query: 'middle eastern restaurant singapore', tag: 'middle_eastern' },
  { query: 'vietnamese restaurant singapore', tag: 'vietnamese' },
  { query: 'modern european singapore', tag: 'modern_european' },
  { query: 'cocktail bar singapore', tag: 'cocktail' },
  { query: 'wine bar singapore', tag: 'cocktail' },
  { query: 'cafe singapore', tag: 'cafe' },
  { query: 'peranakan restaurant singapore', tag: 'peranakan' },
  { query: 'mexican restaurant singapore', tag: 'mexican' },
]

// Quality filter — Google's rating/count thresholds for what makes the
// catalog. Foursquare ratings aren't comparable so we apply a separate
// (looser) threshold.
const MIN_GOOGLE_RATING = 4.0
const MIN_GOOGLE_RATING_COUNT = 100
const MIN_FOURSQUARE_RATING = 7.5 // Foursquare is 0-10

export type DiningSyncSummary = {
  refreshed_at: string
  queries_run: number
  google_used: number
  foursquare_used: number
  google_failures: { query: string; reason: string }[]
  raw_results: number
  after_quality_filter: number
  after_dedup: number
  upserted: number
  errors: string[]
}

type AnyVenue = ReturnType<typeof googlePlaceToVenue> | ReturnType<typeof foursquarePlaceToVenue>

export async function syncDiningCatalog(): Promise<DiningSyncSummary> {
  const summary: DiningSyncSummary = {
    refreshed_at: new Date().toISOString(),
    queries_run: 0,
    google_used: 0,
    foursquare_used: 0,
    google_failures: [],
    raw_results: 0,
    after_quality_filter: 0,
    after_dedup: 0,
    upserted: 0,
    errors: [],
  }

  const collected: { venue: AnyVenue; tag: string }[] = []

  for (const { query, tag } of DINING_QUERIES) {
    summary.queries_run += 1
    try {
      const places = await googleTextSearch(query, 20)
      summary.google_used += 1
      for (const p of places) {
        if (!meetsGoogleQualityBar(p)) continue
        collected.push({ venue: googlePlaceToVenue(p), tag })
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown'
      summary.google_failures.push({ query, reason })

      // Fall back to Foursquare on quota / auth issues. Other errors
      // (network blip, transient 5xx) we just skip the query.
      const isFallbackable = err instanceof GooglePlacesQuotaError || err instanceof GooglePlacesAuthError
      if (!isFallbackable) continue

      try {
        const places = await foursquareSearch(query, 20)
        summary.foursquare_used += 1
        for (const p of places) {
          if (!meetsFoursquareQualityBar(p)) continue
          collected.push({ venue: foursquarePlaceToVenue(p), tag })
        }
      } catch (fsqErr) {
        if (fsqErr instanceof FoursquareAuthError || fsqErr instanceof FoursquareQuotaError) {
          summary.errors.push(`Both providers down for "${query}": ${reason} | ${(fsqErr as Error).message}`)
        } else {
          summary.errors.push(`Foursquare error for "${query}": ${(fsqErr as Error).message}`)
        }
      }
    }
  }

  summary.raw_results = collected.length

  // Inject the cuisine tag from the search query into cuisine_tags (Google's
  // `types` is too coarse on its own).
  for (const c of collected) {
    if (!c.venue.cuisine_tags.includes(c.tag)) c.venue.cuisine_tags.push(c.tag)
  }

  summary.after_quality_filter = collected.length

  // Dedup by source_id. Same venue returned by multiple queries: merge cuisine
  // tags, keep first occurrence's other fields.
  const byKey = new Map<string, AnyVenue>()
  for (const { venue } of collected) {
    const key = `${venue.source}:${venue.source_id}`
    const existing = byKey.get(key)
    if (existing) {
      const merged = new Set([...existing.cuisine_tags, ...venue.cuisine_tags])
      existing.cuisine_tags = [...merged]
    } else {
      byKey.set(key, venue)
    }
  }
  const deduped = [...byKey.values()]
  summary.after_dedup = deduped.length

  // Upsert into Supabase.
  const supabase = await createClient()
  const chunkSize = 50
  for (let i = 0; i < deduped.length; i += chunkSize) {
    const chunk = deduped.slice(i, i + chunkSize)
    const { error, count } = await supabase
      .from('venues')
      .upsert(chunk, { onConflict: 'source,source_id', count: 'exact' })
    if (error) {
      summary.errors.push(`upsert chunk ${i}: ${error.message}`)
    } else {
      summary.upserted += count ?? chunk.length
    }
  }

  return summary
}

function meetsGoogleQualityBar(p: { rating?: number; rating_count?: number }): boolean {
  if (!p.rating || p.rating < MIN_GOOGLE_RATING) return false
  if (!p.rating_count || p.rating_count < MIN_GOOGLE_RATING_COUNT) return false
  return true
}

function meetsFoursquareQualityBar(p: { rating?: number }): boolean {
  if (!p.rating || p.rating < MIN_FOURSQUARE_RATING) return false
  return true
}
