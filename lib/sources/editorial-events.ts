// Editorial events source. Covers SG exhibitions, pop-ups, and limited runs
// that are JS-rendered (ArtScience, NHB) or lack a public API/feed.
//
// Honesty contract:
//   1. source_url MUST point to a public source page a user can verify
//      (official page preferred; reputable editorial guide acceptable for
//      short-lived pop-ups that only surface there first).
//   2. starts_at, ends_at, venue, and hours must come from that source page,
//      or from a second verified source when the listing is incomplete.
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
  // Required: source URL that any user can verify.
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
  summary?: string
  trending_score?: number
}

// ArtScience Museum, NHB, and Gardens by the Bay exhibitions are now
// discovered automatically by the museum agent (lib/sources/museum-agent.ts).
// Esplanade's own programming comes from lib/sources/esplanade.ts.
//
// Add entries here only for venues that:
//   - have no live scraper and no API feed
//   - are not covered by the museum agent
//   - have a verifiable source_url and end date
//
// The June 2026 anchors below cover a different failure mode: very fresh,
// high-quality weekend event guides often land first in editorial sources
// before slower venue feeds or category crawlers catch them. Keeping a compact,
// high-signal set here gives Gabo a reliable baseline for time-sensitive
// recommendations while the live source agents continue to broaden coverage.
export const EDITORIAL_EVENTS: EditorialEvent[] = [
  {
    source_id: 'editorial-cj-hendry-flower-market-singapore-2026',
    source_url:
      'https://www.gardensbythebay.com.sg/en/things-to-do/calendar-of-events/flower-market-by-cj-hendry.html',
    name: 'Flower Market by Cj Hendry',
    address: 'IMBA Theatre, 18 Marina Gardens Drive, Singapore 018953',
    lat: 1.2824,
    lng: 103.8648,
    starts_at: '2026-06-10',
    ends_at: '2026-06-14',
    cuisine_tags: ['experience', 'art', 'immersive', 'pop_up'],
    vibe_tags: ['celebratory', 'adventurous'],
    budget_band: 1,
    hours: dailyHours('0900', '2100'),
    summary:
      'A five-day plush flower installation at IMBA Theatre with free entry, pre-registration, and limited walk-ins.',
    trending_score: 1,
  },
  {
    source_id: 'editorial-cj-hendry-juju-world-singapore-2026',
    source_url: 'https://imbaglobal.com/whats-on/cj-hendry-flower-market-singapore',
    name: 'Cj Hendry: JuJu World',
    address: 'IMBA Theatre, 18 Marina Gardens Drive, Singapore 018953',
    lat: 1.2824,
    lng: 103.8648,
    starts_at: '2026-06-20',
    ends_at: '2026-07-18',
    cuisine_tags: ['experience', 'art', 'immersive', 'pop_up'],
    vibe_tags: ['celebratory', 'adventurous'],
    budget_band: 2,
    hours: dailyHours('1000', '2100'),
    summary:
      'The follow-up Cj Hendry immersive toy-world installation at Gardens by the Bay, opening after Flower Market.',
    trending_score: 0.9,
  },
  {
    source_id: 'editorial-i-light-singapore-2026',
    source_url: 'https://cnalifestyle.channelnewsasia.com/living/i-light-singapore-festival-2026-584026',
    name: 'i Light Singapore 2026',
    address: 'Marina Bay waterfront and Raffles Place, Singapore',
    lat: 1.283477,
    lng: 103.859099,
    starts_at: '2026-06-05',
    ends_at: '2026-06-28',
    cuisine_tags: ['experience', 'art', 'outdoor', 'festival'],
    vibe_tags: ['adventurous', 'celebratory'],
    is_outdoor: true,
    budget_band: 1,
    hours: dailyHours('1930', '2230'),
    summary:
      'A free night walk through Marina Bay with glowing installations, giant light flowers, and festival energy right as it opens.',
    trending_score: 0.95,
  },
  {
    source_id: 'editorial-gastrobeats-2026',
    source_url: 'https://eatbook.sg/gastrobeats-2026-food-guide/',
    name: 'GastroBeats 2026',
    address: 'Bayfront Event Space, 12A Bayfront Ave, Singapore 018970',
    lat: 1.281514,
    lng: 103.858649,
    starts_at: '2026-06-05',
    ends_at: '2026-06-28',
    cuisine_tags: ['experience', 'food', 'festival', 'nightlife'],
    vibe_tags: ['celebratory', 'adventurous'],
    is_outdoor: true,
    budget_band: 2,
    hours: dailyHours('1600', '2300'),
    summary:
      'A Bayfront food festival with 40-plus stalls, carnival rides, pickleball courts, and an easy post-dinner wander.',
    trending_score: 0.95,
  },
  {
    source_id: 'editorial-mercury-festival-singapore-2026',
    source_url: 'https://www.suntecsingapore.com/visit-events/mercury-festival-singapore-2026',
    name: 'Mercury Festival Singapore 2026',
    address: 'Suntec Singapore Convention & Exhibition Centre, 1 Raffles Boulevard, Singapore 039593',
    lat: 1.29317,
    lng: 103.85728,
    starts_at: '2026-06-05',
    ends_at: '2026-06-07',
    cuisine_tags: ['experience', 'market', 'fashion', 'festival'],
    vibe_tags: ['low_key', 'adventurous'],
    budget_band: 2,
    hours: dailyHours('1130', '2030'),
    summary:
      'A compact Suntec flea for vintage apparel, watches, tarot, and indie browsing before the evening winds down.',
    trending_score: 0.85,
  },
  {
    source_id: 'editorial-twilight-flea-feast-june-2026',
    source_url: 'https://www.timeout.com/singapore/things-to-do/twilight-flea-feast-june-2026',
    name: 'Twilight Flea & Feast',
    address:
      'Suntec Singapore Convention & Exhibition Centre, Halls 401-403, 1 Raffles Boulevard, Singapore 039593',
    lat: 1.29317,
    lng: 103.85728,
    starts_at: '2026-06-05',
    ends_at: '2026-06-07',
    cuisine_tags: ['experience', 'market', 'food', 'festival'],
    vibe_tags: ['celebratory', 'low_key'],
    budget_band: 2,
    hours: dailyHours('1200', '2200'),
    summary:
      'A weekend flea-meets-street-food fair with late hours, so it fits neatly after dinner or as the main plan.',
    trending_score: 0.9,
  },
  {
    source_id: 'editorial-doki-doki-anime-market-2026',
    source_url: 'https://www.suntecsingapore.com/visit-events/doki-doki-anime-market-singapore-2026',
    name: 'DOKI! DOKI! Anime Market Singapore 2026',
    address:
      'Suntec Singapore Convention & Exhibition Centre, Hall 405, 1 Raffles Boulevard, Singapore 039593',
    lat: 1.29317,
    lng: 103.85728,
    starts_at: '2026-06-06',
    ends_at: '2026-06-07',
    cuisine_tags: ['experience', 'anime', 'market', 'games'],
    vibe_tags: ['adventurous', 'celebratory'],
    budget_band: 2,
    hours: weekendHours('1100', '2000'),
    summary:
      'A homegrown anime artist-alley market packed with fan art, merch, cosplay, and Japanese pop-culture finds.',
    trending_score: 0.85,
  },
  {
    source_id: 'editorial-goodman-open-studio-day-2026',
    source_url: 'https://thesmartlocal.com/read/things-to-do-this-weekend-singapore/',
    name: 'Goodman Artventure Open Studio Day',
    address: 'Goodman Arts Centre, 90 Goodman Road, Singapore 439053',
    lat: 1.3068,
    lng: 103.8865,
    starts_at: '2026-06-06',
    ends_at: '2026-06-06',
    cuisine_tags: ['experience', 'art', 'workshop'],
    vibe_tags: ['low_key', 'adventurous'],
    budget_band: 1,
    hours: saturdayHours('1200', '2100'),
    summary:
      'A one-day open studio outing where you can roam the arts enclave, meet makers, and dip into creative trails.',
    trending_score: 0.75,
  },
  {
    source_id: 'editorial-childrens-season-2026',
    source_url: 'https://www.cgs.gov.sg/events/childrenseason2026/',
    name: "Children's Season 2026",
    address: "Children's Museum Singapore and participating museums islandwide",
    lat: 1.2938,
    lng: 103.8498,
    starts_at: '2026-05-30',
    ends_at: '2026-06-28',
    cuisine_tags: ['experience', 'museum', 'family', 'kids'],
    vibe_tags: ['low_key'],
    budget_band: 1,
    hours: dailyHours('1000', '2000'),
    summary:
      'A month-long museum season of family activities, sustainability-themed play, and kid-friendly programmes across Singapore.',
    trending_score: 0.7,
  },
  {
    source_id: 'editorial-an-interrogation-2026',
    source_url: 'https://sightlines.com.sg/experience/an-interrogation/',
    name: 'An Interrogation',
    address: 'KC Arts Centre, 20 Merbau Road, Singapore 239035',
    lat: 1.2914,
    lng: 103.8417,
    starts_at: '2026-06-04',
    ends_at: '2026-06-14',
    cuisine_tags: ['experience', 'theatre', 'immersive'],
    vibe_tags: ['adventurous'],
    budget_band: 3,
    hours: {
      thu: [{ open: '2000', close: '2115' }],
      fri: [{ open: '2000', close: '2115' }],
      sat: [
        { open: '1800', close: '1915' },
        { open: '2030', close: '2145' },
      ],
      sun: [{ open: '1600', close: '1715' }],
    },
    summary:
      'A tense immersive theatre piece built around a missing-person interrogation, with a tight 75-minute runtime.',
    trending_score: 0.8,
  },
  {
    source_id: 'editorial-david-hockney-bigger-closer-imba-2026',
    source_url: 'https://imbaglobal.com/whats-on/bigger-closer-%28not-smaller-further-away%29',
    name: 'David Hockney: Bigger & Closer',
    address: 'IMBA Theatre, Gardens by the Bay, 18 Marina Gardens Drive, Singapore 018953',
    lat: 1.2824,
    lng: 103.8648,
    starts_at: '2026-02-13',
    ends_at: '2026-06-30',
    cuisine_tags: ['experience', 'art', 'immersive', 'exhibition'],
    vibe_tags: ['low_key', 'adventurous'],
    budget_band: 3,
    hours: dailyHours('1730', '2200'),
    summary:
      'A large-scale immersive Hockney show at IMBA Theatre, good for a polished art-led evening at Gardens by the Bay.',
    trending_score: 0.75,
  },
]

function dailyHours(open: string, close: string): HoursJson {
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

function weekendHours(open: string, close: string): HoursJson {
  return { sat: [{ open, close }], sun: [{ open, close }] }
}

function saturdayHours(open: string, close: string): HoursJson {
  return { sat: [{ open, close }] }
}

const CLOSING_SOON_DAYS = 30
// An exhibition / pop-up / residency feels "just opened" while it's still in
// its first two weeks of the run. After that the novelty signal is stale —
// regulars have already been, write-ups have already landed.
const JUST_OPENED_DAYS = 14

export function editorialEventToVenue(e: EditorialEvent): Omit<Venue, 'id'> & {
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

  // closing_soon outranks soft_launch for the primary badge (used for ring
  // colour + freshness score). Both signals are persisted in badge_meta so
  // PlanCard can render multi-label chips when an event is short-run.
  let badge: 'closing_soon' | 'soft_launch' | 'none'
  if (closingSoon) badge = 'closing_soon'
  else if (justOpened) badge = 'soft_launch'
  else badge = 'none'

  // Always persist the run window so the planner can date-gate events (see
  // filterCandidates in lib/planner/plan-date.ts). `opened` is set whenever
  // the run started in the last JUST_OPENED_DAYS so the card can chip as
  // "Just opened" even when the badge is closing_soon.
  const baseMeta: Record<string, unknown> = { starts_at: e.starts_at, ends_at: e.ends_at }
  if (justOpened) baseMeta.opened = e.starts_at
  if (e.summary) baseMeta.summary = e.summary

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
    badge,
    badge_meta: baseMeta,
    trending_score: e.trending_score ?? 0,
    active: daysUntilEnd >= -1, // include events ending today
    source: 'editorial',
    source_id: e.source_id,
    source_url: e.source_url,
    last_synced_at: new Date().toISOString(),
  }
}
