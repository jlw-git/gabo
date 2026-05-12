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

// ArtScience Museum, NHB, and Gardens by the Bay exhibitions are now
// discovered automatically by the museum agent (lib/sources/museum-agent.ts).
// Esplanade is a permanent venue covered by Bandsintown for specific shows.
//
// This array is intentionally empty. Add entries here only for venues that:
//   - have no live scraper and no API feed
//   - are not covered by the museum agent
//   - have a verifiable official source_url and end date
export const EDITORIAL_EVENTS: EditorialEvent[] = []

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
    trending_score: 0,
    active: daysUntilEnd >= -1, // include events ending today
    source: 'editorial',
    source_id: e.source_id,
    source_url: e.source_url,
    last_synced_at: new Date().toISOString(),
  }
}
