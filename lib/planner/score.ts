import type { Badge, PlanCard, Profile, RankedVenue, Venue, VibeTag } from './types'

const BADGE_VALUES: Record<Badge, number> = {
  closing_soon: 1.0,
  soft_launch: 0.8,
  critic_pick: 0.7,
  award_fresh: 0.6,
  none: 0,
}

export function freshness(venue: Venue): number {
  return BADGE_VALUES[venue.badge] + 0.3 * venue.trending_score
}

export function matchScore(venue: Venue, profile: Profile): number {
  const loved = profile.cuisines_loved ?? []
  const denom = Math.max(loved.length, 1)
  const hits = venue.cuisine_tags.filter((c) => loved.includes(c)).length
  let m = hits / denom
  // Any selected vibe matching counts — don't double-dip.
  const vibes = profile.vibe_defaults ?? []
  if (vibes.length > 0 && venue.vibe_tags.some((v) => vibes.includes(v as VibeTag))) m += 0.5
  return m
}

// Used to cap candidates BEFORE hitting the Routing API (which costs quota).
// We can't compute fairness/friction without ETAs, so we only use match + freshness.
// Weights mirror the post-routing formula.
export function prescore(venue: Venue, profile: Profile): number {
  return 0.3 * matchScore(venue, profile) + 0.25 * freshness(venue)
}

export function scoreWithETAs(
  venue: Venue,
  profile: Profile,
  etaAMin: number,
  etaBMin: number,
  overrides: string[]
): RankedVenue {
  const gap = Math.abs(etaAMin - etaBMin)
  const fairness = 1 / (1 + gap)
  const match = matchScore(venue, profile)
  const fresh = freshness(venue)
  const friction = (etaAMin + etaBMin) / 60

  // Override-driven weight shift (PRD §4.5). Celebrations promote freshness, soften friction.
  const celebratory = overrides.includes('anniversary') || overrides.includes('birthday')
  const w = celebratory
    ? { fairness: 0.35, match: 0.2, freshness: 0.4, friction: 0.05 }
    : { fairness: 0.35, match: 0.3, freshness: 0.25, friction: 0.1 }

  const score =
    w.fairness * fairness + w.match * match + w.freshness * fresh - w.friction * friction

  return {
    ...venue,
    eta_a_min: etaAMin,
    eta_b_min: etaBMin,
    fairness_gap_min: gap,
    score,
    components: { fairness, match, freshness: fresh, friction },
  }
}

// Simulated MRT ETA per PRD §6. Label as "demo estimate" in UI.
export function simulatedMrtEta(drivingEtaMin: number): number {
  return Math.round(drivingEtaMin * 1.4) + 5
}

export type Buckets = {
  safe: PlanCard[]
  stretch: PlanCard[]
  wild: PlanCard[]
}

// Bucket into Safe / Stretch / Wild per PRD §4.4, up to 3 per bucket (9 total).
// Relaxes fairness cap from 15 → 20 → 25 if we get fewer than 3 cards across
// all buckets (so the user always sees something).
export function bucketCards(ranked: RankedVenue[]): Buckets {
  for (const cap of [15, 20, 25]) {
    const buckets = pickBuckets(ranked, cap)
    const total = buckets.safe.length + buckets.stretch.length + buckets.wild.length
    if (total >= 3 || cap === 25) return buckets
  }
  return { safe: [], stretch: [], wild: [] }
}

function pickBuckets(ranked: RankedVenue[], fairnessCap: number): Buckets {
  const pool = ranked.filter(
    (r) => r.fairness_gap_min <= fairnessCap && Math.max(r.eta_a_min, r.eta_b_min) <= 60
  )

  // SAFE: up to 3 with low freshness + tight fairness, ranked by match.
  const safe = [...pool]
    .filter((r) => r.components.freshness <= 0.3 && r.fairness_gap_min <= 8)
    .sort((a, b) => b.components.match - a.components.match)
    .slice(0, 3)
    .map((r) => tag(r, 'safe'))
  const safeIds = new Set(safe.map((s) => s.id))

  // WILD: up to 3 by freshness (among non-safe). These are the buzzy / fresh picks.
  const wild = [...pool]
    .filter((r) => !safeIds.has(r.id))
    .sort((a, b) => b.components.freshness - a.components.freshness)
    .slice(0, 3)
    .map((r) => tag(r, 'wild'))
  const wildIds = new Set(wild.map((w) => w.id))

  // STRETCH: up to 3 by overall score, excluding safe + wild.
  // Prefer venues with some freshness (>= 0.5) if there are enough.
  const stretchAll = [...pool]
    .filter((r) => !safeIds.has(r.id) && !wildIds.has(r.id))
    .sort((a, b) => b.score - a.score)
  const fresher = stretchAll.filter((r) => r.components.freshness >= 0.5)
  const stretchSource = fresher.length >= 3 ? fresher : stretchAll
  const stretch = stretchSource.slice(0, 3).map((r) => tag(r, 'stretch'))

  return { safe, stretch, wild }
}

function tag(r: RankedVenue, bucket: PlanCard['bucket']): PlanCard {
  return { ...r, bucket }
}
