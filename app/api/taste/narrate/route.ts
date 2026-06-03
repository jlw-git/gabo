import { NextRequest } from 'next/server'
import { chatComplete } from '@/lib/agents/provider'
import { COPY_MODEL } from '@/lib/agents/models'
import { recordRun } from '@/lib/agents/run-log'

// LLM-narrated taste explanation (F5 flesh-out). The client computes its taste
// model entirely on-device and sends only the AGGREGATED top tags (the same ones
// the deterministic "Leaning…" hint already shows) — never the raw event log,
// timestamps, or venue identity. We reword them into one warm, specific line.
//
// Privacy: this is the single place a taste summary leaves the device, and only
// when AGENTIC_TASTE_NARRATE_ENABLED is set. Default-dark keeps F5's local-first
// posture intact; with the flag off the client renders the deterministic hint.
//
// Body: { loved: string[], vibes: string[], easingOff: string[] }
// Returns: { narration: string | null } — null on any failure so the client
// falls back to the templated summary. Never throws.

const MAX_TAGS = 4 // cap each list — defends the prompt against a tampered body
const MAX_TAG_LEN = 40

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().slice(0, MAX_TAG_LEN))
    .filter(Boolean)
    .slice(0, MAX_TAGS)
}

function buildPrompt(loved: string[], vibes: string[], easingOff: string[]): string {
  const lines: string[] = []
  if (loved.length) lines.push(`Cuisines they keep saving: ${loved.join(', ')}`)
  if (vibes.length) lines.push(`Vibes they lean toward: ${vibes.join(', ')}`)
  if (easingOff.length) lines.push(`Cuisines they've been skipping: ${easingOff.join(', ')}`)
  return [
    'You write one short, warm line for a date-night planner that summarises the',
    "couple's taste, inferred from what they save and skip. It appears as a small",
    'hint above the planning form.',
    '',
    'Rules:',
    '- ONE sentence, max 14 words, no period needed.',
    '- Use ONLY the tags below. Never invent cuisines, venues, places, or names.',
    '- If they are easing off something, phrase it gently (e.g. "less Italian lately"),',
    '  never as a hard rule.',
    '- Warm and specific, not salesy. No emoji. No quotes around the output.',
    '',
    'Their taste:',
    ...lines,
    '',
    'Write the line:',
  ].join('\n')
}

export async function POST(request: NextRequest) {
  if (process.env.AGENTIC_TASTE_NARRATE_ENABLED !== 'true') {
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const b = body as Record<string, unknown>
  const loved = sanitizeTags(b.loved)
  const vibes = sanitizeTags(b.vibes)
  const easingOff = sanitizeTags(b.easingOff)
  if (loved.length === 0 && vibes.length === 0 && easingOff.length === 0) {
    return Response.json({ narration: null })
  }

  const raw = await chatComplete({
    model: COPY_MODEL,
    prompt: buildPrompt(loved, vibes, easingOff),
    timeoutMs: 6000,
  })
  // Strip wrapping quotes / stray whitespace the model sometimes adds; cap length
  // so a runaway response can't blow out the hint pill.
  const narration = raw.trim().replace(/^["']|["']$/g, '').slice(0, 140) || null

  // Await so the row actually lands before the serverless function freezes
  // (fire-and-forget after Response is unreliable). recordRun swallows its own
  // errors and the client already rendered the templated hint, so this only
  // affects when the narrated swap arrives — not whether the hint shows.
  await recordRun('taste-narrate', {
    loved,
    vibes,
    easingOff,
    produced: Boolean(narration),
  })

  return Response.json({ narration })
}
