// The Smart Local events scraper.
//
// TSL is a WordPress site exposing the standard wp-json REST API. We pull
// recent posts from the "Things To Do" category and its "Events" child
// category, feed each article HTML through Gemini Flash with an
// event-extraction prompt, and keep only articles that yield a date-bounded
// event with a concrete venue address (skipping generic roundups,
// ongoing-attraction reviews, etc.).
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
// Child "Events" category — /category/things-to-do/events-things-to-do/.
// TSL's homepage "Latest" event cards currently use this child category, so
// scanning only the parent misses high-signal near-term events.
const TSL_EVENTS_CAT = 13624
// Lookback for WP REST query — 60 days catches upcoming and recent events
// without backloading old listicles.
const LOOKBACK_DAYS = 60
// Articles per run; each costs one Gemini call (~1–3s) plus a OneMap lookup.
const MAX_ARTICLES_PER_RUN = 25
// TSL roundup pages are valuable but structurally different: one article can
// contain many short-lived events. We keep this as a reviewed allowlist so the
// normal extractor can continue rejecting generic listicles.
const TSL_ROUNDUP_PATHS = new Set(['/read/things-to-do-this-weekend-singapore/'])
const TSL_ROUNDUP_POSTS: WpPost[] = [
  {
    id: -1,
    date: new Date().toISOString(),
    link: `${TSL_BASE}/read/things-to-do-this-weekend-singapore/`,
    title: { rendered: 'Things To Do This Weekend In Singapore' },
  },
]

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
  opens_at: string | null // HHMM, daily event start time when stated
  closes_at: string | null // HHMM, daily event end time when stated
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

async function fetchPostsForCategory(categoryId: number): Promise<WpPost[]> {
  const after = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const url = new URL(`${TSL_BASE}/wp-json/wp/v2/posts`)
  url.searchParams.set('categories', String(categoryId))
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

async function fetchRecentPosts(): Promise<WpPost[]> {
  const batches = await Promise.all([
    fetchPostsForCategory(TSL_EVENTS_CAT),
    fetchPostsForCategory(TSL_THINGS_TO_DO_CAT),
  ])
  const byLink = new Map<string, WpPost>()
  for (const post of [...batches.flat(), ...TSL_ROUNDUP_POSTS]) byLink.set(post.link, post)
  return [...byLink.values()]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, MAX_ARTICLES_PER_RUN)
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

  const text = body.replace(/\s+/g, ' ').trim().slice(0, 12_000)
  return { text, photoUrl, imageUrls: [...imageSet].slice(0, 30) }
}

async function extractEvent(
  title: string,
  url: string,
  text: string,
  imageUrls: string[]
): Promise<ExtractedEvent | null> {
  const structured = extractStructuredEvent(title, text, imageUrls)
  if (structured) return structured

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

Articles titled "Guide to ..." or "Everything to know about ..." are valid if they describe ONE named event with an explicit date window. Reject only generic multi-event roundups.

If extracting an event:
- name: the event's name (e.g. "Moulin Rouge! The Musical", "Singapore Night Festival 2026")
- venue_name: the specific venue (e.g. "Sands Theatre", "Bras Basah district", "Gardens by the Bay")
- venue_address: the most specific Singapore address mentioned (street + postal code if available). MUST be in Singapore.
- starts_at: YYYY-MM-DD. The event's first day, exactly as stated in the article.
- ends_at: YYYY-MM-DD. The event's last day. If single-day, same as starts_at. If a run spans months, use the final date.
- opens_at: HHMM 24-hour local time if a daily start time is explicitly stated (e.g. "4pm" -> "1600", "7.30pm" -> "1930"). Use null if not stated.
- closes_at: HHMM 24-hour local time if a daily end time is explicitly stated (e.g. "11pm" -> "2300", "10.30pm" -> "2230"). Use null if not stated.
- ticket_url: the official ticket-purchase URL if mentioned (Sistic, Klook, ticketmaster, vendor site, etc). Use null if not mentioned.
- photo_url: a URL from the list above that best represents the event. Use null if none clearly applies.
- category_tags: 1–2 tags from ONLY: ${CATEGORY_TAGS.join(', ')}
- vibe_tags: 0–2 tags from ONLY: ${VIBE_TAGS.join(', ')}
- is_outdoor: true if the event is primarily outdoors (parks, beaches, open-air); false otherwise.

REJECT (return null) if any of these apply:
- Article is a generic listicle/roundup with many unrelated events ("10 best things to do this weekend", "things to do in May") and no single headline event
- Article describes an ongoing attraction with no fixed end date (a permanent museum reopening, a new restaurant)
- starts_at or ends_at cannot be determined from explicit text
- The end date has clearly already passed
- venue_address is not in Singapore
- Event spans more than 4 months (likely an attraction, not an event)

Return ONLY raw JSON or the literal "null" — no markdown, no commentary.`

  const raw = (
    await chatComplete({ model: 'gemini-2.5-flash', prompt, feature: 'tsl-events' })
  ).trim()
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
  const opens_at = typeof v.opens_at === 'string' && /^\d{4}$/.test(v.opens_at) ? v.opens_at : null
  const closes_at =
    typeof v.closes_at === 'string' && /^\d{4}$/.test(v.closes_at) ? v.closes_at : null

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
    opens_at,
    closes_at,
    ticket_url:
      typeof v.ticket_url === 'string' && /^https?:\/\//.test(v.ticket_url) ? v.ticket_url : null,
    photo_url,
    category_tags: category_tags.length > 0 ? category_tags : ['festival'],
    vibe_tags,
    is_outdoor: v.is_outdoor === true,
  }
}

async function extractRoundupEvents(
  title: string,
  url: string,
  text: string,
  imageUrls: string[]
): Promise<ExtractedEvent[]> {
  const imageList =
    imageUrls.length > 0
      ? imageUrls.map((u, i) => `  ${i}: ${u}`).join('\n')
      : '  (no images available)'

  const prompt = `You are extracting Singapore event recommendations from a TheSmartLocal weekend roundup page.

Article title: ${title}
Article URL: ${url}

Article text (truncated):
${text}

Available image URLs (photo_url MUST be from this list; use null if unsure):
${imageList}

Return a raw JSON array of up to 12 high-quality, date-bounded Singapore events from this roundup. Extract only events with explicit dates and a concrete Singapore venue. Skip restaurants, permanent attractions, generic suggestions, and entries whose date or venue is unclear.

For each event:
- name: event name
- venue_name: specific venue
- venue_address: most specific Singapore venue/address stated. If only venue name is stated, repeat the venue name.
- starts_at: YYYY-MM-DD. Infer year as 2026 for June dates on this 2026 roundup.
- ends_at: YYYY-MM-DD. If single-day, same as starts_at.
- opens_at: HHMM if stated, else null
- closes_at: HHMM if stated, else null
- ticket_url: official/event URL if the article gives one, else null
- photo_url: one URL from the list above, else null
- category_tags: 1-2 tags from ONLY: ${CATEGORY_TAGS.join(', ')}
- vibe_tags: 0-2 tags from ONLY: ${VIBE_TAGS.join(', ')}
- is_outdoor: true if primarily outdoors; false otherwise

Prefer fresh weekend picks, openings, festivals, flea markets, anime/culture markets, arts open studios, theatre, and family museum programmes. Return ONLY raw JSON; no markdown.`

  const raw = (
    await chatComplete({ model: 'gemini-2.5-flash', prompt, feature: 'tsl-events' })
  ).trim()
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: ExtractedEvent[] = []
  for (const item of parsed) {
    const event = normalizeExtractedEvent(item, imageUrls)
    if (event) out.push(event)
  }
  return out
}

function normalizeExtractedEvent(value: unknown, imageUrls: string[]): ExtractedEvent | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.name !== 'string' || !v.name) return null
  if (typeof v.venue_address !== 'string' || !v.venue_address) return null
  if (typeof v.starts_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.starts_at)) return null
  if (typeof v.ends_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.ends_at)) return null
  const opens_at = typeof v.opens_at === 'string' && /^\d{4}$/.test(v.opens_at) ? v.opens_at : null
  const closes_at =
    typeof v.closes_at === 'string' && /^\d{4}$/.test(v.closes_at) ? v.closes_at : null

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
    opens_at,
    closes_at,
    ticket_url:
      typeof v.ticket_url === 'string' && /^https?:\/\//.test(v.ticket_url) ? v.ticket_url : null,
    photo_url,
    category_tags: category_tags.length > 0 ? category_tags : ['community'],
    vibe_tags,
    is_outdoor: v.is_outdoor === true,
  }
}

const MONTHS: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
}

function extractStructuredEvent(
  title: string,
  text: string,
  imageUrls: string[]
): ExtractedEvent | null {
  const dateRange = parseDateRange(text)
  if (!dateRange) return null

  const name = eventNameFromTitle(decodeText(title))
  const venue = venueFromText(name, text)
  if (!venue) return null

  const times = parseTimeRange(text)
  return {
    name,
    venue_name: venue.name,
    venue_address: venue.address,
    starts_at: dateRange.starts_at,
    ends_at: dateRange.ends_at,
    opens_at: times?.opens_at ?? null,
    closes_at: times?.closes_at ?? null,
    ticket_url: null,
    photo_url: imageUrls[0] ?? null,
    category_tags: categoryTagsFor(name, text),
    vibe_tags: vibeTagsFor(name, text),
    is_outdoor: /outdoor|waterfront|marina bay|bayfront|festival village|open-air/i.test(text),
  }
}

function parseDateRange(text: string): { starts_at: string; ends_at: string } | null {
  const match = text.match(
    /(?:Dates?|Event date|Admission: Free Dates?):?\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|to)\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i
  )
  if (!match) return null
  const month = MONTHS[match[3].toLowerCase()]
  if (!month) return null
  return {
    starts_at: `${match[4]}-${month}-${match[1].padStart(2, '0')}`,
    ends_at: `${match[4]}-${month}-${match[2].padStart(2, '0')}`,
  }
}

function parseTimeRange(text: string): { opens_at: string; closes_at: string } | null {
  const match = text.match(
    /Time:?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\s*(?:-|–|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i
  )
  if (!match) return null
  return {
    opens_at: toHHMM(match[1], match[2] ?? '00', match[3]),
    closes_at: toHHMM(match[4], match[5] ?? '00', match[6]),
  }
}

function toHHMM(hourText: string, minuteText: string, meridiem: string): string {
  let hour = Number(hourText)
  if (meridiem.toLowerCase() === 'pm' && hour !== 12) hour += 12
  if (meridiem.toLowerCase() === 'am' && hour === 12) hour = 0
  return `${String(hour).padStart(2, '0')}${minuteText.padStart(2, '0')}`
}

function venueFromText(
  eventName: string,
  text: string
): { name: string; address: string } | null {
  if (/gastrobeats/i.test(eventName) || /bayfront event space/i.test(text)) {
    const address = text.match(/12A\s+Bayfront\s+Ave,?\s*Singapore\s+018970/i)?.[0]
    return {
      name: 'Bayfront Event Space',
      address: address ?? 'Bayfront Event Space, 12A Bayfront Ave, Singapore 018970',
    }
  }

  if (/i\s*light singapore/i.test(eventName)) {
    return {
      name: 'Marina Bay and Raffles Place',
      address: 'Marina Bay waterfront and Raffles Place, Singapore',
    }
  }

  const match = text.match(
    /(?:Venue|Locations?|Address):\s*([^:]+?)(?=\s+(?:Admission|Date|Time|More events|Past iterations|Also read|Photography|Get directions)|$)/i
  )
  const raw = match?.[1]?.replace(/\s+/g, ' ').trim()
  if (!raw) return null
  return { name: raw, address: raw }
}

function eventNameFromTitle(title: string): string {
  if (/i\s*light singapore\s*2026/i.test(title)) return 'i Light Singapore 2026'
  if (/gastrobeats\s*2026/i.test(title)) return 'GastroBeats 2026'
  return title
    .replace(/\s+[–-]\s+.*$/, '')
    .replace(/^Guide To\s+/i, '')
    .trim()
    .slice(0, 120)
}

function categoryTagsFor(name: string, text: string): string[] {
  if (/gastrobeats/i.test(name)) return ['festival', 'food_event']
  if (/i\s*light/i.test(name)) return ['festival', 'art']
  if (/exhibition|installation|gallery|art/i.test(text)) return ['exhibition', 'art']
  if (/music|concert|stage|live acts/i.test(text)) return ['music', 'festival']
  return ['festival']
}

function vibeTagsFor(name: string, text: string): ExtractedEvent['vibe_tags'] {
  if (/festival|free entry|live acts|celebratory|gastrobeats/i.test(`${name} ${text}`)) {
    return ['celebratory']
  }
  if (/hands-on|interactive|adventure|pickleball/i.test(text)) return ['adventurous']
  return []
}

function decodeText(text: string): string {
  return cheerio.load(`<p>${text}</p>`)('p').text().replace(/\s+/g, ' ').trim()
}

function isKnownRoundup(url: string): boolean {
  try {
    return TSL_ROUNDUP_PATHS.has(new URL(url).pathname)
  } catch {
    return false
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

  const known = knownEventLocation(`${venueName} ${address}`)
  if (known) return known

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

function knownEventLocation(raw: string): { lat: number; lng: number; resolvedAddress: string } | null {
  if (/bayfront event space/i.test(raw)) {
    return {
      lat: 1.281514,
      lng: 103.858649,
      resolvedAddress: 'Bayfront Event Space, 12A Bayfront Ave, Singapore 018970',
    }
  }
  if (/i\s*light|marina bay.*raffles place|raffles place.*marina bay/i.test(raw)) {
    return {
      lat: 1.283477,
      lng: 103.859099,
      resolvedAddress: 'Marina Bay waterfront and Raffles Place, Singapore',
    }
  }
  if (/suntec|doki|mercury|twilight flea/i.test(raw)) {
    return {
      lat: 1.29317,
      lng: 103.85728,
      resolvedAddress: /hall\s*405/i.test(raw)
        ? 'Suntec Singapore Convention & Exhibition Centre, Hall 405, 1 Raffles Boulevard, Singapore 039593'
        : 'Suntec Singapore Convention & Exhibition Centre, 1 Raffles Boulevard, Singapore 039593',
    }
  }
  if (/goodman/i.test(raw)) {
    return {
      lat: 1.3068,
      lng: 103.8865,
      resolvedAddress: 'Goodman Arts Centre, 90 Goodman Road, Singapore 439053',
    }
  }
  if (/children'?s season|children'?s museum/i.test(raw)) {
    return {
      lat: 1.2938,
      lng: 103.8498,
      resolvedAddress: "Children's Museum Singapore and participating museums islandwide",
    }
  }
  if (/interrogation|kc arts|merbau/i.test(raw)) {
    return {
      lat: 1.2914,
      lng: 103.8417,
      resolvedAddress: 'KC Arts Centre, 20 Merbau Road, Singapore 239035',
    }
  }
  if (/bigger.*closer|imba theatre|gardens by the bay/i.test(raw)) {
    return {
      lat: 1.2824,
      lng: 103.8648,
      resolvedAddress: 'IMBA Theatre, Gardens by the Bay, 18 Marina Gardens Drive, Singapore 018953',
    }
  }
  return null
}

function eventHours(open: string | null, close: string | null): HoursJson {
  if (!open || !close) return DEFAULT_EVENT_HOURS
  return {
    mon: [{ open, close }],
    tue: [{ open, close }],
    wed: [{ open, close }],
    thu: [{ open, close }],
    fri: [{ open, close }],
    sat: [{ open, close }],
    sun: [{ open, close }],
  }
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

    let extractedEvents: ExtractedEvent[] = []
    try {
      const event = await extractEvent(
        post.title.rendered,
        post.link,
        article.text,
        article.imageUrls
      )
      if (event) {
        extractedEvents = [event]
      } else if (isKnownRoundup(post.link)) {
        extractedEvents = await extractRoundupEvents(
          post.title.rendered,
          post.link,
          article.text,
          article.imageUrls
        )
      }
    } catch {
      continue
    }
    if (extractedEvents.length === 0) continue

    for (const event of extractedEvents) {
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
        // Prefer stated event hours (e.g. i Light 7.30pm-10.30pm,
        // GastroBeats 4pm-11pm). Fall back to a broad festival window so
        // date-bounded events remain discoverable when article times are absent.
        hours: eventHours(event.opens_at, event.closes_at),
        ticket_url: event.ticket_url,
      })
    }
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
  trending_score: number
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
    trending_score: eventTrendPrior(e.starts_at, e.ends_at),
    active: daysUntilEnd >= -1,
    source: 'editorial',
    source_id: e.source_id,
    source_url: e.source_url,
    last_synced_at: new Date().toISOString(),
  }
}

function eventTrendPrior(startsAt: string, endsAt: string): number {
  const now = Date.now()
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0

  const daysSinceStart = Math.floor((now - start) / 86_400_000)
  const daysUntilStart = Math.ceil((start - now) / 86_400_000)
  const daysUntilEnd = Math.ceil((end - now) / 86_400_000)

  if (daysSinceStart >= 0 && daysSinceStart <= 3) return 0.95
  if (daysSinceStart > 3 && daysSinceStart <= 14) return 0.8
  if (daysUntilStart > 0 && daysUntilStart <= 7) return 0.65
  if (daysUntilEnd >= 0 && daysUntilEnd <= 3) return 0.75
  if (daysUntilEnd > 3 && daysUntilEnd <= 14) return 0.55
  return 0
}
