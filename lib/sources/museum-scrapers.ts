// Museum scrapers for SAM and NGS. Each fetches live exhibition data and
// transforms it into the EditorialEvent shape for upsert into the venues table.
//
// Design rules:
//   - Every scraper is independently wrapped in try/catch -- one failure does
//     not block the others or the rest of the sync.
//   - source: 'museum' distinguishes scraped museum rows from editorial ones.
//   - source_url always points to the official exhibition page (honesty contract).
//   - start dates not shown on listing pages default to Jan 1 of the current year.
//
// NHB (National Museum of Singapore) is JS-rendered -- not scrapeable with a
// plain fetch. Add NHB exhibitions to editorial-events.ts instead.
// ArtScience Museum (MBS) times out -- same workaround.

import * as cheerio from 'cheerio'
import type { HoursJson, Venue } from '@/lib/planner/types'
import type { EditorialEvent } from './editorial-events'

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}
function monthNum(abbr: string): number | undefined {
  return MONTHS[abbr.toUpperCase()]
}

const CLOSING_SOON_DAYS = 30

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Gabo/1.0)',
  'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
}

// --- SAM ----------------------------------------------------------------------
// Listing: https://www.singaporeartmuseum.sg/art-events
// Card:    <a class="exhibition" href="/art-events/exhibitions/{slug}">
//            <div class="exhibition__img"><img src="/-/media/..."></div>
//            <div class="exhibition-item__text">
//              <span class="exhibition__title">…</span>
//              <span class="exhibition__status">UNTIL 31 MAY '26</span>
//              <span class="exhibition__info">…location…</span>
//            </div>
//          </a>

const SAM_BASE = 'https://www.singaporeartmuseum.sg'
const SAM_LISTING = `${SAM_BASE}/art-events`

// SAM relocated to Tanjong Pagar Distripark (39 Keppel Rd) in 2024.
const SAM_LAT = 1.2706
const SAM_LNG = 103.8259
const SAM_ADDRESS = '39 Keppel Rd, Singapore 089065'
// Tue-Sun 10 am-7 pm (closed Monday)
const SAM_HOURS: HoursJson = {
  tue: [{ open: '1000', close: '1900' }],
  wed: [{ open: '1000', close: '1900' }],
  thu: [{ open: '1000', close: '1900' }],
  fri: [{ open: '1000', close: '1900' }],
  sat: [{ open: '1000', close: '1900' }],
  sun: [{ open: '1000', close: '1900' }],
}

// "UNTIL 31 MAY '26" → "2026-05-31"
function parseSamStatus(raw: string): string | null {
  const clean = raw.replace(/ /g, ' ').trim()
  const m = clean.match(/UNTIL\s+(\d{1,2})\s+([A-Z]+)\s+[''`](\d{2})/i)
  if (!m) return null
  const mn = monthNum(m[2])
  if (!mn) return null
  return `20${m[3]}-${String(mn).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

export async function fetchSamExhibitions(): Promise<EditorialEvent[]> {
  const html = await fetch(SAM_LISTING, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(12_000),
  }).then(r => r.text())

  const $ = cheerio.load(html)
  const seen = new Set<string>()
  const events: EditorialEvent[] = []

  $('a.exhibition[href*="/art-events/exhibitions/"]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const slug = href.split('/').pop() ?? ''
    if (!slug || seen.has(slug)) return
    seen.add(slug)

    const title = $(el).find('.exhibition__title').text().trim()
    const statusText = $(el).find('.exhibition__status').text().trim()
    const location = $(el).find('.exhibition__info').text().trim()

    if (!title) return
    if (/virtual/i.test(location)) return // skip virtual exhibitions

    const endsAt = parseSamStatus(statusText)
    if (!endsAt || new Date(endsAt) < new Date()) return

    const imgSrc = $(el).find('.exhibition__img img').attr('src') ?? ''
    const photoUrl = imgSrc ? `${SAM_BASE}${imgSrc.split('?')[0]}` : null

    events.push({
      source_id: `sam-${slug}`,
      source_url: `${SAM_BASE}${href}`,
      name: title,
      address: SAM_ADDRESS,
      lat: SAM_LAT,
      lng: SAM_LNG,
      starts_at: `${new Date().getFullYear()}-01-01`,
      ends_at: endsAt,
      cuisine_tags: ['experience', 'exhibition', 'art'],
      vibe_tags: ['low_key'],
      photo_url: photoUrl,
      budget_band: 2,
      hours: SAM_HOURS,
    })
  })

  return events
}

// --- NGS ----------------------------------------------------------------------
// Listing: https://www.nationalgallery.sg/sg/en/whats-on.html
//   -- contains hrefs matching /sg/en/exhibitions/*.html
// Detail:  <meta property="og:title" content="…">
//           <meta property="og:image" content="…">
//           <h1 class="h2"><span><b>When:</b> 1 Apr - 23 Aug 2026 </span>…</h1>

const NGS_BASE = 'https://www.nationalgallery.sg'
const NGS_LISTING = `${NGS_BASE}/sg/en/whats-on.html`

const NGS_LAT = 1.2904
const NGS_LNG = 103.8519
const NGS_ADDRESS = "1 St Andrew's Rd, Singapore 178957"
// Daily 10 am-7 pm; Fri until 9 pm
const NGS_HOURS: HoursJson = {
  mon: [{ open: '1000', close: '1900' }],
  tue: [{ open: '1000', close: '1900' }],
  wed: [{ open: '1000', close: '1900' }],
  thu: [{ open: '1000', close: '1900' }],
  fri: [{ open: '1000', close: '2100' }],
  sat: [{ open: '1000', close: '1900' }],
  sun: [{ open: '1000', close: '1900' }],
}

// "1 Apr – 23 Aug 2026" (en-dash from NGS) or "1 Apr 2025 – 23 Aug 2026"
function parseNgsDate(raw: string): { starts_at: string; ends_at: string } | null {
  const m = raw.match(
    /(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s*[–—\-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/
  )
  if (!m) return null
  const endYear = parseInt(m[6])
  const startYear = m[3] ? parseInt(m[3]) : endYear
  const sm = monthNum(m[2])
  const em = monthNum(m[5])
  if (!sm || !em) return null
  return {
    starts_at: `${startYear}-${String(sm).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
    ends_at: `${endYear}-${String(em).padStart(2, '0')}-${m[4].padStart(2, '0')}`,
  }
}

async function fetchNgsDetail(url: string): Promise<{
  title: string
  starts_at: string
  ends_at: string
  photo_url: string | null
} | null> {
  const html = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(12_000),
  }).then(r => r.text())
  const $ = cheerio.load(html)

  const rawTitle = $('meta[property="og:title"]').attr('content') ?? ''
  const title = rawTitle.replace(/\s*\|\s*National Gallery Singapore\s*$/i, '').trim()
  const photoUrl = $('meta[property="og:image"]').attr('content') ?? null

  let dateText = ''
  // Primary: date is in an h1/h2 span starting with "When:"
  $('h1 span, .h1 span, .h2 span').each((_, el) => {
    if (dateText) return
    const t = $(el).text()
    if (/when:/i.test(t)) dateText = t.replace(/when:\s*/i, '').trim()
  })
  // Fallback: dt → dd pattern
  if (!dateText) {
    $('dt').each((_, el) => {
      if (dateText) return
      if (/when/i.test($(el).text())) dateText = $(el).next('dd').text().trim()
    })
  }

  if (!title || !dateText) return null
  const dates = parseNgsDate(dateText)
  if (!dates) return null
  return { title, ...dates, photo_url: photoUrl }
}

export async function fetchNgsExhibitions(): Promise<EditorialEvent[]> {
  const html = await fetch(NGS_LISTING, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(12_000),
  }).then(r => r.text())
  const $ = cheerio.load(html)

  const urls = new Set<string>()
  $('a[href*="/sg/en/exhibitions/"][href$=".html"]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const full = href.startsWith('http') ? href : `${NGS_BASE}${href}`
    urls.add(full)
  })

  const urlArr = [...urls].slice(0, 20)
  const results = await Promise.allSettled(urlArr.map(u => fetchNgsDetail(u)))

  const seen = new Set<string>()
  const events: EditorialEvent[] = []

  results.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) return
    const { title, starts_at, ends_at, photo_url } = r.value
    if (new Date(ends_at) < new Date()) return

    const url = urlArr[i]
    const slug = url.split('/').pop()?.replace('.html', '') ?? ''
    if (!slug || seen.has(slug)) return
    seen.add(slug)

    events.push({
      source_id: `ngs-${slug}`,
      source_url: url,
      name: title,
      address: NGS_ADDRESS,
      lat: NGS_LAT,
      lng: NGS_LNG,
      starts_at,
      ends_at,
      cuisine_tags: ['experience', 'exhibition', 'art'],
      vibe_tags: ['low_key'],
      photo_url,
      budget_band: 1,
      hours: NGS_HOURS,
    })
  })

  return events
}

// --- Transformer --------------------------------------------------------------
// Same shape as editorialEventToVenue but uses source: 'museum'.

export function museumEventToVenue(e: EditorialEvent): Omit<Venue, 'id'> & {
  source: 'museum'
  source_id: string
  source_url: string
  last_synced_at: string
} {
  const ends = new Date(e.ends_at)
  const daysUntilEnd = Math.round((ends.getTime() - Date.now()) / 86_400_000)
  const closingSoon = daysUntilEnd >= 0 && daysUntilEnd <= CLOSING_SOON_DAYS

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
    chope_url: e.source_url,
    hours_json: e.hours ?? null,
    ph_hours_json: null,
    badge: closingSoon ? 'closing_soon' : 'none',
    badge_meta: { ends_at: e.ends_at, reason: 'official end date' },
    trending_score: 0,
    active: daysUntilEnd >= -1,
    source: 'museum',
    source_id: e.source_id,
    source_url: e.source_url,
    last_synced_at: new Date().toISOString(),
  }
}
