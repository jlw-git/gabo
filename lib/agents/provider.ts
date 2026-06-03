// LLM provider layer. One place that decides whether a call goes to OpenRouter
// (OpenAI-compatible) or directly to Gemini, so any task's model is a one-line
// change in the registry (lib/agents/models.ts).
//
// Defaults to Gemini and FALLS BACK to direct Gemini whenever OPENROUTER_API_KEY
// is absent — so behaviour is unchanged until a key is added. Google Search
// grounding is Gemini-only, so grounded calls are always pinned to Gemini
// regardless of provider.

import { GoogleGenAI, type Content, type FunctionCall, type Part } from '@google/genai'
import { OPENROUTER_FALLBACK_MODEL } from '@/lib/agents/models'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Build the OpenRouter model field. When a fallback is configured, use
// OpenRouter's `models` array so a primary outage fails over automatically
// (e.g. Kimi K2.6 → DeepSeek V4) with no extra round-trip.
export function orModels(mapped: string): Record<string, unknown> {
  const fb = OPENROUTER_FALLBACK_MODEL
  return fb && fb !== mapped ? { models: [mapped, fb] } : { model: mapped }
}

export type Provider = 'gemini' | 'openrouter'

function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

// A model id containing '/' is a provider-qualified OpenRouter slug
// (e.g. 'anthropic/claude-3.5-sonnet', 'google/gemini-2.5-flash'). A bare id
// like 'gemini-2.5-flash' can run on either backend.
function isProviderSlug(model: string): boolean {
  return model.includes('/')
}

// Decide which backend a call should use. Pure except for reading env.
export function resolveProvider(model: string, opts: { grounded?: boolean } = {}): Provider {
  // Google Search grounding only exists on Gemini-direct.
  if (opts.grounded) return 'gemini'
  if (hasOpenRouterKey()) return 'openrouter'
  // No OpenRouter key: a non-Gemini provider slug cannot run on Gemini-direct.
  if (isProviderSlug(model) && !model.startsWith('google/')) {
    throw new Error(
      `Model "${model}" needs OPENROUTER_API_KEY (non-Gemini provider slug); set the key or use a Gemini model.`
    )
  }
  return 'gemini'
}

// Translate a registry model id to the chosen backend's expected name.
export function mapModel(model: string, provider: Provider): string {
  if (provider === 'openrouter') {
    return isProviderSlug(model) ? model : `google/${model}`
  }
  // gemini-direct: strip a leading 'google/' if present.
  return model.startsWith('google/') ? model.slice('google/'.length) : model
}

function geminiClient(): GoogleGenAI {
  const key = process.env.GOOGLE_GEMINI_API_KEY
  if (!key) throw new Error('GOOGLE_GEMINI_API_KEY missing')
  return new GoogleGenAI({ apiKey: key })
}

function openRouterHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    // Optional OpenRouter attribution headers.
    'HTTP-Referer': 'https://gabo.sg',
    'X-Title': 'Gabo',
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

// ---------------------------------------------------------------------------
// Single-shot text completion. Returns raw model text, or '' on any failure
// (timeout / network / misconfig) — callers parse + degrade.
// ---------------------------------------------------------------------------

export type ChatCompleteOptions = {
  model: string
  prompt: string
  grounded?: boolean
  timeoutMs?: number
}

export async function chatComplete(opts: ChatCompleteOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 8000

  const run = (async (): Promise<string> => {
    try {
      const provider = resolveProvider(opts.model, { grounded: opts.grounded })
      const model = mapModel(opts.model, provider)

      if (provider === 'gemini') {
        const ai = geminiClient()
        const result = await ai.models.generateContent({
          model,
          contents: opts.prompt,
          config: opts.grounded ? { tools: [{ googleSearch: {} }] } : undefined,
        })
        return (result.text ?? '').trim()
      }

      // OpenRouter (OpenAI-compatible).
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: openRouterHeaders(),
        body: JSON.stringify({ ...orModels(model), messages: [{ role: 'user', content: opts.prompt }] }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return ''
      const data = (await res.json()) as OpenAIResponse
      return (data?.choices?.[0]?.message?.content ?? '').trim()
    } catch (err) {
      if (err instanceof Error && err.message.includes('OPENROUTER_API_KEY')) {
        console.error('[provider]', err.message)
      }
      return ''
    }
  })()

  return withTimeout(run, timeoutMs, '')
}

// ---------------------------------------------------------------------------
// Bounded tool-use loop, with a native implementation per backend (no mid-loop
// format translation). Returns { text, toolCalls } or null on failure.
// ---------------------------------------------------------------------------

export type ProviderTool = {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export type ToolCall = { name: string; args: Record<string, unknown> }
export type ToolLoopResult = { text: string; toolCalls: ToolCall[] }

export type ChatCompleteWithToolsOptions = {
  model: string
  prompt: string
  tools: ProviderTool[]
  maxRounds?: number
  timeoutMs?: number
}

export async function chatCompleteWithTools(
  opts: ChatCompleteWithToolsOptions
): Promise<ToolLoopResult | null> {
  const timeoutMs = opts.timeoutMs ?? 12_000
  const maxRounds = opts.maxRounds ?? 3

  const run = (async (): Promise<ToolLoopResult | null> => {
    try {
      const provider = resolveProvider(opts.model, {})
      const model = mapModel(opts.model, provider)
      return provider === 'gemini'
        ? await geminiToolLoop(model, opts.prompt, opts.tools, maxRounds)
        : await openRouterToolLoop(model, opts.prompt, opts.tools, maxRounds)
    } catch {
      return null
    }
  })()

  return withTimeout(run, timeoutMs, null)
}

async function runTool(
  byName: Map<string, ProviderTool>,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const tool = byName.get(name)
  if (!tool) return { error: `unknown tool: ${name}` }
  try {
    return await tool.handler(args)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'tool failed' }
  }
}

async function geminiToolLoop(
  model: string,
  prompt: string,
  tools: ProviderTool[],
  maxRounds: number
): Promise<ToolLoopResult> {
  const ai = geminiClient()
  const byName = new Map(tools.map((t) => [t.name, t]))
  const functionDeclarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.parameters,
  }))
  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }]
  const toolCalls: ToolCall[] = []

  for (let round = 0; round < maxRounds; round++) {
    const result = await ai.models.generateContent({
      model,
      contents,
      config: { tools: [{ functionDeclarations }] },
    })
    const calls: FunctionCall[] = result.functionCalls ?? []
    if (calls.length === 0) return { text: (result.text ?? '').trim(), toolCalls }

    contents.push({ role: 'model', parts: calls.map((c) => ({ functionCall: c })) })
    const responseParts: Part[] = []
    for (const call of calls) {
      const name = call.name ?? ''
      const args = (call.args ?? {}) as Record<string, unknown>
      toolCalls.push({ name, args })
      const response = await runTool(byName, name, args)
      responseParts.push({ functionResponse: { name, response } })
    }
    contents.push({ role: 'user', parts: responseParts })
  }

  const final = await ai.models.generateContent({ model, contents })
  return { text: (final.text ?? '').trim(), toolCalls }
}

async function openRouterToolLoop(
  model: string,
  prompt: string,
  tools: ProviderTool[],
  maxRounds: number
): Promise<ToolLoopResult> {
  const byName = new Map(tools.map((t) => [t.name, t]))
  const oaTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
  const messages: OpenAIMessage[] = [{ role: 'user', content: prompt }]
  const toolCalls: ToolCall[] = []

  const post = async (withTools: boolean) => {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: openRouterHeaders(),
      body: JSON.stringify({ ...orModels(model), messages, ...(withTools ? { tools: oaTools } : {}) }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    return (await res.json()) as OpenAIResponse
  }

  for (let round = 0; round < maxRounds; round++) {
    const data = await post(true)
    const msg = data?.choices?.[0]?.message
    if (!msg) return { text: '', toolCalls }
    const calls = msg.tool_calls ?? []
    if (calls.length === 0) return { text: (msg.content ?? '').trim(), toolCalls }

    messages.push(msg)
    for (const c of calls) {
      const name = c.function?.name ?? ''
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(c.function?.arguments ?? '{}')
      } catch {
        /* leave empty */
      }
      toolCalls.push({ name, args })
      const response = await runTool(byName, name, args)
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(response) })
    }
  }

  const final = await post(false)
  return { text: (final?.choices?.[0]?.message?.content ?? '').trim(), toolCalls }
}

// Minimal OpenAI-compatible response shapes (only the fields we read).
type OpenAIToolCall = {
  id?: string
  function?: { name?: string; arguments?: string }
}
type OpenAIMessage = {
  role: string
  content?: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}
type OpenAIResponse = {
  choices?: { message?: OpenAIMessage }[]
}
