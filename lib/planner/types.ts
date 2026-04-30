export type LatLng = { lat: number; lng: number }

export type HoursWindow = { open: string; close: string }
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type HoursJson = Partial<Record<DayKey, HoursWindow[]>>

export type Badge = 'closing_soon' | 'soft_launch' | 'critic_pick' | 'award_fresh' | 'none'

export type VenueSource =
  | 'google_places'
  | 'foursquare'
  | 'bandsintown'
  | 'sistic'
  | 'museum'
  | 'editorial'
  | 'manual'

export type Venue = {
  id: string
  name: string
  lat: number
  lng: number
  address: string | null
  cuisine_tags: string[]
  vibe_tags: string[]
  dietary_flags: string[]
  budget_band: number
  is_outdoor: boolean
  photo_url: string | null
  chope_url: string | null
  hours_json: HoursJson | null
  ph_hours_json: HoursJson | null
  badge: Badge
  badge_meta: Record<string, unknown> | null
  trending_score: number
  active: boolean
  // Provenance — where the catalog row came from. Surfaced in the UI per
  // each provider's TOS (Google requires "via Google", Foursquare similar).
  // Older hand-seeded rows default to 'manual'; editorial rows must have a
  // source_url pointing to the official public page.
  source?: VenueSource
  source_id?: string | null
  source_url?: string | null
  last_synced_at?: string | null
}

export type VibeTag = 'cozy' | 'adventurous' | 'celebratory' | 'low_key'

// Display mode for the FairnessPill / ETA surfaces. API always returns driving
// minutes; client derives 'transit' on the fly via simulatedMrtEta.
export type TransitMode = 'drive' | 'transit'

export type Profile = {
  planner_name: string
  partner_name: string
  cuisines_loved: string[]
  cuisines_avoided: string[]
  dietary_hardstops: string[]
  // Multi-select: any of these vibes counts as a match.
  vibe_defaults: VibeTag[]
  // Multi-select: allowed budget bands. Empty means no filter.
  budget_bands: number[]
  transit_pref: 'mrt' | 'grab' | 'either'
}

export type Override = 'vegetarian' | 'no_alcohol' | 'anniversary' | 'birthday'

export type RankedVenue = Venue & {
  eta_a_min: number
  eta_b_min: number
  fairness_gap_min: number
  score: number
  components: { fairness: number; match: number; freshness: number; friction: number }
}

export type Category = 'dining' | 'event'

export type PlanCard = RankedVenue & {
  bucket: Category
}
