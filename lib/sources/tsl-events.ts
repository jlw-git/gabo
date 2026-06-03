// The Smart Local events scraper.
//
// TSL is a WordPress site exposing the standard wp-json REST API. We pull
// recent posts from the "Things To Do" category (id 13620), feed each
// article HTML through Gemini Flash with an event-extraction prompt, and
// keep only articles that yield a date-bounded event with a concrete
// venue address (skipping listicles, ongoing-attraction reviews, etc.).
//
// Honesty contract:
//   - source_url MUST be the official TSL article URL.
//   - starts_at / ends_at must come from text in the article — no guessing.
//
// Mirrors lib/sources/blog-scanner.ts in shape; differences:
//   - Output is event-shaped (starts_at / ends_at / venue address) rather
//     than dining-shaped (cuisine / opens_at).
//   - Single article -> at most one event (TSL articles are single-topic).
//   - Address resolution via OneMap, same defensive pattern as blog-scanner.

import * as cheerio from 'cheerio'
import { chatComplete } from '@/lib/agents/provider'
import { searchPlaces } from '@/lib/onemap/client'
import type { HoursJson } from '@/lib/planner/types'
import type { EditorialEvent } from './editorial-events'

// TSL events cover a broad mix (markets, pop-ups, festivals, food crawls).
// Without per-event hours scraping, a wide 10am–11pm window keeps the
// planner from filtering them out. Run-window gating happens separately
// via badge_meta.starts_at / badge_meta.ends_at.
const DEFAULT_EVENT_HOURS: HoursJson = {
  mon: [{ open: '1000', close: '2300' }],
  tue: [{ open: '1000', close: '2300' }],
  wed: [{ open: '1000', close: '2300' }],
  thu: [{ open: '1000', close: '2300' }],
  fri: [{ open: '1000', close: '2300' }],
  sat: [{ open: '1000', close: '2300' }],
  sun: [{ open: '1000', close: '2300' }],
}

const TSL_BASE = 'https://thesmartlocal.com'
// "Things To Do" category — confirmed via /wp-json/wp/v2/categories?slug=things-to-do
const TSL_THINGS_TO_DO_CAT = 13620
// Lookback for WP REST query — 60 days catches upcoming and recent events
// without backloading old listicles.
const LOOKBACK_DAYS = 60
// Articles per run; each costs one Gemini call (~1–3s) plus a OneMap lookup.
const MAX_ARTICLES_PER_RUN = 25

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Gabo/1.0)',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
}
function fetchOpts(): RequestInit {
  return { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15_000) }
}

const SG = { latMin: 1.15, latMax: 1.48, lngMin: 103.6, lngMax: 104.1 }

const CATEGORY_TAGS = [
  'music',
  'theatre',
  'dance',
  'art',
  'exhibition',
  'festival',
  'film',
  'comedy',
  'family',
  'food_event',
  'nightlife',
  'sports',
  'community',
  'pop_up',
] as const

const VIBE_TAGS = ['cozy', 'adventurous', 'celebratory', 'low_key'] as const

type WpPost = {
  id: number
  date: string // ISO local time
  link: string
  title: { rendered: string }
}

type ExtractedEvent = {
  name: string
  venue_name: string
  venue_address: string
  starts_at: string // YYYY-MM-DD
  ends_at: string // YYYY-MM-DD
  ticket_url: string | null
  photo_url: string | null
  category_tags: string[]
  vibe_tags: string[]
  is_outdoor: boolean
}


function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

async function fetchRecentPosts(): Promise<WpPost[]> {
  const after = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const url = new URL(`${TSL_BASE}/wp-json/wp/v2/posts`)
  url.searchParams.set('categories', String(TSL_THINGS_TO_DO_CAT))
  url.searchParams.set('per_page', String(MAX_ARTICLES_PER_RUN))
  url.searchParams.set('orderby', 'date')
  url.searchParams.set('order', 'desc')
  url.searchParams.set('after', after)
  url.searchParams.set('_fields', 'id,date,link,title')

  const res = await fetch(url.toString(), fetchOpts())
  if (!res.ok) throw new Error(`TSL wp-json ${res.status}`)
  const data = (await res.json()) as WpPost[]
  return Array.isArray(data) ? data : []
}

async function fetchArticleContent(
  url: string
): Promise<{ text: string; photoUrl: string | null; imageUrls: string[] }> {
  const html = await fetch(url, fetchOpts()).then((r) => r.text())
  const $ = cheerio.load(html)
  $('nav, footer, aside, .sidebar, .comments, .related, script, style, [class*="ad"]').remove()

  const ogImage = $('meta[property="og:image"]').attr('content') ?? null
  const firstImg =
    $('article img, .entry-content img, .post-content img').first().attr('src') ?? null
  const photoUrl = ogImage || firstImg || null

  const imageSet = new Set<string>()
  $('article img, .entry-content img, .post-content img').each((_, el) => {
    const src =
      $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || ''
    if (src.startsWith('http')) imageSet.add(src)
  })

  const body =
    $('article').text() ||
    $('.entry-content, .post-content, .article-body').text() ||
    $('main').text()

  const text = body.replace(/\s+/g, ' ').trim().slice(0, 5000)
  return { text, photoUrl, imageUrls: [...imageSet].slice(0, 30) }
}

async function extractEvent(
  title: string,
  url: string,
  text: string,
  imageUrls: string[]
): Promise<ExtractedEvent | null> {
  const imageList =
    imageUrls.length > 0
      ? imageUrls.map((u, i) => `  ${i}: ${u}`).join('\n')
      : '  (no images available)'

  const prompt = `You are extracting a single Singapore event from a TheSmartLocal article. Most TSL articles describe a date-bounded happening with a concrete venue (concert, festival, pop-up, exhibition, run, market). Some articles are listicles or reviews of ongoing attractions — for those return null.

Article title: ${title}
Article URL: ${url}

Article text (truncated):
${text}

Available image URLs (you MUST pick photo_url from this list — do not invent URLs):
${imageList}

Return a SINGLE JSON object describing the headline event in this article, OR the literal word null on its own line if the article is not about a date-bounded event with a concrete Singapore venue.

If extracting an event:
- name: the event's name (e.g. "Moulin Rouge! The Musical", "Singapore Night Festival 2026")
- venue_name: the specific venue (e.g. "Sands Theatre", "Bras Basah district", "Gardens by the Bay")
- venue_address: the most specific Singapore address mentioned (street + postal code if available). MUST be in Singapore.
- starts_at: YYYY-MM-DD. The event's first day, exactly as stated in the article.
- ends_at: YYYY-MM-DD. The event's last day. If single-day, same as starts_at. If a run spans months, use the final date.
- ticket_url: the official ticket-purchase URL if mentioned (Sistic, Klook, ticketmaster, vendor site, etc). Use null if not mentioned.
- photo_url: a URL from the list above that best represents the event. Use null if none clearly applies.
- category_tags: 1–2 tags from ONLY: ${CATEGORY_TAGS.join(', ')}
- vibe_tags: 0–2 tags from ONLY: ${VIBE_TAGS.join(', ')}
- is_outdoor: true if the event is primarily outdoors (parks, beaches, open-air); false otherwise.

REJECT (return null) if any of these apply:
- Article is a listicle ("10 best things to do this weekend", "things to do in May")
- Article describes an ongoing attraction with no fixed end date (a permanent museum reopening, a new restaurant)
- starts_at or ends_at cannot be determined from explicit text
- The end date has clearly already passed
- venue_address is not in Singapore
- Event spans more than 4 months (likely an attraction, not an event)

Return ONLY raw JSON or the literal "null" — no markdown, no commentary.`

  const raw = (await chatComplete({ model: 'gemini-2.5-flash', prompt })).trim()
  if (!raw || raw === 'null') return null

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const v = parsed as Record<string, unknown>
  if (typeof v.name !== 'string' || !v.name) return null
  if (typeof v.venue_address !== 'string' || !v.venue_address) return null
  if (typeof v.starts_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.starts_at)) return null
  if (typeof v.ends_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.ends_at)) return null

  const allowed = new Set(imageUrls)
  const photo_url =
    typeof v.photo_url === 'string' && allowed.has(v.photo_url) ? v.photo_url : null

  const category_tags = Array.isArray(v.category_tags)
    ? (v.category_tags as unknown[])
        .filter(
          (t): t is string => typeof t === 'string' && (CATEGORY_TAGS as readonly string[]).includes(t)
        )
        .slice(0, 2)
    : []
  const vibe_tags = Array.isArray(v.vibe_tags)
    ? (v.vibe_tags as unknown[])
        .filter((t): t is string => typeof t === 'string' && (VIBE_TAGS as readonly string[]).includes(t))
        .slice(0, 2)
    : []

  return {
    name: v.name,
    venue_name: typeof v.venue_name === 'string' ? v.venue_name : v.name,
    venue_address: v.venue_address,
    starts_at: v.starts_at,
    ends_at: v.ends_at,
    ticket_url:
      typeof v.ticket_url === 'string' && /^https?:\/\//.test(v.ticket_url) ? v.ticket_url : null,
    photo_url,
    category_tags: category_tags.length > 0 ? category_tags : ['festival'],
    vibe_tags,
    is_outdoor: v.is_outdoor === true,
  }
}

async function resolveAddress(
  venueName: string,
  address: string
): Promise<{ lat: number; lng: number; resolvedAddress: string } | null> {
  const cleaned = address
    .replace(/#\s*\d+[\s\-/\d]*\d?/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const postal = address.match(/\b(\d{6})\b/)?.[1]
  const queries = [`${venueName} ${cleaned}`, cleaned, postal, venueName].filter(
    (q): q is string => Boolean(q?.trim())
  )

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

export type TslExtractedEvent = EditorialEvent & {
  // The TSL article URL (kept separate from booking link if present).
  ticket_url: string | null
}

export async function fetchTslEvents(): Promise<TslExtractedEvent[]> {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    throw new Error('GOOGLE_GEMINI_API_KEY missing')
  }

  const posts = await fetchRecentPosts()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const out: TslExtractedEvent[] = []
  const seenIds = new Set<string>()

  for (const post of posts.slice(0, MAX_ARTICLES_PER_RUN)) {
    let article: { text: string; photoUrl: string | null; imageUrls: string[] }
    try {
      article = await fetchArticleContent(post.link)
    } catch {
      continue
    }

    let event: ExtractedEvent | null
    try {
      event = await extractEvent(
        post.title.rendered,
        post.link,
        article.text,
        article.imageUrls
      )
    } catch {
      continue
    }
    if (!event) continue

    // Skip events whose end date has already passed.
    if (new Date(event.ends_at) < today) continue

    const location = await resolveAddress(event.venue_name, event.venue_address).catch(() => null)
    if (!location) continue

    const sourceId = `tsl-${slugify(event.name)}-${event.starts_at}`
    if (seenIds.has(sourceId)) continue
    seenIds.add(sourceId)

    // Single image fallback: prefer Gemini's pick, then article's og:image.
    const photoUrl = event.photo_url ?? article.photoUrl

    out.push({
      source_id: sourceId,
      source_url: post.link,
      name: event.name,
      address: location.resolvedAddress,
      lat: location.lat,
      lng: location.lng,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      cuisine_tags: ['experience', ...event.category_tags],
      vibe_tags: event.vibe_tags,
      is_outdoor: event.is_outdoor,
      photo_url: photoUrl,
      budget_band: 2,
      // Generous default — most TSL-covered events (markets, pop-ups,
      // festivals) run 10am–11pm. The planner separately gates on the
      // event's run window via badge_meta.starts_at/ends_at.
      hours: DEFAULT_EVENT_HOURS,
      ticket_url: event.ticket_url,
    })
  }

  return out
}

// Convert a TSL event into the venues-table row shape. Mirrors
// editorialEventToVenue but uses the article URL as source_url and the
// article's ticket_url (if any) as the chope_url booking target.
const CLOSING_SOON_DAYS = 30
const JUST_OPENED_DAYS = 14

export function tslEventToVenue(e: TslExtractedEvent): {
  name: string
  lat: number
  lng: number
  address: string
  cuisine_tags: string[]
  vibe_tags: string[]
  dietary_flags: never[]
  budget_band: number
  is_outdoor: boolean
  photo_url: string | null
  chope_url: string
  hours_json: import('@/lib/planner/types').HoursJson | null
  ph_hours_json: null
  badge: 'closing_soon' | 'soft_launch' | 'none'
  badge_meta: { starts_at: string; ends_at: string; reason?: string; opened?: string }
  trending_score: 0
  active: boolean
  source: 'editorial'
  source_id: string
  source_url: string
  last_synced_at: string
} {
  const now = Date.now()
  const ends = new Date(e.ends_at)
  const starts = new Date(e.starts_at)
  const daysUntilEnd = Math.round((ends.getTime() - now) / 86_400_000)
  const daysSinceStart = Math.round((now - starts.getTime()) / 86_400_000)
  const closingSoon = daysUntilEnd >= 0 && daysUntilEnd <= CLOSING_SOON_DAYS
  const justOpened = daysSinceStart >= 0 && daysSinceStart <= JUST_OPENED_DAYS

  // closing_soon outranks soft_launch as the primary badge, but both signals
  // are persisted in badge_meta so PlanCard can render multi-label chips on
  // short-run pop-ups.
  let badge: 'closing_soon' | 'soft_launch' | 'none'
  if (closingSoon) badge = 'closing_soon'
  else if (justOpened) badge = 'soft_launch'
  else badge = 'none'

  const badgeMeta: { starts_at: string; ends_at: string; reason?: string; opened?: string } = {
    starts_at: e.starts_at,
    ends_at: e.ends_at,
  }
  if (justOpened) badgeMeta.opened = e.starts_at

  return {
    name: e.name,
    lat: e.lat,
    lng: e.lng,
    address: e.address,
    cuisine_tags: e.cuisine_tags,
    vibe_tags: e.vibe_tags ?? [],
    dietary_flags: [],
    budget_band: e.budget_band ?? 2,
    is_outdoor: e.is_outdoor ?? false,
    photo_url: e.photo_url ?? null,
    // Prefer the explicit ticket URL when Gemini found one; otherwise fall
    // back to the article itself so users can read about the event.
    chope_url: e.ticket_url ?? e.source_url,
    hours_json: e.hours ?? null,
    ph_hours_json: null,
    badge,
    badge_meta: badgeMeta,
    trending_score: 0,
    active: daysUntilEnd >= -1,
    source: 'editorial',
    source_id: e.source_id,
    source_url: e.source_url,
    last_synced_at: new Date().toISOString(),
  }
}
