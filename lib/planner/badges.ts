// Single source of truth for which labels apply to a venue/card. PlanCard
// renders chips from these predicates; ResultsView / RecommendationsFeed /
// /api/recommendations use the same predicates for their filter tabs and
// recommendation sections, so a chip visible on a card always corresponds
// to that card appearing under the matching filter tab.
//
// The DB schema still has a single `badge` column that stores the priority
// winner (used for ring colour + freshness score weight in lib/planner/score.ts).
// Everything else — the label set, the filter membership, the "what's new"
// strip — keys off the richer `badge_meta` JSON.

import type { Venue } from './types'

// Time windows match the original chip-rendering thresholds. closing_soon's
// 30-day window is the same value the source extractors (blog-scanner,
// editorial-events, tsl-events, bandsintown) used when they originally set
// the badge — so a row written before this refactor with badge='closing_soon'
// and ends_at = today+25d still passes hasClosingSoonLabel.
export const CLOSING_SOON_WINDOW_DAYS = 30

// Dining (blog-scanner) caps soft_launch at 90 days via SOFT_LAUNCH_TTL_DAYS;
// events use a tighter 14-day "just opened" window when writing the badge.
// 90 here is the lenient label-side cap — anything older than that probably
// isn't worth chipping as new regardless of source.
export const JUST_OPENED_WINDOW_DAYS = 90

// trending_score is normalised to [0..1] by lib/trending/refresh.ts. 0.7 is
// "appears in roughly the top quartile of Reddit + shortlist velocity".
export const TRENDING_THRESHOLD = 0.7

// A loose Venue-shape — anything with badge_meta + trending_score, including
// PlanCard, RankedVenue, and the raw Venue row. Lets the predicates work
// on both DB rows (server-side filters) and ranked cards (client-side).
type BadgeBearing = Pick<Venue, 'badge_meta' | 'trending_score'>

export function hasClosingSoonLabel(v: BadgeBearing): boolean {
  const ends = v.badge_meta?.ends_at
  if (typeof ends !== 'string') return false
  const days = daysFromNow(ends)
  return days >= 0 && days <= CLOSING_SOON_WINDOW_DAYS
}

export function hasJustOpenedLabel(v: BadgeBearing): boolean {
  const opened = v.badge_meta?.opened
  if (typeof opened !== 'string') return false
  const days = daysSince(opened)
  return days >= 0 && days <= JUST_OPENED_WINDOW_DAYS
}

export function hasCriticPickLabel(v: BadgeBearing): boolean {
  const source = v.badge_meta?.source
  return typeof source === 'string' && source.trim().length > 0
}

export function hasAwardLabel(v: BadgeBearing): boolean {
  const award = v.badge_meta?.award
  return typeof award === 'string' && award.trim().length > 0
}

// "Recommended" tab inclusion. Critic / award labels OR trending.
export function isRecommended(v: BadgeBearing): boolean {
  return (
    hasCriticPickLabel(v) ||
    hasAwardLabel(v) ||
    (typeof v.trending_score === 'number' && v.trending_score >= TRENDING_THRESHOLD)
  )
}

function daysFromNow(iso: string): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return -1
  return Math.round((d.getTime() - Date.now()) / 86_400_000)
}

function daysSince(iso: string): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return -1
  return Math.round((Date.now() - d.getTime()) / 86_400_000)
}
