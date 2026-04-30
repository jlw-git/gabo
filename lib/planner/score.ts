import { isEvent } from './category'
import type { Badge, Category, PlanCard, Profile, RankedVenue, Venue, VibeTag } from './types'

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

// One start point provided. Score with friction from that single ETA; fairness
// is meaningless so we set it to 1 and store the same minute count in both ETA
// fields so downstream UI can render either field interchangeably.
export function scoreWithSingleEta(
  venue: Venue,
  profile: Profile,
  etaMin: number,
  overrides: string[]
): RankedVenue {
  const match = matchScore(venue, profile)
  const fresh = freshness(venue)
  const friction = etaMin / 30 // single-leg normalization

  const celebratory = overrides.includes('anniversary') || overrides.includes('birthday')
  const w = celebratory
    ? { match: 0.3, freshness: 0.6, friction: 0.1 }
    : { match: 0.45, freshness: 0.4, friction: 0.15 }

  const score = w.match * match + w.freshness * fresh - w.friction * friction

  return {
    ...venue,
    eta_a_min: etaMin,
    eta_b_min: etaMin,
    fairness_gap_min: 0,
    score,
    components: { fairness: 1, match, freshness: fresh, friction },
  }
}

// No locations provided. Score by match + freshness only; ETAs are 0 and the
// UI suppresses the FairnessPill when both ETAs are 0.
export function scoreWithoutEtas(venue: Venue, profile: Profile, overrides: string[]): RankedVenue {
  const match = matchScore(venue, profile)
  const fresh = freshness(venue)
  const celebratory = overrides.includes('anniversary') || overrides.includes('birthday')
  const w = celebratory ? { match: 0.3, freshness: 0.7 } : { match: 0.5, freshness: 0.5 }
  const score = w.match * match + w.freshness * fresh
  return {
    ...venue,
    eta_a_min: 0,
    eta_b_min: 0,
    fairness_gap_min: 0,
    score,
    components: { fairness: 0, match, freshness: fresh, friction: 0 },
  }
}

// Simulated MRT ETA per PRD §6. Label as "demo estimate" in UI.
export function simulatedMrtEta(drivingEtaMin: number): number {
  return Math.round(drivingEtaMin * 1.4) + 5
}

export type Buckets = {
  dining: PlanCard[]
  events: PlanCard[]
}

const PER_CATEGORY_CAP = 6
const MAX_ETA_MIN = 60

// Split routed candidates into Dining and Events tabs, sorted by score.
// When ETAs are populated, drop venues over 60 min from either start; with
// no ETAs, that filter is a no-op and everything passes through.
export function bucketByCategory(ranked: RankedVenue[]): Buckets {
  const reachable = ranked.filter((r) => {
    const maxEta = Math.max(r.eta_a_min, r.eta_b_min)
    return maxEta === 0 || maxEta <= MAX_ETA_MIN
  })

  const dining: PlanCard[] = []
  const events: PlanCard[] = []
  for (const r of [...reachable].sort((a, b) => b.score - a.score)) {
    const category: Category = isEvent(r) ? 'event' : 'dining'
    const list = category === 'event' ? events : dining
    if (list.length >= PER_CATEGORY_CAP) continue
    list.push({ ...r, bucket: category })
  }
  return { dining, events }
}
