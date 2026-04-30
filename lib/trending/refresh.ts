// Computes a real trending_score [0..1] per venue from two signals:
//   1. Reddit mentions in past 7d (external interest)
//   2. Shortlist saves in past 7d (internal velocity)
//
// Both are min-max normalised across the catalog so the relative ordering
// matters more than absolute counts. Internal velocity is weighted more
// once we have meaningful traffic; Reddit carries cold-start.

import { createClient as createServerClient } from '@/lib/supabase/server'
import { mapWithConcurrency } from '@/lib/async/pool'
import { countRedditMentions } from './reddit'
import type { Venue } from '@/lib/planner/types'

const REDDIT_CONCURRENCY = 3
const SHORTLIST_LOOKBACK_DAYS = 7
const REDDIT_WEIGHT_COLD = 0.8 // when shortlist data is sparse
const REDDIT_WEIGHT_WARM = 0.4
const SHORTLIST_THRESHOLD_FOR_WARM = 25 // total events across catalog before we trust internal signal

export type TrendingResult = {
  venue_id: string
  venue_name: string
  reddit_mentions: number
  shortlist_count: number
  trending_score: number
}

export type TrendingSummary = {
  refreshed_at: string
  venues_processed: number
  total_shortlist_events: number
  reddit_weight: number
  results: TrendingResult[]
}

export async function refreshTrendingScores(): Promise<TrendingSummary> {
  const supabase = await createServerClient()

  const { data: venuesData, error } = await supabase
    .from('venues')
    .select('id, name')
    .eq('active', true)
  if (error) throw new Error(`load venues: ${error.message}`)
  const venues = (venuesData ?? []) as Pick<Venue, 'id' | 'name'>[]

  // 1) shortlist counts per venue, last 7d
  const since = new Date(Date.now() - SHORTLIST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: events, error: eventsError } = await supabase
    .from('shortlist_events')
    .select('venue_id')
    .gte('created_at', since)
  if (eventsError) throw new Error(`load shortlist events: ${eventsError.message}`)

  const shortlistMap = new Map<string, number>()
  for (const e of (events ?? []) as { venue_id: string }[]) {
    shortlistMap.set(e.venue_id, (shortlistMap.get(e.venue_id) ?? 0) + 1)
  }
  const totalShortlist = (events ?? []).length
  const redditWeight = totalShortlist >= SHORTLIST_THRESHOLD_FOR_WARM ? REDDIT_WEIGHT_WARM : REDDIT_WEIGHT_COLD

  // 2) reddit mentions per venue (network-bound, parallelised)
  const redditCounts = await mapWithConcurrency(venues, REDDIT_CONCURRENCY, async (v) => {
    const r = await countRedditMentions(v.name).catch(() => ({ mention_count: 0 }))
    return { id: v.id, name: v.name, count: r.mention_count }
  })

  // 3) normalise + combine
  const maxReddit = Math.max(1, ...redditCounts.map((r) => r.count))
  const maxShortlist = Math.max(1, ...Array.from(shortlistMap.values()))

  const results: TrendingResult[] = redditCounts.map((r) => {
    const shortlist = shortlistMap.get(r.id) ?? 0
    const redditNorm = r.count / maxReddit
    const shortlistNorm = shortlist / maxShortlist
    const score = redditWeight * redditNorm + (1 - redditWeight) * shortlistNorm
    return {
      venue_id: r.id,
      venue_name: r.name,
      reddit_mentions: r.count,
      shortlist_count: shortlist,
      trending_score: Number(score.toFixed(3)),
    }
  })

  // 4) write back to venues.trending_score
  const updates = results.map((r) =>
    supabase.from('venues').update({ trending_score: r.trending_score }).eq('id', r.venue_id)
  )
  await Promise.all(updates)

  return {
    refreshed_at: new Date().toISOString(),
    venues_processed: venues.length,
    total_shortlist_events: totalShortlist,
    reddit_weight: redditWeight,
    results,
  }
}
