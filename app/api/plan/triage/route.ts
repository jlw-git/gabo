import { NextRequest } from 'next/server'
import { runTriage, type TriageInput } from '@/lib/agents/triage'
import { parseLatLng } from '@/lib/planner/request-validation'

// Body: { freeform, partial: { profile?, start_a?, start_b?, override_tags? } }
// Returns: TriageResult. The client then merges this into the normal
// PlanRequest body and POSTs /api/plan. Triage failure returns a result
// echoing whatever structured fields the form supplied — never throws.

export async function POST(request: NextRequest) {
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
  const freeform = typeof b.freeform === 'string' ? b.freeform : ''
  const partialRaw = (b.partial ?? {}) as Record<string, unknown>

  const input: TriageInput = {
    freeform,
    partial: {
      // The profile partial is passed through opaquely; runTriage's
      // mergeProfile handles missing fields with planner defaults.
      profile:
        typeof partialRaw.profile === 'object' && partialRaw.profile !== null
          ? (partialRaw.profile as TriageInput['partial']['profile'])
          : undefined,
      start_a: parseLatLng(partialRaw.start_a) ?? null,
      start_b: parseLatLng(partialRaw.start_b) ?? null,
      override_tags: Array.isArray(partialRaw.override_tags)
        ? partialRaw.override_tags.filter((t): t is string => typeof t === 'string')
        : [],
    },
  }

  try {
    const result = await runTriage(input)
    return Response.json(result)
  } catch (err) {
    console.error('[triage] failed', err)
    return Response.json({ error: 'triage failed' }, { status: 500 })
  }
}
