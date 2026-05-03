import { NextRequest } from 'next/server'
import { scanBlogs } from '@/lib/sources/blog-scanner'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const result = await scanBlogs()
  return Response.json(result)
}
