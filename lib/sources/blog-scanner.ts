// Multi-blog scanner for Singapore restaurant/venue posts. Doubles as both
// the soft-launch discovery layer AND a general dining-catalog stopgap when
// the API providers (Google Places / Foursquare) are down.
//
// Runs weekly via /api/cron/sync-blogs. For each configured food blog:
//   1. Fetches the RSS feed (90-day lookback, capped per blog)
//   2. Fetches the article HTML and strips it to plain text
//   3. Sends to Gemini Flash, which returns ALL Singapore venues discussed
//      in the post (single review or roundup) plus an is_new_opening flag
//      per venue
//   4. Validates each address via OneMap to get a confirmed lat/lng
//   5. Upserts each venue as source='editorial', with
//      badge='soft_launch' when is_new_opening=true, else badge='none'
//
// Source IDs: {blog-prefix}-{slugified-venue-name} — idempotent across runs.
// Cross-blog dedup is not handled here (a venue mentioned by Seth Lui and
// DFD ends up as two rows); acceptable for the stopgap.
//
// Eatbook is intentionally excluded; it has its own dedicated sync
// (lib/sources/eatbook-rss.ts).
//
// Requires: GOOGLE_GEMINI_API_KEY (free at aistudio.google.com)

import * as cheerio from 'cheerio'
import { GoogleGenAI } from '@google/genai'
import { searchPlaces } from '@/lib/onemap/client'
import { createServiceRoleClient } from '@/lib/supabase/server'

// ─── Blog registry ────────────────────────────────────────────────────────────
//
// Not all blogs have a working RSS feed. Each config has a `discover()` that
// returns the article list however that blog publishes it:
//   - rssFeed:  classic RSS 2.0 (Sethlui, Ladyironchef)
//   - htmlListing: scrape <a> URLs from a category page (Daniel Food Diary —
//     their /feed/ endpoint is permanently broken)
//   - sitemapUrls: pull <loc> entries from sitemap.xml (Miss Tam Chiak — Gatsby
//     SSG with no RSS plugin enabled)

type RssItem = { title: string; url: string; pubDate: Date }

type BlogConfig = {
  name: string
  prefix: string // short prefix for source_id, e.g. 'sethlui'
  discover: () => Promise<RssItem[]>
}

const BLOGS: BlogConfig[] = [
  {
    name: 'Seth Lui',
    prefix: 'sethlui',
    // Food-section feed only — the main /feed/ surfaces lots of non-food
    // content (lifestyle guides, gift round-ups) that wastes Gemini calls.
    discover: () => fetchFeedItems('https://sethlui.com/section/food/feed/'),
  },
  {
    name: 'Daniel Food Diary',
    prefix: 'dfd',
    // Article URLs follow /YYYY/MM/DD/slug/ — pubDate is parseable from path.
    discover: () =>
      fetchHtmlListing(
        'https://danielfooddiary.com/category/singapore/',
        /^https:\/\/danielfooddiary\.com\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\/$/
      ),
  },
  {
    name: 'Miss Tam Chiak',
    prefix: 'mtc',
    // Sitemap is roughly newest-first; we cap to MAX_ARTICLES_PER_BLOG via
    // the main loop, so older entries simply never get processed.
    discover: () =>
      fetchSitemapItems('https://www.misstamchiak.com/sitemap-0.xml', (u) => {
        // Reject homepage, paginated archive, category roots, tag pages.
        const path = new URL(u).pathname
        if (path === '/' || path === '') return false
        if (/^\/(page|category|tag|author)\//.test(path)) return false
        return true
      }),
  },
  {
    name: 'Ladyironchef',
    prefix: 'lic',
    discover: () => fetchFeedItems('https://www.ladyironchef.com/feed/'),
  },
]

const LOOKBACK_DAYS = 90
// Cap per-blog article count so a backlogged feed can't push the cron past
// the 300s maxDuration. Each article is one Gemini call (~1–3s) plus
// per-venue OneMap lookups.
const MAX_ARTICLES_PER_BLOG = 25
// Per-request — AbortSignal.timeout fires from creation time, so reusing a
// module-level signal aborts every fetch once the module has been live longer
// than the timeout.
function fetchOpts(): RequestInit {
  return {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gabo/1.0)' },
    signal: AbortSignal.timeout(15_000),
  }
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
  is_new_opening: boolean
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
  aged_out: number
  errors: string[]
}

// A blog-discovered venue is "new" only for ~90 days — past that, the hype
// signal has decayed and it's just another spot in the catalog. We use
// last_synced_at as the proxy for "still being talked about": if the scanner
// stopped seeing a venue in feeds for 90 days, its soft_launch badge is stale.
const SOFT_LAUNCH_TTL_DAYS = 90

// Default hours by cuisine — blog posts almost never include opening hours
// in a parseable form, but the planner requires hours_json to surface a
// venue. These are deliberately wide so the planner doesn't filter out a
// venue at a time the venue actually IS open. badge_meta.hours_source =
// 'default' flags this so we can replace later if we add a hours-scraper.
const DEFAULT_HOURS = {
  bar: { open: '1700', close: '2400' },
  cafe: { open: '0900', close: '2100' },
  dining: { open: '1130', close: '2230' },
} as const

function defaultHoursFor(cuisineTags: string[]): { open: string; close: string } {
  if (cuisineTags.some((t) => t === 'bar' || t === 'cocktail')) return DEFAULT_HOURS.bar
  if (cuisineTags.some((t) => t === 'cafe' || t === 'bakery' || t === 'dessert' || t === 'brunch'))
    return DEFAULT_HOURS.cafe
  return DEFAULT_HOURS.dining
}

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
function buildDefaultHoursJson(cuisineTags: string[]) {
  const w = defaultHoursFor(cuisineTags)
  const out: Record<string, { open: string; close: string }[]> = {}
  for (const d of ALL_DAYS) out[d] = [w]
  return out
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

// ─── Article discovery ───────────────────────────────────────────────────────

async function fetchFeedItems(feedUrl: string): Promise<RssItem[]> {
  const xml = await fetch(feedUrl, fetchOpts()).then((r) => r.text())
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

// Scrape <a href> URLs out of a category/listing HTML page. The pattern must
// have YYYY/MM/DD as capture groups 1-3; pubDate is reconstructed from those.
// Title falls back to the URL slug since this is post-regex now (the title
// is just used in error messages and Gemini context).
async function fetchHtmlListing(listingUrl: string, urlPattern: RegExp): Promise<RssItem[]> {
  const html = await fetch(listingUrl, fetchOpts()).then((r) => r.text())
  const $ = cheerio.load(html)
  const cutoff = Date.now() - LOOKBACK_DAYS * 86_400_000
  const seen = new Set<string>()
  const items: RssItem[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const m = href.match(urlPattern)
    if (!m) return
    if (seen.has(href)) return
    seen.add(href)
    const [, y, mo, d, slug] = m
    const pubDate = new Date(`${y}-${mo}-${d}T00:00:00Z`)
    if (isNaN(pubDate.getTime()) || pubDate.getTime() < cutoff) return
    items.push({
      title: slug ? slug.replace(/-/g, ' ') : href,
      url: href,
      pubDate,
    })
  })
  // Newest first.
  return items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
}

// Pull URLs out of a sitemap.xml. Sitemaps may not include <lastmod>, so we
// can't apply the lookback filter — we trust the listing order (sitemaps are
// generally newest-first) and rely on MAX_ARTICLES_PER_BLOG to bound load.
async function fetchSitemapItems(
  sitemapUrl: string,
  filter: (url: string) => boolean
): Promise<RssItem[]> {
  const xml = await fetch(sitemapUrl, fetchOpts()).then((r) => r.text())
  const $ = cheerio.load(xml, { xmlMode: true })
  const items: RssItem[] = []
  $('url').each((_, el) => {
    const url = $(el).children('loc').text().trim()
    if (!url || !filter(url)) return
    const lastmodRaw = $(el).children('lastmod').text().trim()
    const lastmod = lastmodRaw ? new Date(lastmodRaw) : null
    items.push({
      title: new URL(url).pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ?? url,
      url,
      pubDate: lastmod && !isNaN(lastmod.getTime()) ? lastmod : new Date(),
    })
  })
  return items
}

// ─── Article text extraction ──────────────────────────────────────────────────

async function fetchArticleText(
  url: string
): Promise<{ text: string; photoUrl: string | null; imageUrls: string[] }> {
  const html = await fetch(url, fetchOpts()).then((r) => r.text())
  const $ = cheerio.load(html)

  // Remove nav, footer, sidebar, ads, comments
  $('nav, footer, aside, .sidebar, .comments, .related, script, style, [class*="ad"]').remove()

  // Grab first content image (og:image is most reliable for single-venue posts)
  const ogImage = $('meta[property="og:image"]').attr('content') ?? null
  const firstImg =
    $('article img, .entry-content img, .post-content img').first().attr('src') ?? null
  const photoUrl = ogImage || firstImg || null

  // Collect every image URL inside the article body — Gemini gets this list
  // and must PICK from it (eliminates hallucinated URLs on roundup posts).
  const imageSet = new Set<string>()
  $('article img, .entry-content img, .post-content img').each((_, el) => {
    const src =
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-lazy-src') ||
      ''
    if (src.startsWith('http')) imageSet.add(src)
  })
  const imageUrls = [...imageSet].slice(0, 50)

  // Extract article body text
  const body =
    $('article').text() ||
    $('.entry-content, .post-content, .article-body').text() ||
    $('main').text()

  const text = body
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000) // cap tokens — Gemini Flash handles this easily

  return { text, photoUrl, imageUrls }
}

// ─── Gemini extraction ────────────────────────────────────────────────────────

async function extractVenues(
  blog: BlogConfig,
  title: string,
  url: string,
  text: string,
  articlePhotoUrl: string | null,
  articleImageUrls: string[]
): Promise<ExtractedVenue[]> {
  const ai = geminiClient()

  const imageList =
    articleImageUrls.length > 0
      ? articleImageUrls.map((u, i) => `  ${i}: ${u}`).join('\n')
      : '  (no images available)'

  const prompt = `You are extracting structured data from a Singapore food blog post.

Blog: ${blog.name}
Article title: ${title}
Article URL: ${url}

Article text (truncated):
${text}

Available image URLs in this article (you MUST pick photo_url from this list — do not invent URLs):
${imageList}

Return every Singapore restaurant, café, bar, or food venue clearly described in the article — single review OR roundup ("10 best omakase…"). For each venue extract:
- name: the venue's full name
- address: the most specific Singapore address mentioned (street + district or postal code). Skip venues with no concrete address.
- cuisine_tags: 1–3 tags from ONLY this list: ${CUISINE_TAGS.join(', ')}
- vibe_tags: 0–2 tags from ONLY: cozy, adventurous, celebratory, low_key
- opens_at: opening date as YYYY-MM-DD if the article explicitly states one (e.g. "opens 15 March 2026", "soft-launched last week", "just opened in May"). Use null if the article doesn't state an opening date — DO NOT guess from the article's publication date.
- photo_url: the URL most clearly tied to this venue from the list above. MUST exactly match one of the URLs listed. Use null if none clearly applies.
- is_new_opening: true ONLY if the article explicitly says the venue opened recently (within ~6 months) AND you can extract a concrete opens_at date. Set false for general reviews of established venues, "best of" round-ups, or anniversary write-ups. When uncertain, default to false.

Skip venues outside Singapore. Skip venues mentioned only in passing without enough detail to plan a visit.

Return ONLY raw JSON — an array (possibly empty), no markdown, no explanation:
[
  { "name": "...", "address": "...", "cuisine_tags": [...], "vibe_tags": [...], "opens_at": null, "photo_url": null, "is_new_opening": false }
]`

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  })

  const raw = (result.text ?? '').trim()
  if (!raw) return []

  // Tolerate fenced code blocks, leading/trailing prose
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: ExtractedVenue[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const v = item as Record<string, unknown>
    if (typeof v.name !== 'string' || !v.name) continue
    if (typeof v.address !== 'string' || !v.address) continue

    const cuisine_tags = Array.isArray(v.cuisine_tags)
      ? (v.cuisine_tags as unknown[])
          .filter((t): t is string => typeof t === 'string' && CUISINE_TAGS.includes(t))
          .slice(0, 3)
      : []

    const vibe_tags = Array.isArray(v.vibe_tags)
      ? (v.vibe_tags as unknown[])
          .filter(
            (t): t is string =>
              typeof t === 'string' && ['cozy', 'adventurous', 'celebratory', 'low_key'].includes(t)
          )
          .slice(0, 2)
      : []

    const opens_at =
      typeof v.opens_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.opens_at) ? v.opens_at : null

    // Photo: only accept Gemini's pick if it's actually in the article (defends
    // against URL hallucination). For single-venue posts, fall back to og:image.
    const allowedImages = new Set(articleImageUrls)
    const geminiPhoto =
      typeof v.photo_url === 'string' && allowedImages.has(v.photo_url) ? v.photo_url : null
    const photo_url =
      parsed.length === 1 ? (articlePhotoUrl ?? geminiPhoto) : geminiPhoto

    out.push({
      name: v.name,
      address: v.address,
      cuisine_tags,
      vibe_tags,
      opens_at,
      photo_url,
      is_new_opening: v.is_new_opening === true,
    })
  }
  return out
}

// ─── OneMap address validation ────────────────────────────────────────────────

const SG = { latMin: 1.15, latMax: 1.48, lngMin: 103.6, lngMax: 104.1 }

async function resolveAddress(
  venueName: string,
  address: string
): Promise<{ lat: number; lng: number; resolvedAddress: string } | null> {
  // OneMap chokes on unit numbers like "#02-01" or "#02-123/124" — strip them.
  const cleaned = address
    .replace(/#\s*\d+[\s\-/\d]*\d?/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // SG postal codes are 6 digits and OneMap resolves them very reliably alone.
  const postal = address.match(/\b(\d{6})\b/)?.[1]

  const queries = [
    `${venueName} ${cleaned}`,
    cleaned,
    postal,
    venueName,
  ].filter((q): q is string => Boolean(q?.trim()))

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

// ─── Freshness ────────────────────────────────────────────────────────────────

async function ageStaleSoftLaunches(summary: BlogScanSummary): Promise<number> {
  const cutoff = new Date(Date.now() - SOFT_LAUNCH_TTL_DAYS * 86400_000).toISOString()
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('venues')
    .update({ badge: 'none' })
    .eq('source', 'editorial')
    .eq('badge', 'soft_launch')
    .lt('last_synced_at', cutoff)
    .select('id')
  if (error) {
    summary.errors.push(`age-out: ${error.message}`)
    return 0
  }
  return data?.length ?? 0
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
    aged_out: 0,
    errors: [],
  }

  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    summary.errors.push('GOOGLE_GEMINI_API_KEY not set — skipping blog scan')
    return summary
  }

  summary.aged_out = await ageStaleSoftLaunches(summary)

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
    hours_json: ReturnType<typeof buildDefaultHoursJson>
    ph_hours_json: null
    badge: 'soft_launch' | 'none'
    badge_meta: {
      opened?: string | null
      reason?: string
      hours_source: 'default'
    }
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
      items = await blog.discover()
    } catch (err) {
      summary.errors.push(`${blog.name} feed: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    // Newest first, capped — feeds usually return reverse-chronological already.
    const capped = items
      .slice()
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, MAX_ARTICLES_PER_BLOG)

    for (const item of capped) {
      summary.articles_checked++

      let text: string
      let articlePhotoUrl: string | null
      let articleImageUrls: string[]

      try {
        ;({ text, photoUrl: articlePhotoUrl, imageUrls: articleImageUrls } =
          await fetchArticleText(item.url))
      } catch (err) {
        summary.errors.push(
          `${blog.name} "${item.title}": fetch failed — ${err instanceof Error ? err.message : String(err)}`
        )
        continue
      }

      let venues: ExtractedVenue[]
      try {
        venues = await extractVenues(
          blog,
          item.title,
          item.url,
          text,
          articlePhotoUrl,
          articleImageUrls
        )
      } catch (err) {
        summary.errors.push(
          `${blog.name} "${item.title}": Gemini error — ${err instanceof Error ? err.message : String(err)}`
        )
        continue
      }

      if (venues.length === 0) continue
      summary.articles_matched++

      for (const venue of venues) {
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

        // Require BOTH is_new_opening AND a parseable opens_at before badging
        // as soft_launch. Falling back to the article's pubDate produced
        // misleading "opened 3 days ago" copy for established venues that
        // happened to be reviewed recently (e.g. Lucine by LUNA showing as
        // "opened 3 days ago" when it has been open for months).
        const isNew = venue.is_new_opening && Boolean(venue.opens_at)
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
          hours_json: buildDefaultHoursJson(venue.cuisine_tags),
          ph_hours_json: null,
          badge: isNew ? 'soft_launch' : 'none',
          badge_meta: isNew
            ? {
                opened: venue.opens_at as string,
                reason: `${blog.name} new opening`,
                hours_source: 'default',
              }
            : { hours_source: 'default' },
          trending_score: 0,
          active: true,
          last_synced_at: new Date().toISOString(),
        })
      }
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
