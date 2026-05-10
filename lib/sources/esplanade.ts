// Esplanade in-house programming scraper.
//
// Strategy: Esplanade is a Sitecore site whose listing page is JS-rendered,
// but the sitemap.xml exposes every event URL and each event detail page
// includes a server-rendered JSON-LD `@type: Event` block with name,
// startDate, endDate, image, and description. We pull the sitemap, filter
// to /whats-on/{year}/{slug} URLs for the current+upcoming year, fetch each
// page, and parse the JSON-LD.
//
// Honesty contract:
//   - source_url MUST be the official esplanade.com page.
//   - starts_at / ends_at come straight from the JSON-LD on that page.
//
// The venue is always Esplanade itself (1 Esplanade Drive). Individual
// performance spaces (Theatre, Concert Hall, etc.) are not modelled — the
// planner needs one coordinate per row and Esplanade's complex is compact
// enough that one address suffices.

import * as cheerio from 'cheerio'
import type { HoursJson } from '@/lib/planner/types'
import type { EditorialEvent } from './editorial-events'

const ESPLANADE_BASE = 'https://www.esplanade.com'
const SITEMAP_URL = `${ESPLANADE_BASE}/sitemap.xml`

// 1 Esplanade Drive, Singapore 038981 — verified via OneMap.
const ESP_LAT = 1.2897
const ESP_LNG = 103.8559
const ESP_ADDRESS = '1 Esplanade Drive, Singapore 038981'

// Esplanade hours vary widely per show; for a permanent-venue row in the
// catalog we use the public box-office / mall-level baseline (10am–11pm
// daily) so the planner doesn't filter out a venue with an active event.
// The actual show time is encoded in the event's starts_at / ends_at — if
// we surface per-show times in the future, override this per row.
const ESP_HOURS: HoursJson = {
  mon: [{ open: '1000', close: '2300' }],
  tue: [{ open: '1000', close: '2300' }],
  wed: [{ open: '1000', close: '2300' }],
  thu: [{ open: '1000', close: '2300' }],
  fri: [{ open: '1000', close: '2300' }],
  sat: [{ open: '1000', close: '2300' }],
  sun: [{ open: '1000', close: '2300' }],
}

// Cap per run to bound cron time. Each event = one fetch (~1–2s).
const MAX_EVENTS_PER_RUN = 80

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Gabo/1.0)',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
}

function fetchOpts(): RequestInit {
  return { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15_000) }
}

// /whats-on/{year}/{slug} — year must be 4 digits, slug is kebab.
const EVENT_URL_RE = /^https:\/\/www\.esplanade\.com\/whats-on\/(\d{4})\/([a-z0-9-]+)\/?$/

// "4/22/2026 12:00:00 AM +08:00" → ISO "2026-04-22"
function parseSitecoreDate(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  const [, mo, d, y] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

// Esplanade's pageCategory meta carries the genre (theatre, music, dance,
// festival, etc.). Map to our cuisine_tag vocabulary; everything is also
// tagged 'experience' so the planner files it under Events.
const CATEGORY_MAP: Record<string, string[]> = {
  theatre: ['theatre', 'art'],
  music: ['music'],
  dance: ['dance', 'art'],
  film: ['art'],
  literary: ['art'],
  visual_arts: ['art', 'exhibition'],
  'visual-arts': ['art', 'exhibition'],
  festival: ['festival', 'art'],
  community: ['community'],
}

function extractEventJsonLd($: cheerio.CheerioAPI): {
  name?: string
  startDate?: string
  endDate?: string
  image?: string | string[]
  description?: string
} | null {
  let found: ReturnType<typeof JSON.parse> | null = null
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return
    const txt = $(el).contents().text().trim()
    if (!txt) return
    let parsed: unknown
    try {
      parsed = JSON.parse(txt)
    } catch {
      return
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed]
    for (const c of candidates) {
      if (c && typeof c === 'object' && (c as { '@type'?: string })['@type'] === 'Event') {
        found = c
        return
      }
    }
  })
  return found
}

export async function fetchEsplanadeEvents(): Promise<EditorialEvent[]> {
  const sitemapXml = await fetch(SITEMAP_URL, fetchOpts()).then((r) => r.text())
  const $sm = cheerio.load(sitemapXml, { xmlMode: true })

  const currentYear = new Date().getUTCFullYear()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const candidates: { url: string; year: number; slug: string }[] = []
  $sm('url > loc').each((_, el) => {
    const url = $sm(el).text().trim()
    const m = url.match(EVENT_URL_RE)
    if (!m) return
    const year = Number(m[1])
    if (year < currentYear) return // skip past-year events outright
    candidates.push({ url, year, slug: m[2] })
  })

  // Process near-term years first so the per-run cap covers events users
  // are most likely to plan for. Within a year keep sitemap order.
  candidates.sort((a, b) => a.year - b.year)

  const events: EditorialEvent[] = []
  let processed = 0

  for (const c of candidates) {
    if (processed >= MAX_EVENTS_PER_RUN) break
    processed++

    let html: string
    try {
      html = await fetch(c.url, fetchOpts()).then((r) => r.text())
    } catch {
      continue
    }

    const $ = cheerio.load(html)
    const ld = extractEventJsonLd($)
    if (!ld || typeof ld.name !== 'string' || !ld.startDate || !ld.endDate) continue

    const startsAt = parseSitecoreDate(ld.startDate)
    const endsAt = parseSitecoreDate(ld.endDate)
    if (!startsAt || !endsAt) continue
    if (new Date(endsAt) < today) continue // past event

    const name = decodeHtmlEntities(ld.name).trim()
    if (!name) continue

    const image = Array.isArray(ld.image) ? ld.image[0] : ld.image
    const photoUrl =
      typeof image === 'string' && image.startsWith('http') ? decodeHtmlEntities(image) : null

    const pageCategory =
      $('meta[name="pageCategory"]').attr('content')?.trim().toLowerCase() ?? ''
    const categoryTags = CATEGORY_MAP[pageCategory] ?? ['art']

    events.push({
      source_id: `esplanade-${c.year}-${c.slug}`,
      source_url: c.url,
      name,
      address: ESP_ADDRESS,
      lat: ESP_LAT,
      lng: ESP_LNG,
      starts_at: startsAt,
      ends_at: endsAt,
      cuisine_tags: ['experience', ...categoryTags],
      vibe_tags: ['celebratory'],
      photo_url: photoUrl,
      budget_band: 3, // theatre/concert tickets typically $40–$120
      hours: ESP_HOURS,
    })
  }

  return events
}
