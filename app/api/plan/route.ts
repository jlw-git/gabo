import { NextRequest } from 'next/server'
import { planDate, PlanDateError } from '@/lib/planner/plan-date'
import { parsePlanRequest } from '@/lib/planner/request-validation'

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const parsed = parsePlanRequest(body)
  if (!parsed) {
    return Response.json(
      { error: 'valid Singapore start_a, start_b, scheduled_for, and profile required' },
      { status: 400 }
    )
  }

  try {
    return Response.json(await planDate(parsed))
  } catch (err) {
    if (err instanceof PlanDateError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    console.error('plan failed', err)
    return Response.json({ error: 'plan failed' }, { status: 500 })
  }
}
