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

type BlogKind = 'dining' | 'experience'

type BlogConfig = {
  name: string
  prefix: string // short prefix for source_id, e.g. 'sethlui'
  // 'dining' blogs are extracted into dining catalog rows.
  // 'experience' blogs are extracted into editorial event rows (cuisine_tags
  // starts with 'experience' so the planner's isEvent() picks them up).
  kind: BlogKind
  discover: () => Promise<RssItem[]>
}

const BLOGS: BlogConfig[] = [
  {
    name: 'Seth Lui',
    prefix: 'sethlui',
    kind: 'dining',
    // Food-section feed only — the main /feed/ surfaces lots of non-food
    // content (lifestyle guides, gift round-ups) that wastes Gemini calls.
    discover: () => fetchFeedItems('https://sethlui.com/section/food/feed/'),
  },
  {
    name: 'Daniel Food Diary',
    prefix: 'dfd',
    kind: 'dining',
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
    kind: 'dining',
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
    kind: 'dining',
    discover: () => fetchFeedItems('https://www.ladyironchef.com/feed/'),
  },
  {
    name: 'The Smart Local',
    prefix: 'tsl',
    kind: 'dining',
    // WordPress per-category RSS — covers Food Guides (roundups) + Food
    // Reviews (single-venue posts) under the parent "Food" category. The
    // existing extractor handles both shapes via the prompt's
    // "single review OR roundup" clause.
    discover: () => fetchFeedItems('https://thesmartlocal.com/category/food-things-to-do/feed/'),
  },
  {
    name: 'TSL Things To Do',
    prefix: 'tsl-todo',
    kind: 'experience',
    // Covers SG events, pop-ups, indie shops, attractions, fairs, workshops,
    // and night-time activities — the layer that fills the events catalog
    // beyond museum exhibitions and Bandsintown concerts.
    discover: () => fetchFeedItems('https://thesmartlocal.com/category/things-to-do/feed/'),
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

// Tag vocabulary for experience venues (non-dining). The literal 'experience'
// is added to every row's cuisine_tags as the planner's category marker
// (see lib/planner/category.ts#isEvent); the rest narrow what kind of
// experience it is and drive default-hours selection.
const EXPERIENCE_TAGS = [
  'art', 'exhibition', 'music', 'theatre', 'nightlife',
  'shopping', 'bookstore', 'market', 'pop_up', 'fair',
  'workshop', 'class', 'wellness', 'games', 'sport',
  'nature', 'outdoor', 'family',
]

// ─── Types ────────────────────────────────────────────────────────────────────

type ExtractedVenue = {
  name: string
  address: string
  cuisine_tags: string[]
  vibe_tags: string[]
  opens_at: string | null
  ends_at: string | null
  photo_url: string | null
  is_new_opening: boolean
  is_limited_run: boolean
  is_award_winner: boolean
  award_name: string | null
  // Tri-state: true / false / null (unknown). Lets the planner trust this
  // when the article is explicit and fall back to the regex when not.
  accepts_reservations: boolean | null
}

type ExtractedExperience = {
  name: string
  address: string
  // Experience-specific subset of EXPERIENCE_TAGS (the literal 'experience'
  // is prepended by toExperienceRow, callers don't include it here).
  experience_tags: string[]
  vibe_tags: string[]
  // For limited-run events (pop-ups, fairs, light shows, seasonal markets) —
  // when both are set the planner's isInRunWindow date-gates the venue.
  starts_at: string | null
  ends_at: string | null
  // For permanent venues that recently opened (new indie bookstore, new
  // attraction) — drives the soft_launch badge.
  opens_at: string | null
  photo_url: string | null
  is_new_opening: boolean
  is_limited_run: boolean
  is_outdoor: boolean
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
// Award badges decay more slowly — Michelin / Asia's 50 Best lists publish
// roughly yearly and a venue that lost the award rarely loses it overnight.
const AWARD_FRESH_TTL_DAYS = 365
// Critic-pick is recomputed every run from cross-blog mention counts, so no
// TTL is needed — a venue stops being a critic_pick the next run after
// mentions drop below the threshold.
const CRITIC_PICK_MIN_BLOGS = 3

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

// Experience-typed defaults — generously bracket the slot most users search
// for (evenings). Pop-ups + nightlife stretch to 23:00 so a 22:00 query still
// matches them; daytime-only formats (workshops, markets) close at 22:00 too
// so a borderline 21:30 query doesn't get filtered out.
const DEFAULT_EXPERIENCE_HOURS = {
  nightlife: { open: '1800', close: '0200' },
  market: { open: '1100', close: '2200' },
  shopping: { open: '1100', close: '2100' },
  workshop: { open: '1000', close: '2200' },
  outdoor: { open: '0900', close: '2200' },
  default: { open: '1000', close: '2200' },
} as const

function defaultHoursForExperience(experienceTags: string[]): { open: string; close: string } {
  if (experienceTags.some((t) => t === 'nightlife' || t === 'music')) {
    return DEFAULT_EXPERIENCE_HOURS.nightlife
  }
  if (experienceTags.some((t) => t === 'market' || t === 'fair' || t === 'pop_up')) {
    return DEFAULT_EXPERIENCE_HOURS.market
  }
  if (experienceTags.some((t) => t === 'shopping' || t === 'bookstore')) {
    return DEFAULT_EXPERIENCE_HOURS.shopping
  }
  if (experienceTags.some((t) => t === 'workshop' || t === 'class' || t === 'wellness')) {
    return DEFAULT_EXPERIENCE_HOURS.workshop
  }
  if (experienceTags.some((t) => t === 'outdoor' || t === 'nature')) {
    return DEFAULT_EXPERIENCE_HOURS.outdoor
  }
  return DEFAULT_EXPERIENCE_HOURS.default
}

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function buildExperienceHoursJson(experienceTags: string[]) {
  const w = defaultHoursForExperience(experienceTags)
  const out: Record<string, { open: string; close: string }[]> = {}
  for (const d of ALL_DAYS) out[d] = [w]
  return out
}

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

// Detects roundup-style article titles where the whole list is implicitly
// new openings (used as the gate for the pubDate fallback below). Patterns:
//   "16 New Cafes & Restaurants in May 2026"
//   "10 New Restaurants Opening This March"
//   "Just opened: 8 new spots in Tanjong Pagar"
// Single-venue review titles like "Lucine by LUNA: A new Italian-Korean spot"
// must NOT match — that was the Lucine bug.
function isNewOpeningsRoundupTitle(title: string): boolean {
  const t = title.toLowerCase()
  // "N new ..." (count + "new" — strong signal of a numbered list)
  if (/\b\d+\s+new\b/.test(t)) return true
  // "new (cafes|restaurants|bars|spots|venues|eateries) ... (this|in) (month)"
  if (
    /\bnew\s+(cafes?|restaurants?|bars?|eateries?|spots?|places?|venues?|openings?)\b[^.]{0,80}\b(this|in)\s+(week|month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(
      t
    )
  ) {
    return true
  }
  // "just opened" / "newly opened" at the START — usually means a roundup.
  if (/^(just|newly)\s+opened\b/.test(t)) return true
  return false
}

async function extractVenues(
  blog: BlogConfig,
  title: string,
  url: string,
  pubDate: Date,
  text: string,
  articlePhotoUrl: string | null,
  articleImageUrls: string[]
): Promise<ExtractedVenue[]> {
  const ai = geminiClient()

  const imageList =
    articleImageUrls.length > 0
      ? articleImageUrls.map((u, i) => `  ${i}: ${u}`).join('\n')
      : '  (no images available)'

  const pubDateIso = pubDate.toISOString().slice(0, 10)
  const isRoundup = isNewOpeningsRoundupTitle(title)

  const prompt = `You are extracting structured data from a Singapore food blog post.

Blog: ${blog.name}
Article title: ${title}
Article URL: ${url}
Article published: ${pubDateIso}

Article text (truncated):
${text}

Available image URLs in this article (you MUST pick photo_url from this list — do not invent URLs):
${imageList}

Return every Singapore restaurant, café, bar, or food venue clearly described in the article — single review OR roundup ("10 best omakase…"). For each venue extract:
- name: the venue's full name
- address: the most specific Singapore address mentioned (street + district or postal code). Skip venues with no concrete address.
- cuisine_tags: 1–3 tags from ONLY this list: ${CUISINE_TAGS.join(', ')}
- vibe_tags: 0–2 tags from ONLY: cozy, adventurous, celebratory, low_key
- opens_at: opening date as YYYY-MM-DD if the article explicitly states one for THIS venue (e.g. "opens 15 March 2026", "soft-launched last week", "just opened in May"). Use null if no per-venue date is given.
- ends_at: closing date as YYYY-MM-DD if the article says the venue or pop-up is time-limited and ends on a specific date (e.g. "pop-up runs until 30 June", "limited engagement through 15 May", "last day 12 Apr", "chef's residency ends 1 March"). Use null if the venue is permanent or no end date is given. DO NOT guess.
- photo_url: the URL most clearly tied to this venue from the list above. MUST exactly match one of the URLs listed. Use null if none clearly applies.
- is_new_opening: true if either (a) the article explicitly says THIS venue opened recently (within ~6 months), OR (b) the article title / framing presents the entire list as new openings (e.g. "16 New Cafes & Restaurants in May 2026", "10 New Restaurants Opening This March", "Just Opened: 8 new spots in Tanjong Pagar") and this venue is one of the featured entries. Set false for single-venue REVIEW articles of established venues, "best of" round-ups, anniversary write-ups, or articles that simply describe a venue as "a new place to try" without framing the whole list as new. When uncertain, default to false. (For roundups, opens_at can be null — the planner will fall back to the article's publish date.)
- is_limited_run: true ONLY if the article frames the venue as time-limited (pop-up, residency, chef takeover, limited engagement, seasonal stall) AND you can extract a concrete ends_at date. Set false for permanent venues even if they have temporary menus or one-off events. When uncertain, default to false.
- is_award_winner: true ONLY if THIS article is explicitly a write-up about a prestigious culinary award or list naming this venue — Michelin Guide Singapore (star or Bib Gourmand), Asia's 50 Best Restaurants, World's 50 Best Restaurants, World Gourmet Awards, World Gourmet Summit, or Tatler Dining. Set false for general reviews even if the venue is famous, and false for round-ups that don't mention an award by name. When uncertain, default to false.
- award_name: short label for the award (e.g. "Michelin star 2026", "Michelin Bib Gourmand 2025", "Asia's 50 Best #12 2025", "World Gourmet Award 2026"). Use null when is_award_winner is false.
- accepts_reservations: true / false / null based on what the article says about booking.
    - true: the article mentions reservations, bookings, a reservation phone line, Chope/SevenRooms/OpenTable, "book a table", "reservations recommended", or describes the venue as a sit-down restaurant where bookings are clearly typical.
    - false: the article explicitly says the venue is walk-in only, "no reservations", "first-come first-served", "queue", or describes it as a hawker stall, food-court tenant, kopitiam, coffee shop, or a small zi char / sliced-fish / bak kut teh / chicken-rice / laksa / prata-style stall where reservations are not taken.
    - null: the article doesn't say either way and the venue type isn't clearly one or the other. Prefer null over guessing.

Skip venues outside Singapore. Skip venues mentioned only in passing without enough detail to plan a visit.

Return ONLY raw JSON — an array (possibly empty), no markdown, no explanation:
[
  { "name": "...", "address": "...", "cuisine_tags": [...], "vibe_tags": [...], "opens_at": null, "ends_at": null, "photo_url": null, "is_new_opening": false, "is_limited_run": false, "is_award_winner": false, "award_name": null, "accepts_reservations": null }
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

    const explicitOpensAt =
      typeof v.opens_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.opens_at) ? v.opens_at : null
    const ends_at =
      typeof v.ends_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.ends_at) ? v.ends_at : null

    // Roundup pubDate fallback: when Gemini flags is_new_opening=true but
    // didn't pin a per-venue opens_at, AND the article title is clearly a
    // new-openings roundup (e.g. "16 New Cafes & Restaurants in May 2026"),
    // use the article's publication date as opens_at. The article-title gate
    // is what prevents the original Lucine bug — single-venue review articles
    // whose titles don't match the roundup pattern stay on the strict
    // "explicit per-venue date required" rule.
    const is_new_opening = v.is_new_opening === true
    const opens_at =
      explicitOpensAt ?? (is_new_opening && isRoundup ? pubDateIso : null)

    // Photo: only accept Gemini's pick if it's actually in the article (defends
    // against URL hallucination). For single-venue posts, fall back to og:image.
    const allowedImages = new Set(articleImageUrls)
    const geminiPhoto =
      typeof v.photo_url === 'string' && allowedImages.has(v.photo_url) ? v.photo_url : null
    const photo_url =
      parsed.length === 1 ? (articlePhotoUrl ?? geminiPhoto) : geminiPhoto

    const accepts_reservations =
      v.accepts_reservations === true
        ? true
        : v.accepts_reservations === false
          ? false
          : null

    const is_award_winner = v.is_award_winner === true
    const award_name =
      is_award_winner && typeof v.award_name === 'string' && v.award_name.trim()
        ? v.award_name.trim().slice(0, 80)
        : null

    out.push({
      name: v.name,
      address: v.address,
      cuisine_tags,
      vibe_tags,
      opens_at,
      ends_at,
      photo_url,
      is_new_opening,
      is_limited_run: v.is_limited_run === true,
      is_award_winner,
      award_name,
      accepts_reservations,
    })
  }
  return out
}

// Experience extractor — runs on blogs with kind='experience'. Lifestyle
// articles tend to mix permanent venues (new indie bookstore that opened
// last week) and time-limited events (3-day art market this weekend) in
// the same roundup, so the prompt has Gemini classify each. The resulting
// rows are persisted with cuisine_tags=['experience', ...] which the
// planner reads as "this is an event" (see isEvent() in lib/planner/category.ts).
async function extractExperiences(
  blog: BlogConfig,
  title: string,
  url: string,
  text: string,
  articlePhotoUrl: string | null,
  articleImageUrls: string[]
): Promise<ExtractedExperience[]> {
  const ai = geminiClient()

  const imageList =
    articleImageUrls.length > 0
      ? articleImageUrls.map((u, i) => `  ${i}: ${u}`).join('\n')
      : '  (no images available)'

  const prompt = `You are extracting structured data from a Singapore lifestyle / things-to-do blog post.

Blog: ${blog.name}
Article title: ${title}
Article URL: ${url}

Article text (truncated):
${text}

Available image URLs in this article (you MUST pick photo_url from this list — do not invent URLs):
${imageList}

Return every Singapore EXPERIENCE venue clearly described in the article — pop-ups, fairs, light shows, art markets, exhibitions outside museums, workshops, indie bookstores, indie retail, attractions, festivals, themed activities, sport experiences (axe-throwing, mini golf, pickleball), wellness studios, night activities. Skip restaurants / cafes / bars unless the article explicitly frames them as an event venue (e.g. "speakeasy hosting a wine-tasting night"). Skip generic listicles that don't point at a specific venue.

For each venue extract:
- name: the venue's full name as a visitor would search for it
- address: the most specific Singapore address mentioned (street + district or postal code). Skip venues with no concrete address.
- experience_tags: 1–3 tags from ONLY this list: ${EXPERIENCE_TAGS.join(', ')}
- vibe_tags: 0–2 tags from ONLY: cozy, adventurous, celebratory, low_key
- starts_at: start date as YYYY-MM-DD if the article says the venue / event runs for a specific window (pop-up dates, fair weekend, festival run). Use null if the venue is permanent or no start date is given.
- ends_at: end date as YYYY-MM-DD if the article says the venue / event has a specific closing date. Use null if the venue is permanent or no end date is given.
- opens_at: opening date as YYYY-MM-DD if the article explicitly says a PERMANENT venue opened on a specific date (e.g. "new indie bookstore opened 12 March 2026"). Use null for time-limited events (use starts_at instead) or when no opening date is given.
- photo_url: the URL most clearly tied to this venue from the list above. MUST exactly match one of the URLs listed. Use null if none clearly applies.
- is_new_opening: true ONLY if the article explicitly says the venue is a PERMANENT new opening within the last ~6 months AND you can extract a concrete opens_at date. Set false for time-limited events.
- is_limited_run: true ONLY if the article frames the venue / event as time-limited (pop-up, fair, festival, seasonal market, residency) AND you can extract a concrete ends_at date. Set false for permanent venues.
- is_outdoor: true if the venue is outdoors (park, beach, outdoor market, garden show) so the planner can hide it on rainy evenings; false otherwise.

Skip venues outside Singapore. Skip venues mentioned only in passing without enough detail to plan a visit.

Return ONLY raw JSON — an array (possibly empty), no markdown, no explanation:
[
  { "name": "...", "address": "...", "experience_tags": [...], "vibe_tags": [...], "starts_at": null, "ends_at": null, "opens_at": null, "photo_url": null, "is_new_opening": false, "is_limited_run": false, "is_outdoor": false }
]`

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  })

  const raw = (result.text ?? '').trim()
  if (!raw) return []

  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: ExtractedExperience[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const v = item as Record<string, unknown>
    if (typeof v.name !== 'string' || !v.name) continue
    if (typeof v.address !== 'string' || !v.address) continue

    const experience_tags = Array.isArray(v.experience_tags)
      ? (v.experience_tags as unknown[])
          .filter((t): t is string => typeof t === 'string' && EXPERIENCE_TAGS.includes(t))
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

    const starts_at =
      typeof v.starts_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.starts_at) ? v.starts_at : null
    const ends_at =
      typeof v.ends_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.ends_at) ? v.ends_at : null
    const opens_at =
      typeof v.opens_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.opens_at) ? v.opens_at : null

    const allowedImages = new Set(articleImageUrls)
    const geminiPhoto =
      typeof v.photo_url === 'string' && allowedImages.has(v.photo_url) ? v.photo_url : null
    const photo_url =
      parsed.length === 1 ? (articlePhotoUrl ?? geminiPhoto) : geminiPhoto

    out.push({
      name: v.name,
      address: v.address,
      experience_tags,
      vibe_tags,
      starts_at,
      ends_at,
      opens_at,
      photo_url,
      is_new_opening: v.is_new_opening === true,
      is_limited_run: v.is_limited_run === true,
      is_outdoor: v.is_outdoor === true,
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

// Age out time-sensitive badges. Called once per run before any extraction so
// stale rows show up correctly even if no new article mentions them.
//   - soft_launch  → none after SOFT_LAUNCH_TTL_DAYS without a fresh mention
//   - award_fresh  → none after AWARD_FRESH_TTL_DAYS without a fresh mention
//   - closing_soon → none once its badge_meta.ends_at has passed
async function ageStaleBadges(summary: BlogScanSummary): Promise<number> {
  const supabase = createServiceRoleClient()
  let agedOut = 0

  const softCutoff = new Date(Date.now() - SOFT_LAUNCH_TTL_DAYS * 86400_000).toISOString()
  const softRes = await supabase
    .from('venues')
    .update({ badge: 'none' })
    .eq('source', 'editorial')
    .eq('badge', 'soft_launch')
    .lt('last_synced_at', softCutoff)
    .select('id')
  if (softRes.error) summary.errors.push(`age-out soft_launch: ${softRes.error.message}`)
  else agedOut += softRes.data?.length ?? 0

  const awardCutoff = new Date(Date.now() - AWARD_FRESH_TTL_DAYS * 86400_000).toISOString()
  const awardRes = await supabase
    .from('venues')
    .update({ badge: 'none' })
    .eq('source', 'editorial')
    .eq('badge', 'award_fresh')
    .lt('last_synced_at', awardCutoff)
    .select('id')
  if (awardRes.error) summary.errors.push(`age-out award_fresh: ${awardRes.error.message}`)
  else agedOut += awardRes.data?.length ?? 0

  // closing_soon: load editorial rows and flip any whose badge_meta.ends_at is
  // before today. Doing this in JS avoids relying on Postgres JSONB date
  // arithmetic and the row count is small (low hundreds).
  const today = new Date().toISOString().slice(0, 10)
  const closingRes = await supabase
    .from('venues')
    .select('id, badge_meta')
    .eq('source', 'editorial')
    .eq('badge', 'closing_soon')
  if (closingRes.error) {
    summary.errors.push(`age-out closing_soon load: ${closingRes.error.message}`)
  } else {
    const expiredIds: string[] = []
    for (const row of (closingRes.data ?? []) as { id: string; badge_meta: Record<string, unknown> | null }[]) {
      const endsAt = row.badge_meta?.ends_at
      if (typeof endsAt !== 'string') continue
      if (endsAt < today) expiredIds.push(row.id)
    }
    if (expiredIds.length > 0) {
      const upd = await supabase
        .from('venues')
        .update({ badge: 'none' })
        .in('id', expiredIds)
        .select('id')
      if (upd.error) summary.errors.push(`age-out closing_soon update: ${upd.error.message}`)
      else agedOut += upd.data?.length ?? 0
    }
  }

  return agedOut
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

  summary.aged_out = await ageStaleBadges(summary)

  // Both dining and experience rows share this shape; the differences are
  // entirely in the field VALUES (cuisine_tags carries the literal 'experience'
  // marker for events, is_outdoor can be true for outdoor experiences, hours
  // come from the experience defaults). One shape keeps the upsert path
  // uniform.
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
    is_outdoor: boolean
    photo_url: string | null
    chope_url: string | null
    hours_json: ReturnType<typeof buildDefaultHoursJson>
    ph_hours_json: null
    // critic_pick is set in a second pass from cross-blog mention counts; the
    // per-article extractor never emits it directly.
    badge: 'closing_soon' | 'soft_launch' | 'award_fresh' | 'none'
    badge_meta: {
      opened?: string | null
      ends_at?: string | null
      starts_at?: string | null
      award?: string | null
      source?: string | null
      reason?: string
      hours_source: 'default'
    }
    trending_score: 0
    active: true
    accepts_reservations: boolean | null
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

      if (blog.kind === 'dining') {
        let venues: ExtractedVenue[]
        try {
          venues = await extractVenues(
            blog,
            item.title,
            item.url,
            item.pubDate,
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

          // is_new_opening / is_limited_run require BOTH the flag AND a parseable
          // date — falling back to the article's pubDate produced misleading
          // "opened 3 days ago" copy for established venues that happened to be
          // reviewed recently (e.g. Lucine by LUNA showing as "opened 3 days ago"
          // when it has been open for months).
          const isLimited =
            venue.is_limited_run && Boolean(venue.ends_at) && (venue.ends_at as string) >= new Date().toISOString().slice(0, 10)
          const isNew = venue.is_new_opening && Boolean(venue.opens_at)
          const isAward = venue.is_award_winner && Boolean(venue.award_name)

          // Always carry every signal that applies in badge_meta so PlanCard can
          // render multiple labels (a Michelin pop-up that opened last week
          // should chip as Award-winning + Just opened + Limited run). The
          // primary `badge` column picks one winner — used for ring colour and
          // the freshness score weight in lib/planner/score.ts — but the meta
          // is the source of truth for label rendering.
          // Priority: closing_soon > soft_launch > award_fresh (critic_pick set
          // in a second pass).
          const badgeMeta: VenueRow['badge_meta'] = { hours_source: 'default' }
          if (isLimited) badgeMeta.ends_at = venue.ends_at
          if (isNew) badgeMeta.opened = venue.opens_at
          if (isAward) badgeMeta.award = venue.award_name

          let badge: VenueRow['badge']
          if (isLimited) badge = 'closing_soon'
          else if (isNew) badge = 'soft_launch'
          else if (isAward) badge = 'award_fresh'
          else badge = 'none'

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
            badge,
            badge_meta: badgeMeta,
            trending_score: 0,
            active: true,
            accepts_reservations: venue.accepts_reservations,
            last_synced_at: new Date().toISOString(),
          })
        }
      } else {
        // Experience blog — same pipeline but with the experience extractor and
        // event-shaped row (cuisine_tags carries the 'experience' marker so the
        // planner's isEvent() treats the row as an event).
        let experiences: ExtractedExperience[]
        try {
          experiences = await extractExperiences(
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

        if (experiences.length === 0) continue
        summary.articles_matched++

        for (const exp of experiences) {
          summary.venues_extracted++

          const location = await resolveAddress(exp.name, exp.address).catch(() => null)
          if (!location) {
            summary.errors.push(
              `${blog.name} "${exp.name}": OneMap could not resolve "${exp.address}"`
            )
            continue
          }
          summary.addresses_validated++

          const source_id = `${blog.prefix}-${slugify(exp.name)}`
          if (seenIds.has(source_id)) continue
          seenIds.add(source_id)

          // Date-gate context: editorial-events / tsl-events only badge
          // closing_soon when the run ends within 30 days. Same convention
          // here so a 6-month festival isn't flagged "Limited run" for half
          // a year. starts_at + ends_at are always persisted in badge_meta
          // when present though — that's what the planner's isInRunWindow
          // reads to filter out events outside their run window.
          const today = new Date().toISOString().slice(0, 10)
          const isLimitedRun = exp.is_limited_run && Boolean(exp.ends_at) && (exp.ends_at as string) >= today
          const isNewOpening = exp.is_new_opening && Boolean(exp.opens_at)
          const daysUntilEnd =
            exp.ends_at ? Math.round((new Date(exp.ends_at).getTime() - Date.now()) / 86_400_000) : Infinity
          const closingSoon = isLimitedRun && daysUntilEnd <= 30

          const badgeMeta: VenueRow['badge_meta'] = { hours_source: 'default' }
          if (exp.starts_at) badgeMeta.starts_at = exp.starts_at
          if (exp.ends_at) badgeMeta.ends_at = exp.ends_at
          if (isNewOpening) badgeMeta.opened = exp.opens_at

          let badge: VenueRow['badge']
          if (closingSoon) badge = 'closing_soon'
          else if (isNewOpening) badge = 'soft_launch'
          else badge = 'none'

          toInsert.push({
            source: 'editorial',
            source_id,
            source_url: item.url,
            name: exp.name,
            lat: location.lat,
            lng: location.lng,
            address: location.resolvedAddress,
            // 'experience' is the category marker the planner's isEvent()
            // checks for — without it the row would be treated as dining.
            cuisine_tags: ['experience', ...exp.experience_tags],
            vibe_tags: exp.vibe_tags,
            dietary_flags: [],
            budget_band: 2,
            is_outdoor: exp.is_outdoor,
            photo_url: exp.photo_url,
            // Mirrors editorialEventToVenue / tslEventToVenue: events use the
            // source page as the "reservation" link, since clicking takes
            // the user to ticketing / details.
            chope_url: item.url,
            hours_json: buildExperienceHoursJson(exp.experience_tags),
            ph_hours_json: null,
            badge,
            badge_meta: badgeMeta,
            trending_score: 0,
            active: true,
            // Workshops, markets, indie shops — booking conventions vary too
            // widely to guess. Leave unknown and let the UI fall back to the
            // chope_url heuristic in lib/reservations.ts.
            accepts_reservations: null,
            last_synced_at: new Date().toISOString(),
          })
        }
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

  await applyCriticPickBadges(summary)

  return summary
}

// ─── Cross-blog critic_pick ──────────────────────────────────────────────────
//
// Editorial venues are upserted per-blog with prefixed source_ids
// (sethlui-burnt-ends, dfd-burnt-ends, …) so cross-blog dedup isn't part of
// the upsert path. Instead, after each run we recompute the mention count per
// normalised venue name and promote any venue with mentions from ≥3 distinct
// blogs to badge='critic_pick'. Higher-priority badges (closing_soon,
// soft_launch) are preserved; award_fresh is preserved across the round-trip
// via badge_meta.award so a demotion can restore it.
function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function prefixForSourceId(sourceId: string): string | null {
  for (const b of BLOGS) {
    if (sourceId.startsWith(`${b.prefix}-`)) return b.prefix
  }
  return null
}

function blogNameForPrefix(prefix: string): string {
  return BLOGS.find((b) => b.prefix === prefix)?.name ?? prefix
}

type EditorialBadgeRow = {
  id: string
  name: string
  source_id: string
  cuisine_tags: string[] | null
  badge: 'closing_soon' | 'soft_launch' | 'critic_pick' | 'award_fresh' | 'none'
  badge_meta: Record<string, unknown> | null
}

async function applyCriticPickBadges(summary: BlogScanSummary): Promise<void> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, source_id, cuisine_tags, badge, badge_meta')
    .eq('source', 'editorial')
  if (error) {
    summary.errors.push(`critic_pick load: ${error.message}`)
    return
  }
  const rows = (data ?? []) as EditorialBadgeRow[]

  // Group rows by normalised name → set of distinct blog prefixes. Exclude
  // events (cuisine_tags contains 'experience') so a TSL event doesn't
  // accidentally count toward a dining venue's blog-mention tally.
  const groups = new Map<string, { prefixes: Set<string>; rows: EditorialBadgeRow[] }>()
  for (const row of rows) {
    const prefix = prefixForSourceId(row.source_id)
    if (!prefix) continue // ignore non-blog editorial rows (museum agent etc.)
    if ((row.cuisine_tags ?? []).includes('experience')) continue
    const key = normalizeVenueName(row.name)
    if (!key) continue
    let g = groups.get(key)
    if (!g) {
      g = { prefixes: new Set(), rows: [] }
      groups.set(key, g)
    }
    g.prefixes.add(prefix)
    g.rows.push(row)
  }

  // Every row in a qualifying group gets badge_meta.source = "<blogs>" so the
  // PlanCard can show a "Critic's pick" chip alongside any higher-priority
  // chip (closing_soon / soft_launch) — that is, the source tag is a label
  // signal, not just a badge value. The primary `badge` column is only
  // changed when the new value is a strict upgrade or a needed demotion.
  for (const { prefixes, rows: groupRows } of groups.values()) {
    const qualifies = prefixes.size >= CRITIC_PICK_MIN_BLOGS
    const sourceLabel = [...prefixes].map(blogNameForPrefix).sort().join(', ')

    for (const row of groupRows) {
      const currentMeta = row.badge_meta ?? {}
      if (qualifies) {
        const sourceMatches = currentMeta.source === sourceLabel
        const shouldUpgradeBadge =
          row.badge === 'award_fresh' || row.badge === 'none'
        if (sourceMatches && !shouldUpgradeBadge) continue
        const meta: Record<string, unknown> = { ...currentMeta, source: sourceLabel }
        const nextBadge = shouldUpgradeBadge ? 'critic_pick' : row.badge
        const upd = await supabase
          .from('venues')
          .update({ badge: nextBadge, badge_meta: meta })
          .eq('id', row.id)
        if (upd.error) summary.errors.push(`critic_pick promote ${row.id}: ${upd.error.message}`)
      } else if (typeof currentMeta.source === 'string') {
        // No longer qualifies: strip the source tag, and demote the badge if
        // critic_pick was the only thing keeping the row off `none`.
        const meta: Record<string, unknown> = { ...currentMeta }
        delete meta.source
        let nextBadge = row.badge
        if (row.badge === 'critic_pick') {
          nextBadge = typeof currentMeta.award === 'string' ? 'award_fresh' : 'none'
        }
        const upd = await supabase
          .from('venues')
          .update({ badge: nextBadge, badge_meta: meta })
          .eq('id', row.id)
        if (upd.error) summary.errors.push(`critic_pick demote ${row.id}: ${upd.error.message}`)
      }
    }
  }
}
