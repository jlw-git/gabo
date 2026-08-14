// Triage agent. Maps free-form user input ("anniversary dinner near Marina
// Bay, my wife loves Italian, no seafood") to a structured PlanRequest.
//
// Architecture:
//   1. Single flash-lite call extracts intent into a JSON structure with
//      named slots for cuisine, vibe, budget, dietary, override tags, and
//      *queries* for the two start points (free-text strings the user wrote).
//   2. In parallel, OneMap resolves each query into a real lat/lng. Resolved
//      addresses go back to the caller for UI confirmation ("found: …").
//   3. We merge the agent's outputs with whatever the user already filled in
//      the structured form (form values win — the agent fills GAPS, never
//      overrides explicit user input). This is the key UX contract: typing
//      "italian" in the chips and "no seafood" in free text should produce
//      cuisines_loved=['italian'] and cuisines_avoided=['seafood'], not a
//      cuisine-loved set that the LLM thought sounded better.
//
// No tool-use loop yet — the operations are small and parallelisable, and a
// one-shot prompt with a tight schema gives stabler outputs than a
// multi-turn loop on a 5-second budget. Tool-use lands in Phase 4 when the
// dining/events sub-agents legitimately need it.

import { TRIAGE_MODEL } from '@/lib/agents/models'
import { generateJson } from '@/lib/agents/runner'
import { CUISINE_VOCAB, OVERRIDE_VOCAB, VIBE_VOCAB, filterToVocab } from '@/lib/agents/vocab'
import { searchPlaces } from '@/lib/onemap/client'
import type { LatLng, Profile } from '@/lib/planner/types'

type TriageDraft = {
  start_a_query: string | null
  start_b_query: string | null
  cuisines_loved: string[]
  cuisines_avoided: string[]
  vibe_defaults: string[]
  budget_bands: number[]
  dietary_hardstops: string[]
  override_tags: string[]
  notes: string
}

export type TriageInput = {
  freeform: string
  // The form's current values — agent fills gaps but never overrides.
  partial: {
    profile?: Partial<Profile>
    start_a?: LatLng | null
    start_b?: LatLng | null
    override_tags?: string[]
  }
}

export type TriageResult = {
  profile: Profile
  start_a: LatLng | null
  start_a_label: string | null
  start_b: LatLng | null
  start_b_label: string | null
  override_tags: string[]
  notes: string
}

function buildPrompt(freeform: string): string {
  return `You are a date-planning intent parser for a Singapore date-night app. The user typed a free-form description below. Extract their intent into structured slots.

User input:
${freeform.slice(0, 800)}

Output JSON with this exact shape:
{
  "start_a_query": "Marina Bay" | null,
  "start_b_query": "Tiong Bahru MRT" | null,
  "cuisines_loved": ["italian"],
  "cuisines_avoided": ["seafood"],
  "vibe_defaults": ["celebratory"],
  "budget_bands": [3, 4],
  "dietary_hardstops": ["vegetarian_friendly"],
  "override_tags": ["anniversary"],
  "notes": "Anniversary dinner near Marina Bay, partner loves Italian, avoiding seafood."
}

Vocabulary constraints (anything outside is dropped):
- cuisines_loved / cuisines_avoided MUST be from: ${CUISINE_VOCAB.join(', ')}
- vibe_defaults MUST be from: ${VIBE_VOCAB.join(', ')}
- budget_bands MUST be integers 1–4 (1=cheap, 4=fine-dining)
- override_tags MUST be from: ${OVERRIDE_VOCAB.join(', ')}
- dietary_hardstops common values: vegetarian_friendly, halal, alcohol_free
- start_a_query / start_b_query: short Singapore place strings the user named (e.g., "Marina Bay", "Tiong Bahru", "Raffles Place"). Set null when the user didn't name a location.
- notes: one human-readable sentence summarising what you understood. Shown back to the user before plan results.

Map natural language to vocab carefully:
- "romantic" / "fancy" / "celebrate" → vibe celebratory
- "chill" / "relaxed" → vibe low_key
- "fun" / "try something new" → vibe adventurous
- "intimate" / "small" → vibe cozy
- "no alcohol" / "halal" / "Muslim-friendly" → dietary alcohol_free (and override no_alcohol)
- "vegetarian" / "veggie" → dietary vegetarian_friendly (and override vegetarian)
- "anniversary" / "birthday" → set override_tags

Return ONLY raw JSON, no markdown.`
}

function isDraft(x: unknown): x is TriageDraft {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    (o.start_a_query === null || typeof o.start_a_query === 'string') &&
    (o.start_b_query === null || typeof o.start_b_query === 'string') &&
    Array.isArray(o.cuisines_loved) &&
    Array.isArray(o.cuisines_avoided) &&
    Array.isArray(o.vibe_defaults) &&
    Array.isArray(o.budget_bands) &&
    Array.isArray(o.dietary_hardstops) &&
    Array.isArray(o.override_tags) &&
    typeof o.notes === 'string'
  )
}

export async function runTriage(input: TriageInput): Promise<TriageResult> {
  // Form-supplied values, used as both fallback and override-guard.
  const formProfile = input.partial.profile ?? {}
  const formStartA = input.partial.start_a ?? null
  const formStartB = input.partial.start_b ?? null
  const formOverrides = input.partial.override_tags ?? []

  // Empty / very short input: skip the LLM call and just echo back what
  // the form gave us. Saves a call and avoids the LLM inventing slots
  // from nothing.
  if (input.freeform.trim().length < 4) {
    return {
      profile: mergeProfile(formProfile, null),
      start_a: formStartA,
      start_a_label: null,
      start_b: formStartB,
      start_b_label: null,
      override_tags: formOverrides,
      notes: '',
    }
  }

  const draft = await generateJson<TriageDraft>({
    model: TRIAGE_MODEL,
    prompt: buildPrompt(input.freeform),
    feature: 'plan-triage',
    timeoutMs: 5000,
  })

  if (!draft || !isDraft(draft)) {
    // Triage failure: fall back cleanly to the form's structured fields.
    return {
      profile: mergeProfile(formProfile, null),
      start_a: formStartA,
      start_a_label: null,
      start_b: formStartB,
      start_b_label: null,
      override_tags: formOverrides,
      notes: '',
    }
  }

  // Resolve start-point queries in parallel via OneMap. Form-provided
  // coords win — we only fill the slots the user left blank.
  const [resolvedA, resolvedB] = await Promise.all([
    formStartA ? Promise.resolve(null) : resolveQuery(draft.start_a_query),
    formStartB ? Promise.resolve(null) : resolveQuery(draft.start_b_query),
  ])

  return {
    profile: mergeProfile(formProfile, draft),
    start_a: formStartA ?? resolvedA?.point ?? null,
    start_a_label: formStartA ? null : (resolvedA?.label ?? null),
    start_b: formStartB ?? resolvedB?.point ?? null,
    start_b_label: formStartB ? null : (resolvedB?.label ?? null),
    override_tags: mergeOverrides(formOverrides, draft.override_tags),
    notes: draft.notes.slice(0, 240),
  }
}

async function resolveQuery(
  query: string | null
): Promise<{ point: LatLng; label: string } | null> {
  if (!query || !query.trim()) return null
  try {
    const hits = await searchPlaces(query.trim(), 1)
    const hit = hits[0]
    if (!hit) return null
    return { point: { lat: hit.lat, lng: hit.lng }, label: hit.address || hit.name }
  } catch {
    return null
  }
}

function mergeProfile(form: Partial<Profile>, draft: TriageDraft | null): Profile {
  // Defaults so we always return a valid Profile even when the form passes
  // a partial. The planner uses [] / 'either' as the "no preference" signal.
  const base: Profile = {
    planner_name: form.planner_name ?? 'You',
    partner_name: form.partner_name ?? 'Partner',
    cuisines_loved: [...(form.cuisines_loved ?? [])],
    cuisines_avoided: [...(form.cuisines_avoided ?? [])],
    dietary_hardstops: [...(form.dietary_hardstops ?? [])],
    vibe_defaults: [...(form.vibe_defaults ?? [])],
    budget_bands: [...(form.budget_bands ?? [])],
    transit_pref: form.transit_pref ?? 'either',
  }
  if (!draft) return base

  // Merge draft into base. Form values are preserved; draft values ADD
  // (don't replace) so explicit form selections never get overruled.
  const addUnique = <T>(existing: T[], add: T[]) => [...new Set([...existing, ...add])]

  return {
    ...base,
    cuisines_loved: addUnique(
      base.cuisines_loved,
      filterToVocab(draft.cuisines_loved, CUISINE_VOCAB)
    ),
    cuisines_avoided: addUnique(
      base.cuisines_avoided,
      filterToVocab(draft.cuisines_avoided, CUISINE_VOCAB)
    ),
    vibe_defaults: addUnique(
      base.vibe_defaults,
      filterToVocab(draft.vibe_defaults, VIBE_VOCAB)
    ) as Profile['vibe_defaults'],
    budget_bands: addUnique(
      base.budget_bands,
      draft.budget_bands.filter((b) => Number.isInteger(b) && b >= 1 && b <= 4)
    ),
    dietary_hardstops: addUnique(
      base.dietary_hardstops,
      draft.dietary_hardstops.filter((s) => typeof s === 'string' && s.length > 0)
    ),
  }
}

function mergeOverrides(form: string[], draft: string[]): string[] {
  const merged = new Set([...form, ...filterToVocab(draft, OVERRIDE_VOCAB)])
  return [...merged]
}
