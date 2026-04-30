export type LatLng = { lat: number; lng: number }

export type HoursWindow = { open: string; close: string }
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type HoursJson = Partial<Record<DayKey, HoursWindow[]>>

export type Badge = 'closing_soon' | 'soft_launch' | 'critic_pick' | 'award_fresh' | 'none'

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
