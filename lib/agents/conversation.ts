// Conversational planner — the refine-after-results loop (F1).
//
// The user has a plan on screen and types a correction in plain language
// ("too far for her", "more romantic, less loud", "somewhere we can walk
// after"). This agent interprets that against the CURRENT PlanRequest and
// re-runs the deterministic planner.
//
// Guardrail (AGENTIC_ROADMAP.md principle #2): the agent NEVER scores, ranks,
// or reorders venues. Its only power is to produce a *validated patch to the
// PlanRequest* (preferences, starts, time, overrides). planDate() owns every
// user-visible decision. The conversation changes inputs, never outputs.
//
// The loop is built on generateWithTools (a bounded, timed-out Gemini
// function-calling loop). The model is given the current request + a summary
// of the current results, and may call two tools:
//   - apply_changes: replace preference fields, then re-plan
//   - resolve_place:  turn "near the water / closer to her" into coords, then re-plan
// Both re-plan via the same deterministic planDate(); an end-of-loop sync
// guarantees the returned buckets always match the final request.

import { ORCHESTRATION_MODEL } from '@/lib/agents/models'
import { recordRun } from '@/lib/agents/run-log'
import { generateWithTools, type ToolDef } from '@/lib/agents/runner'
import { CUISINE_VOCAB, OVERRIDE_VOCAB, VIBE_VOCAB, filterToVocab } from '@/lib/agents/vocab'
import { searchPlaces } from '@/lib/onemap/client'
import { planDate } from '@/lib/planner/plan-date'
import { parseLatLng, type PlanRequest } from '@/lib/planner/request-validation'
import type { Buckets } from '@/lib/planner/score'
import type { VibeTag } from '@/lib/planner/types'

export type ConversationTurn = { role: 'user' | 'assistant'; text: string }

export type ConversationInput = {
  message: string
  history: ConversationTurn[]
  request: PlanRequest
}

type PlanResult = Awaited<ReturnType<typeof planDate>>

export type ConversationResult = {
  assistantMessage: string
  request: PlanRequest
  buckets: Buckets
  meta: PlanResult['meta']
}

const FALLBACK_MESSAGE =
  "I couldn't adjust the plan just now — your current results are unchanged. Try rephrasing what you'd like to change."

// Compact, model-readable summary of the current results. Also reused by the
// route to seed the first turn.
export function summarizeBuckets(buckets: Buckets): string {
  const names = (cards: { name: string }[]) =>
    cards.slice(0, 4).map((c) => c.name).join(', ') || '(none)'
  return `Dining: ${names(buckets.dining)}. Events: ${names(buckets.events)}.`
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

// Apply a validated, clamped patch to the working request. Replace-semantics:
// each field, when present, replaces that slot (the model is given the current
// request, so it constructs the full desired list). Omitted = unchanged.
function applyPatch(
  base: PlanRequest,
  patch: Record<string, unknown>
): PlanRequest {
  const profile = { ...base.profile }
  let scheduledFor = base.scheduled_for
  let overrides = base.override_tags

  if (Array.isArray(patch.cuisines_loved)) {
    profile.cuisines_loved = filterToVocab(patch.cuisines_loved.map(String), CUISINE_VOCAB)
  }
  if (Array.isArray(patch.cuisines_avoided)) {
    profile.cuisines_avoided = filterToVocab(patch.cuisines_avoided.map(String), CUISINE_VOCAB)
  }
  if (Array.isArray(patch.vibe_defaults)) {
    profile.vibe_defaults = filterToVocab(patch.vibe_defaults.map(String), VIBE_VOCAB) as VibeTag[]
  }
  if (Array.isArray(patch.budget_bands)) {
    profile.budget_bands = uniq(
      patch.budget_bands
        .map((b) => Number(b))
        .filter((b) => Number.isInteger(b) && b >= 1 && b <= 4)
    )
  }
  if (Array.isArray(patch.override_tags)) {
    overrides = filterToVocab(patch.override_tags.map(String), OVERRIDE_VOCAB)
  }
  if (typeof patch.scheduled_for === 'string') {
    const d = new Date(patch.scheduled_for)
    if (!Number.isNaN(d.getTime())) scheduledFor = patch.scheduled_for
  }

  return { ...base, profile, scheduled_for: scheduledFor, override_tags: overrides }
}

function buildPrompt(input: ConversationInput, resultSummary: string): string {
  const req = input.request
  const profile = req.profile
  const history = input.history
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'User' : 'You'}: ${t.text}`)
    .join('\n')

  return `You are the date-night planner's refine assistant for a Singapore couple. The user already has a plan on screen and wants to adjust it. Interpret their message and call tools to change the underlying search, then reply with ONE short sentence (max ~20 words) describing what you changed. Never invent venues — the deterministic planner picks them; you only change the search inputs.

Current search:
- scheduled_for: ${req.scheduled_for}
- cuisines_loved: ${JSON.stringify(profile.cuisines_loved)}
- cuisines_avoided: ${JSON.stringify(profile.cuisines_avoided)}
- vibe_defaults: ${JSON.stringify(profile.vibe_defaults)}
- budget_bands (1=cheap..4=fine-dining): ${JSON.stringify(profile.budget_bands)}
- override_tags: ${JSON.stringify(req.override_tags)}
- start_a (the planner's side): ${req.start_a ? `${req.start_a.lat},${req.start_a.lng}` : 'not set'}
- start_b (the partner's side): ${req.start_b ? `${req.start_b.lat},${req.start_b.lng}` : 'not set'}

Current results:
${resultSummary}
${history ? `\nRecent conversation:\n${history}\n` : ''}
Vocabulary you may use (anything else is dropped):
- cuisines: ${CUISINE_VOCAB.join(', ')}
- vibes: ${VIBE_VOCAB.join(', ')}  ("quieter/intimate"=cozy or low_key, "romantic/celebrate"=celebratory, "fun/new"=adventurous)
- override_tags: ${OVERRIDE_VOCAB.join(', ')}

Guidance:
- "too far for her / closer to her side" → resolve_place a nearer point for start_b, or none if no place is named.
- "more romantic / quieter / livelier" → set vibe_defaults to the full desired list.
- "less fancy / cheaper" → set budget_bands lower; "fancier" → higher.
- "no seafood / add Italian" → set the full cuisines_avoided / cuisines_loved list (current + change).
- "earlier / later / tomorrow" → set scheduled_for to a valid ISO datetime.
- apply_changes REPLACES each field you pass with the full new list, so include current values you want to keep.
- If the message isn't an actionable change, don't call tools — reply with one short clarifying question.

User says: ${input.message.slice(0, 600)}`
}

export async function runConversationTurn(
  input: ConversationInput
): Promise<ConversationResult> {
  // First plan reflects the unchanged request, so a no-tool turn still returns
  // valid (current) results.
  let working = input.request
  let last: PlanResult = await planDate(working)
  let plannedFor = working

  const replan = async (): Promise<string> => {
    last = await planDate(working)
    plannedFor = working
    return summarizeBuckets(last.buckets)
  }

  const tools: ToolDef[] = [
    {
      name: 'apply_changes',
      description:
        'Replace one or more search preferences, then re-run the planner. Each field you pass replaces that slot entirely. Returns the new results summary.',
      parameters: {
        type: 'object',
        properties: {
          cuisines_loved: { type: 'array', items: { type: 'string' } },
          cuisines_avoided: { type: 'array', items: { type: 'string' } },
          vibe_defaults: { type: 'array', items: { type: 'string' } },
          budget_bands: { type: 'array', items: { type: 'integer' } },
          override_tags: { type: 'array', items: { type: 'string' } },
          scheduled_for: { type: 'string', description: 'ISO 8601 datetime' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        working = applyPatch(working, args)
        return { results: await replan() }
      },
    },
    {
      name: 'resolve_place',
      description:
        "Resolve a Singapore place name into a start point and re-plan. Use 'a' for the planner's side, 'b' for the partner's side.",
      parameters: {
        type: 'object',
        properties: {
          which: { type: 'string', enum: ['a', 'b'] },
          query: { type: 'string', description: 'A Singapore place name, e.g. "Tiong Bahru"' },
        },
        required: ['which', 'query'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const which = args.which === 'b' ? 'b' : 'a'
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) return { error: 'empty query' }
        const hits = await searchPlaces(query, 1)
        const hit = hits[0]
        const point = hit ? parseLatLng({ lat: hit.lat, lng: hit.lng }) : null
        if (!point) return { error: `couldn't find "${query}" in Singapore` }
        working = which === 'b' ? { ...working, start_b: point } : { ...working, start_a: point }
        return { resolved: hit.address || hit.name, results: await replan() }
      },
    },
  ]

  const out = await generateWithTools({
    model: ORCHESTRATION_MODEL,
    prompt: buildPrompt(input, summarizeBuckets(last.buckets)),
    tools,
    maxRounds: 3,
    // Generous budget: the orchestration model (Kimi K2.6 via OpenRouter) is
    // slower than flash, and each apply_changes tool call re-runs planDate
    // (Supabase + OneMap) inside the loop. 18s timed out in practice (~21s real).
    timeoutMs: 40_000,
  })

  // End-of-loop sync: if a tool mutated the request after the last re-plan
  // (or the model returned without re-planning), make the returned buckets
  // match the final request exactly.
  if (working !== plannedFor) {
    try {
      last = await planDate(working)
    } catch {
      /* keep last good result */
    }
  }

  const assistantMessage = out?.text?.trim() || FALLBACK_MESSAGE

  // Fire-and-forget observability — never blocks or throws.
  void recordRun('conversation', {
    message: input.message.slice(0, 200),
    toolCalls: out?.toolCalls?.map((t) => t.name) ?? [],
    changed: working !== input.request,
    degraded: !out,
  })

  return {
    assistantMessage,
    request: working,
    buckets: last.buckets,
    meta: last.meta,
  }
}
