import { NextRequest } from 'next/server'
import { runIntakeTurn, type ConversationTurn } from '@/lib/agents/conversation'
import { parsePlanRequest, type PlanRequest } from '@/lib/planner/request-validation'

// Chat-first intake (F1 flesh-out). Streams progress as Server-Sent Events while
// the agent gathers the plan (date/time required, starts + prefs optional) and,
// once a date/time is set, runs the deterministic planner.
//
// Body: { message: string, history?: ConversationTurn[], draft?: Partial<PlanRequest> }
// SSE frames: {type:'status',label} … then {type:'result', assistantMessage,
//   request, planned, buckets, meta}. Gated by AGENTIC_CHAT_ENABLED.

// Build a draft request. scheduled_for is OPTIONAL during intake, so we validate
// the rest via parsePlanRequest with a placeholder time, then blank it out.
function parseDraft(raw: unknown): PlanRequest | null {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const hadTime = typeof d.scheduled_for === 'string' && d.scheduled_for.trim().length > 0
  const parsed = parsePlanRequest({
    ...d,
    scheduled_for: hadTime ? d.scheduled_for : '2099-01-01T00:00:00+08:00',
  })
  if (!parsed) return null
  return hadTime ? parsed : { ...parsed, scheduled_for: '' }
}

export async function POST(request: NextRequest) {
  if (process.env.AGENTIC_CHAT_ENABLED !== 'true') {
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
  const message = typeof b.message === 'string' ? b.message.trim() : ''
  if (!message) return Response.json({ error: 'message required' }, { status: 400 })

  const draft = parseDraft(b.draft)
  if (!draft) return Response.json({ error: 'invalid draft' }, { status: 400 })

  const history: ConversationTurn[] = Array.isArray(b.history)
    ? b.history
        .filter(
          (t): t is ConversationTurn =>
            !!t &&
            typeof t === 'object' &&
            ((t as ConversationTurn).role === 'user' || (t as ConversationTurn).role === 'assistant') &&
            typeof (t as ConversationTurn).text === 'string'
        )
        .slice(-10)
    : []

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          /* stream already closed */
        }
      }
      try {
        const result = await runIntakeTurn({
          message,
          history,
          draft,
          onEvent: (e) => send(e),
        })
        send({
          type: 'result',
          assistantMessage: result.assistantMessage,
          request: result.request,
          planned: result.planned,
          buckets: result.buckets ?? null,
          meta: result.meta ?? null,
        })
      } catch (err) {
        console.error('[chat] intake failed', err)
        send({
          type: 'result',
          assistantMessage: 'Something went wrong planning that — mind trying again?',
          request: draft,
          planned: false,
          buckets: null,
          meta: null,
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
