import { createHash } from 'crypto'
import { headers } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Provider, ToolCall } from '@/lib/agents/provider'

export type GeminiUsageFeature =
  | 'plan-copy'
  | 'plan-triage'
  | 'plan-refine'
  | 'plan-chat'
  | 'plan-relaxation'
  | 'plan-ranker'
  | 'plan-itinerary'
  | 'taste-narrate'
  | 'source-discovery'
  | 'museum-agent'
  | 'fresh-event-discovery'
  | 'blog-scanner'
  | 'tsl-events'
  | 'freshness-verifier'
  | 'blog-verifier'
  | 'museum-verifier'
  | 'unknown'

export type GeminiUsageLogInput = {
  feature?: GeminiUsageFeature
  provider: Provider
  model: string
  grounded?: boolean
  toolCallCount?: number
  toolCalls?: ToolCall[]
  prompt: string
  outputChars: number
  durationMs: number
  ok: boolean
  errorMessage?: string
}

const PROMPT_PREVIEW_CHARS = 1600
const ERROR_PREVIEW_CHARS = 300

export async function recordGeminiUsage(input: GeminiUsageLogInput): Promise<void> {
  try {
    const req = await requestContext()
    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('gemini_usage_log').insert({
      feature: input.feature ?? 'unknown',
      provider: input.provider,
      model: input.model,
      grounded: Boolean(input.grounded),
      tool_call_count: input.toolCallCount ?? 0,
      tool_calls: sanitiseToolCalls(input.toolCalls ?? []),
      prompt_preview: redactPrompt(input.prompt).slice(0, PROMPT_PREVIEW_CHARS),
      prompt_chars: input.prompt.length,
      output_chars: input.outputChars,
      duration_ms: Math.max(0, Math.round(input.durationMs)),
      ok: input.ok,
      error_message: input.errorMessage ? redactPrompt(input.errorMessage).slice(0, ERROR_PREVIEW_CHARS) : null,
      route_path: req.routePath,
      ip_hash: req.ipHash,
      user_agent_hash: req.userAgentHash,
    })
    if (error) console.error('[gemini-usage-log] insert failed:', error.message)
  } catch (err) {
    console.error(
      '[gemini-usage-log] insert threw:',
      err instanceof Error ? err.message : String(err)
    )
  }
}

function redactPrompt(value: string): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-google-api-key]')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[redacted-api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [redacted-token]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted-phone]')
}

function sanitiseToolCalls(toolCalls: ToolCall[]): Record<string, unknown>[] {
  return toolCalls.slice(0, 20).map((call) => ({
    name: call.name,
    args_keys: Object.keys(call.args ?? {}).slice(0, 30),
  }))
}

async function requestContext(): Promise<{
  routePath: string | null
  ipHash: string | null
  userAgentHash: string | null
}> {
  try {
    const hdrs = await headers()
    const routePath = hdrs.get('x-invoke-path') ?? hdrs.get('x-matched-path') ?? null
    const ip =
      hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      hdrs.get('x-real-ip') ??
      hdrs.get('cf-connecting-ip') ??
      null
    const userAgent = hdrs.get('user-agent')
    return {
      routePath,
      ipHash: hashValue(ip),
      userAgentHash: hashValue(userAgent),
    }
  } catch {
    return { routePath: null, ipHash: null, userAgentHash: null }
  }
}

function hashValue(value: string | null): string | null {
  if (!value) return null
  const salt = process.env.GEMINI_USAGE_LOG_SALT ?? process.env.CRON_SECRET ?? 'gabo'
  return createHash('sha256').update(`${salt}:${value}`).digest('hex')
}
