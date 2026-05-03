// Multi-blog scanner for new Singapore restaurant/venue openings.
//
// Runs weekly via /api/cron/sync-blogs. For each configured food blog:
//   1. Fetches the RSS feed and filters posts whose title signals a new opening
//   2. Fetches the article HTML and strips it to plain text
//   3. Sends to Gemini Flash to extract structured venue data
//   4. Validates the address via OneMap to get a confirmed lat/lng
//   5. Upserts to Supabase as source='editorial', badge='soft_launch'
//
// Source IDs: {blog-prefix}-{slugified-venue-name} — idempotent across runs.
// Eatbook is intentionally excluded here; it has its own dedicated sync
// (lib/sources/eatbook-rss.ts) that handles roundup-style articles differently.
//
// Requires: GOOGLE_GEMINI_API_KEY (free at aistudio.google.com)

import * as cheerio from 'cheerio'
import { GoogleGenAI } from '@google/genai'
import { searchPlaces } from '@/lib/onemap/client'
import { createServiceRoleClient } from '@/lib/supabase/server'

// ─── Blog registry ────────────────────────────────────────────────────────────

type BlogConfig = {
  name: string
  prefix: string // short prefix for source_id, e.g. 'sethlui'
  feed: string   // RSS 2.0 feed URL
}

const BLOGS: BlogConfig[] = [
  {
    name: 'Seth Lui',
    prefix: 'sethlui',
    feed: 'https://sethlui.com/feed/',
  },
  {
    name: 'Daniel Food Diary',
    prefix: 'dfd',
    feed: 'https://danielfooddiary.com/feed/',
  },
  {
    name: 'Miss Tam Chiak',
    prefix: 'mtc',
    feed: 'https://www.misstamchiak.com/feed/',
  },
  {
    name: 'Ladyironchef',
    prefix: 'lic',
    feed: 'https://www.ladyironchef.com/feed/',
  },
]

// Regex to identify posts about new openings from the RSS title alone.
const NEW_OPENING_SIGNALS =
  /new\s+(restaurant|café|cafe|bar|bistro|opening|spot|joint)|just\s+opened|first\s+look|now\s+open|soft\s+launch|opens?\s+in\s+singapore|newly\s+opened|grand\s+opening/i

const LOOKBACK_DAYS = 45
const FETCH_OPTS = {
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gabo/1.0)' },
  signal: AbortSignal.timeout(15_000),
}

// Cuisine tags Gemini is allowed to assign (subset of our tag vocabulary).
const CUISINE_TAGS = [
  'japanese', 'korean', 'chinese', 'thai', 'vietnamese', 'indian', 'malay',
  'peranakan', 'italian', 'french', 'spanish', 'mediterranean', 'modern_european',
  'middle_eastern', 'mexican', 'american', 'cafe', 'cocktail', 'brunch',
  'dessert', 'bakery', 'seafood', 'omakase', 'pizza', 'bar',
]

// ─── Types ────────────────────────────────────────────────────────────────────

type ExtractedVenue = {
  name: string
  address: string
  cuisine_tags: string[]
  vibe_tags: string[]
  opens_at: string | null
  photo_url: string | null
}

export type BlogScanSummary = {
  refreshed_at: string
  blogs_scanned: number
  articles_checked: number
  articles_matched: number
  venues_extracted: number
  addresses_validated: number
  already_in_catalog: number
  upserted: number
  errors: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function geminiClient(): GoogleGenAI {
  const key = process.env.GOOGLE_GEMINI_API_KEY
  if (!key) throw new Error('GOOGLE_GEMINI_API_KEY missing')
  return new GoogleGenAI({ apiKey: key })
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

// ─── RSS parsing ──────────────────────────────────────────────────────────────

type RssItem = { title: string; url: string; pubDate: Date }

async function fetchFeedItems(feedUrl: string): Promise<RssItem[]> {
  const xml = await fetch(feedUrl, FETCH_OPTS).then((r) => r.text())
  const $ = cheerio.load(xml, { xmlMode: true })
  const cutoff = Date.now() - LOOKBACK_DAYS * 86_400_000
  const items: RssItem[] = []

  $('item').each((_, el) => {
    const title = $(el).children('title').text().trim()
    const rawLink = $(el).children('link').text().trim()
    const guid = $(el).children('guid').text().trim()
    const url = rawLink || guid
    const pubDate = new Date($(el).children('pubDate').text().trim())
    if (!title || !url || isNaN(pubDate.getTime())) return
    if (pubDate.getTime() < cutoff) return
    items.push({ title, url, pubDate })
  })
  return items
}

// ─── Article text extraction ──────────────────────────────────────────────────

async function fetchArticleText(url: string): Promise<{ text: string; photoUrl: string | null }> {
  const html = await fetch(url, FETCH_OPTS).then((r) => r.text())
  const $ = cheerio.load(html)

  // Remove nav, footer, sidebar, ads, comments
  $('nav, footer, aside, .sidebar, .comments, .related, script, style, [class*="ad"]').remove()

  // Grab first content image (og:image is most reliable)
  const ogImage = $('meta[property="og:image"]').attr('content') ?? null
  const firstImg =
    $('article img, .entry-content img, .post-content img').first().attr('src') ?? null
  const photoUrl = ogImage || firstImg || null

  // Extract article body text
  const body =
    $('article').text() ||
    $('.entry-content, .post-content, .article-body').text() ||
    $('main').text()

  const text = body
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000) // cap tokens — Gemini Flash handles this easily

  return { text, photoUrl }
}

// ─── Gemini extraction ────────────────────────────────────────────────────────

async function extractVenue(
  blog: BlogConfig,
  title: string,
  url: string,
  text: string,
  articlePhotoUrl: string | null
): Promise<ExtractedVenue | null> {
  const ai = geminiClient()

  const prompt = `You are extracting structured data from a Singapore food blog post about a new restaurant or venue opening.

Blog: ${blog.name}
Article title: ${title}
Article URL: ${url}

Article text (truncated):
${text}

If this article reviews or announces a single new Singapore venue, extract:
- name: the venue's full name
- address: the most specific Singapore address mentioned (street + district or postal code)
- cuisine_tags: 1–3 tags from ONLY this list: ${CUISINE_TAGS.join(', ')}
- vibe_tags: 0–2 tags from ONLY: cozy, adventurous, celebratory, low_key
- opens_at: opening date as YYYY-MM-DD, or null if not mentioned
- photo_url: the main food/venue image URL from the article, or null

If this article covers multiple venues (a roundup), return null.
If the venue is not in Singapore, return null.
If there is no new opening (e.g. it's a general guide or ranking), return null.

Return ONLY raw JSON — no markdown, no explanation:
{ "name": "...", "address": "...", "cuisine_tags": [...], "vibe_tags": [...], "opens_at": "...", "photo_url": "..." }
or
null`

  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
  })

  const raw = (result.text ?? '').trim()
  if (raw === 'null' || raw === '') return null

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    if (typeof parsed.name !== 'string' || !parsed.name) return null
    if (typeof parsed.address !== 'string' || !parsed.address) return null

    const cuisine_tags = Array.isArray(parsed.cuisine_tags)
      ? (parsed.cuisine_tags as unknown[])
          .filter((t): t is string => typeof t === 'string' && CUISINE_TAGS.includes(t))
          .slice(0, 3)
      : []

    const vibe_tags = Array.isArray(parsed.vibe_tags)
      ? (parsed.vibe_tags as unknown[])
          .filter((t): t is string =>
            typeof t === 'string' && ['cozy', 'adventurous', 'celebratory', 'low_key'].includes(t)
          )
          .slice(0, 2)
      : []

    const opens_at =
      typeof parsed.opens_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.opens_at)
        ? parsed.opens_at
        : null

    // Prefer article og:image over Gemini's extraction (more reliable)
    const photo_url =
      articlePhotoUrl ??
      (typeof parsed.photo_url === 'string' && parsed.photo_url.startsWith('http')
        ? parsed.photo_url
        : null)

    return { name: parsed.name, address: parsed.address, cuisine_tags, vibe_tags, opens_at, photo_url }
  } catch {
    return null
  }
}

// ─── OneMap address validation ────────────────────────────────────────────────

const SG = { latMin: 1.15, latMax: 1.48, lngMin: 103.6, lngMax: 104.1 }

async function resolveAddress(
  venueName: string,
  address: string
): Promise<{ lat: number; lng: number; resolvedAddress: string } | null> {
  // Try venue name + address first for best precision, fall back to address alone
  const queries = [`${venueName} ${address}`, address]
  for (const q of queries) {
    try {
      const results = await searchPlaces(q, 1)
      const hit = results[0]
      if (!hit) continue
      if (hit.lat < SG.latMin || hit.lat > SG.latMax) continue
      if (hit.lng < SG.lngMin || hit.lng > SG.lngMax) continue
      return { lat: hit.lat, lng: hit.lng, resolvedAddress: hit.address }
    } catch {
      continue
    }
  }
  return null
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function scanBlogs(): Promise<BlogScanSummary> {
  const summary: BlogScanSummary = {
    refreshed_at: new Date().toISOString(),
    blogs_scanned: 0,
    articles_checked: 0,
    articles_matched: 0,
    venues_extracted: 0,
    addresses_validated: 0,
    already_in_catalog: 0,
    upserted: 0,
    errors: [],
  }

  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    summary.errors.push('GOOGLE_GEMINI_API_KEY not set — skipping blog scan')
    return summary
  }

  type VenueRow = {
    source: 'editorial'
    source_id: string
    source_url: string
    name: string
    lat: number
    lng: number
    address: string
    cuisine_tags: string[]
    vibe_tags: string[]
    dietary_flags: []
    budget_band: 2
    is_outdoor: false
    photo_url: string | null
    chope_url: string | null
    hours_json: null
    ph_hours_json: null
    badge: 'soft_launch'
    badge_meta: { opened: string | null; reason: string }
    trending_score: 0
    active: true
    last_synced_at: string
  }

  const toInsert: VenueRow[] = []
  const seenIds = new Set<string>() // dedup within this run

  for (const blog of BLOGS) {
    summary.blogs_scanned++
    let items: RssItem[]

    try {
      items = await fetchFeedItems(blog.feed)
    } catch (err) {
      summary.errors.push(`${blog.name} feed: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    for (const item of items) {
      summary.articles_checked++

      if (!NEW_OPENING_SIGNALS.test(item.title)) continue
      summary.articles_matched++

      let text: string
      let articlePhotoUrl: string | null

      try {
        ;({ text, photoUrl: articlePhotoUrl } = await fetchArticleText(item.url))
      } catch (err) {
        summary.errors.push(
          `${blog.name} "${item.title}": fetch failed — ${err instanceof Error ? err.message : String(err)}`
        )
        continue
      }

      let venue: ExtractedVenue | null
      try {
        venue = await extractVenue(blog, item.title, item.url, text, articlePhotoUrl)
      } catch (err) {
        summary.errors.push(
          `${blog.name} "${item.title}": Gemini error — ${err instanceof Error ? err.message : String(err)}`
        )
        continue
      }

      if (!venue) continue
      summary.venues_extracted++

      const location = await resolveAddress(venue.name, venue.address).catch(() => null)
      if (!location) {
        summary.errors.push(
          `${blog.name} "${venue.name}": OneMap could not resolve "${venue.address}"`
        )
        continue
      }
      summary.addresses_validated++

      const source_id = `${blog.prefix}-${slugify(venue.name)}`
      if (seenIds.has(source_id)) continue
      seenIds.add(source_id)

      toInsert.push({
        source: 'editorial',
        source_id,
        source_url: item.url,
        name: venue.name,
        lat: location.lat,
        lng: location.lng,
        address: location.resolvedAddress,
        cuisine_tags: venue.cuisine_tags,
        vibe_tags: venue.vibe_tags,
        dietary_flags: [],
        budget_band: 2,
        is_outdoor: false,
        photo_url: venue.photo_url,
        chope_url: null,
        hours_json: null,
        ph_hours_json: null,
        badge: 'soft_launch',
        badge_meta: { opened: venue.opens_at ?? item.pubDate.toISOString().slice(0, 10), reason: `${blog.name} new opening` },
        trending_score: 0,
        active: true,
        last_synced_at: new Date().toISOString(),
      })
    }
  }

  if (toInsert.length === 0) return summary

  // Check which source_ids are already in the catalog.
  const supabase = createServiceRoleClient()
  const { data: existing } = await supabase
    .from('venues')
    .select('source_id')
    .eq('source', 'editorial')
    .in('source_id', toInsert.map((v) => v.source_id))

  const existingIds = new Set((existing ?? []).map((r: { source_id: string }) => r.source_id))
  summary.already_in_catalog = existingIds.size

  // Upsert — keeps badge/score if the row already exists, updates address/tags otherwise.
  const chunkSize = 20
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize)
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
