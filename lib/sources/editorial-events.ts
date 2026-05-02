// Editorial events source. Covers SG exhibitions, pop-ups, and limited runs
// that are JS-rendered (ArtScience, NHB) or lack a public API/feed.
//
// Honesty contract:
//   1. source_url MUST point to the official public page (museum, gallery,
//      ticketing platform).
//   2. ends_at must come from that official page, not invented.
//   3. The schema constraint (venues_editorial_needs_source_url) enforces
//      source_url presence at insert time.
//
// SAM and NGS are now covered by live scrapers in museum-scrapers.ts.
// ArtScience and NHB remain here because their sites are JS-rendered and
// not fetch()-scrapeable. When Browserless/Playwright is available, move them.

import type { HoursJson, Venue } from '@/lib/planner/types'

export type EditorialEvent = {
  // Stable identifier we control. Use a slug -- re-runs with the same id
  // upsert the row, edits propagate.
  source_id: string
  // Required: official source URL that any user can verify.
  source_url: string
  name: string
  address: string
  lat: number
  lng: number
  starts_at: string // ISO date or datetime
  ends_at: string // ISO date -- must come from the source page
  cuisine_tags: string[] // includes 'experience' + e.g. 'art', 'exhibition'
  vibe_tags?: string[]
  is_outdoor?: boolean
  photo_url?: string | null
  budget_band?: number
  hours?: HoursJson | null
}

// The seed list. Update as exhibitions open / close. Each entry must have a
// real source_url -- verify before adding.
//
// NGS exhibitions are now covered by the NGS scraper in museum-scrapers.ts.
// NHB (National Museum of Singapore) is JS-rendered and can't be scraped --
// its confirmed exhibitions are kept here as editorial entries.
// ArtScience Museum (MBS) times out during scraping -- kept as editorial.
export const EDITORIAL_EVENTS: EditorialEvent[] = [
  // -- ArtScience Museum (MBS) ---------------------------------------------
  // Site times out; kept as editorial until scraping is feasible.
  {
    source_id: 'artscience-marvel-2026',
    source_url: 'https://www.marinabaysands.com/museum/exhibitions/marvel-the-exhibition.html',
    name: 'Marvel: The Exhibition',
    address: 'ArtScience Museum, 6 Bayfront Ave',
    lat: 1.286333,
    lng: 103.859581,
    starts_at: '2025-12-01T10:00:00+08:00',
    ends_at: '2026-05-15T19:00:00+08:00',
    cuisine_tags: ['experience', 'exhibition', 'art'],
    vibe_tags: ['adventurous', 'celebratory'],
    photo_url: null,
    budget_band: 2,
  },
  {
    source_id: 'artscience-vangogh-2026',
    source_url: 'https://www.marinabaysands.com/museum/exhibitions/van-gogh-the-immersive-experience.html',
    name: 'Van Gogh: The Immersive Experience',
    address: 'Resorts World Sentosa',
    lat: 1.2540,
    lng: 103.8238,
    starts_at: '2026-01-15T10:00:00+08:00',
    ends_at: '2026-06-30T20:00:00+08:00',
    cuisine_tags: ['experience', 'exhibition', 'art'],
    vibe_tags: ['cozy', 'celebratory'],
    photo_url: null,
    budget_band: 3,
  },

  // -- NHB / National Museum of Singapore ----------------------------------
  // JS-rendered; scraped dates verified manually from nhb.gov.sg.
  {
    source_id: 'nms-once-upon-a-tide-2026',
    source_url: 'https://www.nhb.gov.sg/nationalmuseum/whats-on/exhibition/once-upon-a-tide',
    name: "Once Upon a Tide: Singapore's Journey from Settlement to Global City",
    address: 'National Museum of Singapore, 93 Stamford Rd',
    lat: 1.2966,
    lng: 103.8481,
    starts_at: '2025-05-24',
    ends_at: '2026-10-09',
    cuisine_tags: ['experience', 'exhibition', 'history'],
    vibe_tags: ['low_key'],
    photo_url: null,
    budget_band: 1,
    hours: {
      mon: [{ open: '1000', close: '1900' }],
      tue: [{ open: '1000', close: '1900' }],
      wed: [{ open: '1000', close: '1900' }],
      thu: [{ open: '1000', close: '1900' }],
      fri: [{ open: '1000', close: '1900' }],
      sat: [{ open: '1000', close: '1900' }],
      sun: [{ open: '1000', close: '1900' }],
    },
  },

  // -- Other curated picks --------------------------------------------------
  {
    source_id: 'gardens-flower-dome-2026',
    source_url: 'https://www.gardensbythebay.com.sg/things-to-do/attractions/flower-dome.html',
    name: 'Flower Dome -- Gardens by the Bay',
    address: '18 Marina Gardens Dr',
    lat: 1.2839,
    lng: 103.8638,
    starts_at: '2026-01-01T09:00:00+08:00',
    ends_at: '2026-12-31T21:00:00+08:00',
    cuisine_tags: ['experience', 'nature', 'outdoor'],
    vibe_tags: ['cozy', 'low_key'],
    photo_url: null,
    is_outdoor: false,
    budget_band: 2,
  },
  {
    source_id: 'esplanade-current-2026',
    source_url: 'https://www.esplanade.com/whats-on',
    name: 'Esplanade -- Theatres on the Bay',
    address: '1 Esplanade Drive',
    lat: 1.2897,
    lng: 103.8559,
    starts_at: '2026-01-01T19:00:00+08:00',
    ends_at: '2026-12-31T22:00:00+08:00',
    cuisine_tags: ['experience', 'music', 'arts'],
    vibe_tags: ['celebratory'],
    photo_url: null,
    budget_band: 3,
  },
]

const CLOSING_SOON_DAYS = 30

export function editorialEventToVenue(e: EditorialEvent): Omit<Venue, 'id'> & {
  source: 'editorial'
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
    chope_url: e.source_url, // event-side reservation = the source page itself
    hours_json: e.hours ?? null,
    ph_hours_json: null,
    badge: closingSoon ? 'closing_soon' : 'none',
    badge_meta: closingSoon ? { ends_at: e.ends_at, reason: 'official end date' } : null,
    trending_score: 0,
    active: daysUntilEnd >= -1, // include events ending today
    source: 'editorial',
    source_id: e.source_id,
    source_url: e.source_url,
    last_synced_at: new Date().toISOString(),
  }
}
