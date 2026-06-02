import { NextRequest } from 'next/server'
import {
  runConversationTurn,
  type ConversationTurn,
} from '@/lib/agents/conversation'
import { parsePlanRequest } from '@/lib/planner/request-validation'

// Conversational refine endpoint (F1). The client sends the current PlanRequest
// (the one that produced the on-screen results) plus the user's free-text
// correction; we run the refine agent and return the updated request + buckets.
//
// Body: { message: string, history?: ConversationTurn[], request: PlanRequest, shortlist_ids?: string[] }
// Returns: { assistantMessage, request, buckets, meta }
//
// Gated by AGENTIC_CHAT_ENABLED — ships dark. Never throws on agent failure;
// the agent itself degrades to unchanged results with a friendly message.

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
  if (!message) {
    return Response.json({ error: 'message required' }, { status: 400 })
  }

  // The request the on-screen results came from. shortlist_ids may be sent
  // alongside; fold them in before validation so affinity stays consistent.
  const planReq = parsePlanRequest({
    ...(typeof b.request === 'object' && b.request !== null ? b.request : {}),
    shortlist_ids: Array.isArray(b.shortlist_ids) ? b.shortlist_ids : undefined,
  })
  if (!planReq) {
    return Response.json({ error: 'valid plan request required' }, { status: 400 })
  }

  const history: ConversationTurn[] = Array.isArray(b.history)
    ? b.history
        .filter(
          (t): t is ConversationTurn =>
            !!t &&
            typeof t === 'object' &&
            (((t as ConversationTurn).role === 'user') ||
              ((t as ConversationTurn).role === 'assistant')) &&
            typeof (t as ConversationTurn).text === 'string'
        )
        .slice(-10)
    : []

  try {
    const result = await runConversationTurn({ message, history, request: planReq })
    return Response.json(result)
  } catch (err) {
    console.error('[refine] failed', err)
    return Response.json({ error: 'refine failed' }, { status: 500 })
  }
}
