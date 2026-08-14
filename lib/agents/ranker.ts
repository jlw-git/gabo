// LLM-augmented ranker — Phase 5.
//
// Runs AFTER the deterministic score formula (lib/planner/score.ts) and
// bucketByCategory have produced ranked dining + events lists. The formula
// stays the source of truth; this ranker is allowed to nudge ordering
// within a tolerance band and write a per-card `rank_reason` that the UI
// surfaces under the body copy.
//
// Tolerance band rules (enforced AFTER the model returns, so a bad reply
// can never destabilise the page):
//   - No card moves more than MAX_POSITION_SHIFT slots from its formula
//     position.
//   - The formula's #1 card cannot fall below position TOP_FLOOR.
//   - Cards the model omits keep their formula position.
//
// This keeps the planner deterministic-in-aggregate: users get stable
// top-3 results across page reloads, but the model can elevate a "wow"
// option from #5 to #2 when context warrants.

import { RANKER_MODEL } from '@/lib/agents/models'
import { generateJson } from '@/lib/agents/runner'
import type { Buckets } from '@/lib/planner/score'
import type { PlanCard, Profile } from '@/lib/planner/types'
import type { WeatherResult } from '@/lib/weather'

// A card can shift at most this many positions in either direction.
const MAX_POSITION_SHIFT = 3
// The formula's #1 card cannot end up below this position (0-indexed: 2 = #3).
const TOP_FLOOR = 2
// Per-bucket cap on what we even consider re-ranking.
const RERANK_WINDOW = 8

type RerankRow = { id: string; rank_reason: string; position: number }

function isRerankRow(x: unknown): x is RerankRow {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.rank_reason === 'string' &&
    typeof o.position === 'number'
  )
}

function budgetLabel(band: number): string {
  return ['', '$', '$$', '$$$', '$$$$'][band] ?? '$$'
}

function buildPrompt(
  bucket: 'dining' | 'events',
  cards: PlanCard[],
  profile: Profile,
  weather: WeatherResult,
  scheduledDate: Date,
  occasion: string | null
): string {
  const dateStr = scheduledDate.toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  const profileSummary = [
    profile.cuisines_loved.length ? `likes ${profile.cuisines_loved.join(', ')}` : null,
    profile.cuisines_avoided.length ? `avoids ${profile.cuisines_avoided.join(', ')}` : null,
    profile.vibe_defaults.length ? `wants ${profile.vibe_defaults.join('/')} vibe` : null,
    profile.budget_bands.length ? `budget ${profile.budget_bands.map(budgetLabel).join('/')}` : null,
  ]
    .filter(Boolean)
    .join('; ')

  const cardLines = cards
    .map((c, i) => {
      const parts: string[] = [
        `formula_position: ${i}`,
        `name: ${c.name}`,
        `tags: ${[...c.cuisine_tags, ...c.vibe_tags].join(', ') || '(none)'}`,
        `price: ${budgetLabel(c.budget_band)}`,
        `score: ${c.score.toFixed(2)}`,
        `travel_min: ${c.eta_a_min}+${c.eta_b_min}`,
        `fairness_gap_min: ${c.fairness_gap_min}`,
      ]
      if (c.badge !== 'none') parts.push(`badge: ${c.badge}`)
      if (c.trending_score >= 0.8) parts.push('trending')
      if (c.is_outdoor) parts.push('outdoor')
      return `{ "id": "${c.id}", ${parts.map((p) => JSON.stringify(p)).join(', ')} }`
    })
    .join('\n')

  return `You are a Singapore date-night planner. The deterministic score formula has produced this ranked list of ${bucket} options. Your job: optionally re-order WITHIN A TOLERANCE BAND and write one specific reason per card explaining why it's at its position for THIS couple, THIS context.

Plan context:
- Date: ${dateStr}
- Weather: ${weather.condition}${occasion ? `\n- Occasion: ${occasion}` : ''}
- Couple profile: ${profileSummary || 'no preferences set'}

Cards (formula order, 0-indexed):
${cardLines}

Re-ordering rules — your output WILL be clipped to enforce them:
- Each card moves at most ${MAX_POSITION_SHIFT} positions from its formula_position.
- The formula's #1 card (formula_position: 0) cannot end up below position ${TOP_FLOOR}.
- Any card you omit keeps its formula position.
- Use shifts SPARINGLY. Re-rank only when there's a real reason: a closing_soon card with great fit, an outdoor card on a rainy night that you want demoted, an unusually fair fairness_gap for an anniversary, etc.

For EACH card you choose to include, write a 'rank_reason' — one specific sentence (max 14 words) about WHY this card lands at its position. Mention the most discriminating signal (closing date, fairness, occasion fit, vibe match). Avoid generic filler like "great option" or "perfect for couples".

Return ONLY raw JSON, no markdown:
[
  { "id": "...", "position": 0, "rank_reason": "..." },
  ...
]`
}

export type RankerOutput = {
  // PlanCards in their (possibly re-ordered) final positions, with
  // rank_reason stamped onto each card the model addressed.
  cards: PlanCard[]
  // Number of cards the model successfully scored (passed shape validation
  // AND stayed within the tolerance band). Surfaced in plan meta for
  // observability.
  reranked: number
}

async function rerankBucket(
  bucket: 'dining' | 'events',
  cards: PlanCard[],
  profile: Profile,
  weather: WeatherResult,
  scheduledDate: Date,
  overrideTags: string[]
): Promise<RankerOutput> {
  if (cards.length === 0) return { cards, reranked: 0 }

  const occasionTags = overrideTags.filter((t) => t === 'anniversary' || t === 'birthday')
  const occasion = occasionTags.length ? occasionTags.join(' + ') : null

  const window = cards.slice(0, RERANK_WINDOW)
  const tail = cards.slice(RERANK_WINDOW)

  const prompt = buildPrompt(bucket, window, profile, weather, scheduledDate, occasion)
  const parsed = await generateJson<RerankRow[]>({
    model: RANKER_MODEL,
    prompt,
    feature: 'plan-ranker',
    timeoutMs: 6000,
  })

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { cards, reranked: 0 }
  }

  // Validate + filter rows. Anything that doesn't shape up gets ignored
  // (the original card keeps its formula position).
  const validById = new Map<string, RerankRow>()
  for (const row of parsed) {
    if (!isRerankRow(row)) continue
    validById.set(row.id, row)
  }

  // Build the final order. Strategy:
  //   1. Start with formula order.
  //   2. For each card in the window, if the model returned a clipped
  //      position, use that; else keep formula position.
  //   3. Resolve ties + clip into the tolerance band.
  //   4. Stable-sort and stamp rank_reason.
  type Slotted = { card: PlanCard; formulaPos: number; targetPos: number; reason: string }
  const slotted: Slotted[] = window.map((card, formulaPos) => {
    const hit = validById.get(card.id)
    if (!hit) return { card, formulaPos, targetPos: formulaPos, reason: '' }

    // Clip per-card shift to MAX_POSITION_SHIFT.
    const requested = Math.max(0, Math.min(window.length - 1, Math.round(hit.position)))
    const minPos = Math.max(0, formulaPos - MAX_POSITION_SHIFT)
    const maxPos = Math.min(window.length - 1, formulaPos + MAX_POSITION_SHIFT)
    const clipped = Math.max(minPos, Math.min(maxPos, requested))
    return {
      card,
      formulaPos,
      targetPos: clipped,
      reason: hit.rank_reason.slice(0, 140),
    }
  })

  // Enforce the top-floor invariant: the formula's #1 card cannot end up
  // below TOP_FLOOR. If the model tried to push it there, snap back.
  const topCard = slotted.find((s) => s.formulaPos === 0)
  if (topCard && topCard.targetPos > TOP_FLOOR) {
    topCard.targetPos = TOP_FLOOR
  }

  // Stable sort by targetPos, ties broken by formulaPos (formula wins).
  const ordered = [...slotted].sort((a, b) =>
    a.targetPos - b.targetPos !== 0 ? a.targetPos - b.targetPos : a.formulaPos - b.formulaPos
  )

  let reranked = 0
  const stamped: PlanCard[] = ordered.map(({ card, reason, formulaPos }, finalPos) => {
    const moved = finalPos !== formulaPos
    if (moved || reason) reranked++
    return reason ? { ...card, rank_reason: reason } : card
  })

  // Tail (anything past RERANK_WINDOW) stays in original score order.
  return { cards: [...stamped, ...tail], reranked }
}

export async function rerankBuckets(
  buckets: Buckets,
  profile: Profile,
  weather: WeatherResult,
  scheduledDate: Date,
  overrideTags: string[]
): Promise<{ buckets: Buckets; reranked_dining: number; reranked_events: number }> {
  // Fire both bucket re-rank calls in parallel — they're independent.
  const [diningOut, eventsOut] = await Promise.all([
    rerankBucket('dining', buckets.dining, profile, weather, scheduledDate, overrideTags),
    rerankBucket('events', buckets.events, profile, weather, scheduledDate, overrideTags),
  ])
  return {
    buckets: { dining: diningOut.cards, events: eventsOut.cards },
    reranked_dining: diningOut.reranked,
    reranked_events: eventsOut.reranked,
  }
}
