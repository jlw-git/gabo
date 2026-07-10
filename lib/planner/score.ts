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
  return (
    BADGE_VALUES[venue.badge] +
    0.45 * venue.trending_score +
    noveltyBoost(venue) +
    sourceVelocityBoost(venue)
  )
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
  return 0.25 * matchScore(venue, profile) + 0.4 * freshness(venue)
}

function noveltyBoost(venue: Venue): number {
  const meta = venue.badge_meta
  const startsAt = typeof meta?.starts_at === 'string' ? meta.starts_at : null
  const openedAt = typeof meta?.opened === 'string' ? meta.opened : null

  if (startsAt) {
    const days = daysSince(startsAt)
    if (days >= 0 && days <= 3) return 0.55
    if (days > 3 && days <= 14) return 0.35

    const daysUntil = -days
    if (daysUntil > 0 && daysUntil <= 7) return 0.25
  }

  if (openedAt) {
    const days = daysSince(openedAt)
    if (days >= 0 && days <= 14) return 0.45
    if (days > 14 && days <= 45) return 0.25
  }

  return 0
}

function sourceVelocityBoost(venue: Venue): number {
  if (venue.source !== 'editorial') return 0
  const synced = typeof venue.last_synced_at === 'string' ? venue.last_synced_at : null
  if (!synced) return 0
  const days = daysSince(synced)
  if (days >= 0 && days <= 7) return 0.15
  if (days > 7 && days <= 21) return 0.08
  return 0
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - t) / 86_400_000)
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
//
// Cross-source dedup: editorial blog rows are persisted per-blog (one row
// per blog × venue), which is what lets the post-upsert `critic_pick` pass
// count distinct blog mentions. At planner output we collapse them so the
// user sees a single card per real-world venue. Dedup key is
// normalised-name + ~200 m coordinate bucket; the higher-scoring row wins
// and the loser's `badge_meta.source` is merged in so the "Critic's pick"
// label still names every contributing blog.
export function bucketByCategory(ranked: RankedVenue[]): Buckets {
  const reachable = ranked.filter((r) => {
    const maxEta = Math.max(r.eta_a_min, r.eta_b_min)
    return maxEta === 0 || simulatedMrtEta(maxEta) <= MAX_ETA_MIN
  })

  const deduped = dedupeByVenue(reachable)

  const dining: PlanCard[] = []
  const events: PlanCard[] = []
  for (const r of [...deduped].sort((a, b) => b.score - a.score)) {
    const category: Category = isEvent(r) ? 'event' : 'dining'
    const list = category === 'event' ? events : dining
    if (list.length >= PER_CATEGORY_CAP) continue
    list.push({ ...r, bucket: category })
  }
  return { dining, events }
}

const COORD_BUCKET_DEG = 0.002 // ~220 m at SG latitude

function venueDedupeKey(v: RankedVenue): string {
  const name = v.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const lat = Math.round(v.lat / COORD_BUCKET_DEG)
  const lng = Math.round(v.lng / COORD_BUCKET_DEG)
  return `${name}|${lat},${lng}`
}

function dedupeByVenue(ranked: RankedVenue[]): RankedVenue[] {
  // Sort highest-score first so the winner is the first entry seen per key.
  const byScoreDesc = [...ranked].sort((a, b) => b.score - a.score)
  const winners = new Map<string, RankedVenue>()
  for (const r of byScoreDesc) {
    const key = venueDedupeKey(r)
    const existing = winners.get(key)
    if (!existing) {
      winners.set(key, r)
      continue
    }
    const mergedSource = mergeBlogSources(existing.badge_meta, r.badge_meta)
    if (mergedSource && mergedSource !== (existing.badge_meta as { source?: string } | null)?.source) {
      winners.set(key, {
        ...existing,
        badge_meta: { ...(existing.badge_meta ?? {}), source: mergedSource },
      })
    }
  }
  return [...winners.values()]
}

// `badge_meta.source` on editorial rows is "Sethlui, DFD" — comma-separated
// blog names from the post-upsert critic_pick pass. When two rows collapse
// into one card, union those name sets so the surviving card credits every
// blog that mentioned the venue.
function mergeBlogSources(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null
): string | null {
  const sA = typeof a?.source === 'string' ? a.source : ''
  const sB = typeof b?.source === 'string' ? b.source : ''
  if (!sA && !sB) return null
  const names = new Set<string>()
  for (const s of [sA, sB]) {
    for (const n of s.split(',').map((x) => x.trim()).filter(Boolean)) {
      names.add(n)
    }
  }
  return [...names].sort().join(', ') || null
}
