// Search-relaxation agent.
//
// Runs after the deterministic plan path when a bucket comes back thin
// (fewer than MIN_HEALTHY_RESULTS cards). The deterministic hard filters
// — open hours, dietary hardstops, weather × outdoor, run-window — STAY
// LOCKED. The agent only chooses which OPTIONAL constraints to drop:
//   - cuisine avoidance from the profile (e.g. "you said no Japanese,
//     but only Japanese is open right now near you")
//   - the budget_bands filter (e.g. "all $$$ tonight; willing to widen?")
//   - the 60-min ETA cap baked into bucketByCategory
//   - the cuisine-loved match boost (treat as no preference)
//
// A single flash-lite call decides; the relaxations come back as a
// boolean flag set plus a one-sentence reason that the UI surfaces.
// Hard filters are deliberately NOT in the option set — see the prompt.

import { TRIAGE_MODEL } from '@/lib/agents/models'
import { generateJson } from '@/lib/agents/runner'
import type { Profile } from '@/lib/planner/types'

export type Relaxation = {
  drop_cuisine_avoidance: boolean
  drop_budget_filter: boolean
  drop_distance_cap: boolean
  drop_match_boost: boolean
  reason: string
}

const NO_RELAXATION: Relaxation = {
  drop_cuisine_avoidance: false,
  drop_budget_filter: false,
  drop_distance_cap: false,
  drop_match_boost: false,
  reason: '',
}

// Below this row count in a bucket we ask the agent whether to widen.
// Tuned to PER_CATEGORY_CAP=6 in score.ts — 3 is the "feels thin" line
// where users start saying "is that it?".
export const MIN_HEALTHY_RESULTS = 3

function isRelaxation(x: unknown): x is Relaxation {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.drop_cuisine_avoidance === 'boolean' &&
    typeof o.drop_budget_filter === 'boolean' &&
    typeof o.drop_distance_cap === 'boolean' &&
    typeof o.drop_match_boost === 'boolean' &&
    typeof o.reason === 'string'
  )
}

export type RelaxationInput = {
  bucket: 'dining' | 'events'
  initial_count: number
  profile: Profile
  override_tags: string[]
  weather_condition: string
  // Number of venues that survived the deterministic pre-filter for the
  // bucket. If this is also tiny (<10) then no amount of soft relaxation
  // will help — the agent should bail.
  prefilter_total: number
}

export async function decideRelaxation(input: RelaxationInput): Promise<Relaxation> {
  // Cheap pre-check: if the prefilter found almost nothing, relaxation
  // won't rescue this. Save the LLM call.
  if (input.prefilter_total < 10) return NO_RELAXATION

  const profileSummary = [
    input.profile.cuisines_loved.length
      ? `loves ${input.profile.cuisines_loved.join(', ')}`
      : null,
    input.profile.cuisines_avoided.length
      ? `avoids ${input.profile.cuisines_avoided.join(', ')}`
      : null,
    input.profile.budget_bands.length
      ? `budget bands ${input.profile.budget_bands.join('/')}`
      : 'no budget cap',
    input.profile.vibe_defaults.length
      ? `vibe ${input.profile.vibe_defaults.join(' or ')}`
      : null,
  ]
    .filter(Boolean)
    .join('; ')

  const prompt = `You decide whether to relax a Singapore date-night planner's soft constraints when results are thin.

Bucket: ${input.bucket}
Cards returned: ${input.initial_count} (we want at least ${MIN_HEALTHY_RESULTS})
Venues that passed hard filters: ${input.prefilter_total}
Weather: ${input.weather_condition}
Couple profile: ${profileSummary || 'no preferences set'}
${input.override_tags.length ? `Overrides: ${input.override_tags.join(', ')}` : ''}

You may toggle any of these flags to TRUE to widen the search. Anything not toggled stays in force. Hard filters (open hours, dietary hardstops, rain-blocking outdoor venues, event run windows) are NEVER relaxable — do not even consider them.

- drop_cuisine_avoidance: relax the "avoids X" list. Use only when the avoidance is likely cutting off too many options for the slot/area. Risky for strong avoidances ("hates seafood").
- drop_budget_filter: ignore the budget_bands cap. Use when the budget is narrow and only nearby options happen to be a tier above/below.
- drop_distance_cap: ignore the 60-minute ETA cap. Use sparingly — most couples won't drive 90 minutes for dinner. Reasonable for special occasions or low cards-returned counts.
- drop_match_boost: stop boosting cards that match the "loves X" list. Use when the loved cuisines are common but happen to be all closed/full tonight.

Return ONLY raw JSON:
{ "drop_cuisine_avoidance": false, "drop_budget_filter": false, "drop_distance_cap": false, "drop_match_boost": false, "reason": "<one short sentence explaining what you toggled and why, ≤140 chars>" }

If none of the relaxations would obviously help, return all four flags false and an empty reason.`

  const out = await generateJson<Relaxation>({
    model: TRIAGE_MODEL,
    prompt,
    timeoutMs: 4000,
  })
  if (!out || !isRelaxation(out)) return NO_RELAXATION

  // If nothing was actually toggled, normalise to no-op (kills empty-reason noise).
  const anyToggled =
    out.drop_cuisine_avoidance ||
    out.drop_budget_filter ||
    out.drop_distance_cap ||
    out.drop_match_boost
  if (!anyToggled) return NO_RELAXATION

  return {
    ...out,
    reason: out.reason.slice(0, 160),
  }
}
