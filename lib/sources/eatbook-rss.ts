// Eatbook RSS pipeline — discovers new Singapore restaurant openings.
//
// Data flow:
//   1. Parse Eatbook "new restaurants" + "new cafes" tag feeds (RSS 2.0)
//   2. For each roundup article published in the last LOOKBACK_DAYS:
//        fetch HTML, extract restaurant names from the TOC (#toc_container)
//   3. Resolve each name via Google Places text search (Singapore-biased)
//   4. Validate the result is actually in Singapore
//   5. Skip any Google Place ID already in the venues table
//   6. INSERT new venues with badge:'soft_launch' so they surface in the
//      "New Openings" recommendations rail immediately
//
// Runs weekly via /api/cron/sync-eatbook.
// Does NOT upsert existing rows — existing badges/scores are preserved.

import * as cheerio from 'cheerio'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  GooglePlacesAuthError,
  GooglePlacesQuotaError,
  googlePlaceToVenue,
  textSearch,
} from './google-places'

const EATBOOK_FEEDS = [
  'https://eatbook.sg/tag/new-restaurants/feed',
  'https://eatbook.sg/tag/new-cafes/feed',
]

const LOOKBACK_DAYS = 90
// Rough Singapore bounding box for result validation
const SG = { latMin: 1.15, latMax: 1.48, lngMin: 103.6, lngMax: 104.1 }

// Per-request — AbortSignal.timeout fires from creation time, so a
// module-level signal aborts every fetch once the module has been live
// longer than the timeout.
function fetchOpts(): RequestInit {
  return {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gabo/1.0)' },
    signal: AbortSignal.timeout(15_000),
  }
}

export type EatbookSyncSummary = {
  refreshed_at: string
  articles_scanned: number
  restaurants_extracted: number
  places_resolved: number
  already_in_catalog: number
  inserted: number
  errors: string[]
}

// ─── RSS parsing ──────────────────────────────────────────────────────────────

type RssItem = { url: string; pubDate: Date }

async function fetchFeedItems(feedUrl: string): Promise<RssItem[]> {
  const xml = await fetch(feedUrl, fetchOpts()).then(r => r.text())
  const $ = cheerio.load(xml, { xmlMode: true })
  const cutoff = Date.now() - LOOKBACK_DAYS * 86_400_000
  const items: RssItem[] = []

  $('item').each((_, el) => {
    // <link> in RSS is tricky in cheerio xml mode — grab text sibling of tag
    const rawLink = $(el).children('link').text().trim()
    const guid = $(el).children('guid').text().trim()
    const url = rawLink || guid
    const pubDate = new Date($(el).children('pubDate').text().trim())
    if (!url || isNaN(pubDate.getTime()) || pubDate.getTime() < cutoff) return
    items.push({ url, pubDate })
  })
  return items
}

// ─── Article parsing ──────────────────────────────────────────────────────────
// Eatbook roundup articles use a WordPress TOC plugin (#toc_container).
// Each entry is a numbered anchor: "1. Tonkatsu Daiki"
// The list headings (h3) are the fallback if the TOC isn't present.

function stripLeadingNumber(text: string): string {
  return text.replace(/^\d+\.\s*/, '').trim()
}

async function extractNames(articleUrl: string): Promise<string[]> {
  const html = await fetch(articleUrl, fetchOpts()).then(r => r.text())
  const $ = cheerio.load(html)
  const names: string[] = []

  // Primary: TOC numbered links
  $('#toc_container a').each((_, el) => {
    const text = $(el).text().trim()
    if (/^\d+\./.test(text)) names.push(stripLeadingNumber(text))
  })

  // Fallback: numbered h3 headings inside the article body
  if (names.length === 0) {
    $('article h3, .entry-content h3').each((_, el) => {
      const text = $(el).text().trim()
      if (/^\d+\./.test(text)) names.push(stripLeadingNumber(text))
    })
  }

  return [...new Set(names.filter(Boolean))]
}

// ─── Singapore bounds check ───────────────────────────────────────────────────

function inSingapore(lat: number, lng: number): boolean {
  return lat >= SG.latMin && lat <= SG.latMax && lng >= SG.lngMin && lng <= SG.lngMax
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function syncEatbookNewOpenings(): Promise<EatbookSyncSummary> {
  const summary: EatbookSyncSummary = {
    refreshed_at: new Date().toISOString(),
    articles_scanned: 0,
    restaurants_extracted: 0,
    places_resolved: 0,
    already_in_catalog: 0,
    inserted: 0,
    errors: [],
  }

  // Step 1: collect articles from both feeds, dedup by URL
  const articleMap = new Map<string, Date>()
  for (const feedUrl of EATBOOK_FEEDS) {
    try {
      const items = await fetchFeedItems(feedUrl)
      for (const { url, pubDate } of items) {
        if (!articleMap.has(url)) articleMap.set(url, pubDate)
      }
    } catch (err) {
      summary.errors.push(`feed ${feedUrl}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Step 2: extract restaurant names from each article
  type Candidate = { name: string; pubDate: Date }
  const candidates: Candidate[] = []

  for (const [articleUrl, pubDate] of articleMap) {
    summary.articles_scanned++
    try {
      const names = await extractNames(articleUrl)
      for (const name of names) candidates.push({ name, pubDate })
      summary.restaurants_extracted += names.length
    } catch (err) {
      summary.errors.push(`article ${articleUrl}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (candidates.length === 0) return summary

  // Step 3: resolve candidates via Google Places
  type ResolvedVenue = ReturnType<typeof googlePlaceToVenue> & {
    badge: 'soft_launch'
    badge_meta: { opened: string; reason: string }
    source_id: string
  }
  const resolved: ResolvedVenue[] = []
  const resolvedIds = new Set<string>()

  for (const { name, pubDate } of candidates) {
    try {
      const results = await textSearch(`${name} Singapore`, 1)
      const place = results[0]
      if (!place) continue
      if (!inSingapore(place.lat, place.lng)) continue
      if (resolvedIds.has(place.source_id)) continue
      resolvedIds.add(place.source_id)

      resolved.push({
        ...googlePlaceToVenue(place),
        badge: 'soft_launch',
        badge_meta: {
          opened: pubDate.toISOString().slice(0, 10),
          reason: 'Eatbook new openings',
        },
        source_id: place.source_id,
      })
      summary.places_resolved++
    } catch (err) {
      if (err instanceof GooglePlacesAuthError) throw err
      if (err instanceof GooglePlacesQuotaError) {
        summary.errors.push('Google Places quota reached — stopping early')
        break
      }
      summary.errors.push(`places "${name}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (resolved.length === 0) return summary

  // Step 4: check which Place IDs are already in the venues table
  const supabase = createServiceRoleClient()
  const candidateIds = resolved.map(v => v.source_id)
  const { data: existing } = await supabase
    .from('venues')
    .select('source_id')
    .eq('source', 'google_places')
    .in('source_id', candidateIds)

  const existingIds = new Set((existing ?? []).map((r: { source_id: string }) => r.source_id))
  summary.already_in_catalog = existingIds.size

  // Step 5: INSERT only genuinely new venues (no upsert — preserves existing badges)
  const newVenues = resolved.filter(v => !existingIds.has(v.source_id))
  if (newVenues.length === 0) return summary

  const chunkSize = 20
  for (let i = 0; i < newVenues.length; i += chunkSize) {
    const chunk = newVenues.slice(i, i + chunkSize)
    const { error, count } = await supabase
      .from('venues')
      .insert(chunk, { count: 'exact' })
    if (error) {
      summary.errors.push(`insert chunk ${i}: ${error.message}`)
    } else {
      summary.inserted += count ?? chunk.length
    }
  }

  return summary
}
