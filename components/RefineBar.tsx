'use client'

import { useState } from 'react'
import { loadShortlist } from '@/lib/shortlist-storage'
import type { PlanRequest } from '@/lib/planner/request-validation'
import type { Buckets } from './ResultsView'

// Client-safe mirror of the agent's turn shape (kept local so we don't import
// the server-side conversation module into a client component).
export type ChatTurn = { role: 'user' | 'assistant'; text: string }

export type RefineResult = {
  assistantMessage: string
  request: PlanRequest
  buckets: Buckets
}

type Props = {
  request: PlanRequest
  chat: ChatTurn[]
  onRefined: (userMessage: string, result: RefineResult) => void
}

const ENABLED = process.env.NEXT_PUBLIC_AGENTIC_CHAT_ENABLED === 'true'

export function RefineBar({ request, chat, onRefined }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ships dark — render nothing unless the client flag is on.
  if (!ENABLED) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const message = input.trim()
    if (!message || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/plan/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: chat,
          request,
          shortlist_ids: loadShortlist(),
        }),
      })
      if (!res.ok) throw new Error(`refine ${res.status}`)
      const data = (await res.json()) as RefineResult
      onRefined(message, data)
      setInput('')
    } catch (err) {
      console.error('refine failed', err)
      setError("Couldn't adjust the plan — your current results are unchanged.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      aria-label="Refine your plan"
      className="rounded-2xl bg-white p-4 ring-1 ring-stone-200"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">✨</span>
        <h2 className="text-sm font-semibold tracking-tight text-stone-900">
          Tweak this plan
        </h2>
      </div>
      <p className="mt-0.5 text-xs text-stone-500">
        Tell me what to change — “more romantic, less loud”, “closer to her side”, “somewhere cheaper”.
      </p>

      {chat.length > 0 && (
        <div className="mt-3 space-y-2">
          {chat.map((t, i) => (
            <div
              key={i}
              className={
                t.role === 'user'
                  ? 'ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-stone-900 px-3 py-1.5 text-xs text-white'
                  : 'mr-auto w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-stone-100 px-3 py-1.5 text-xs text-stone-700'
              }
            >
              {t.text}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          placeholder="What would you like to change?"
          className="flex-1 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-900 ring-1 ring-stone-200 outline-none placeholder:text-stone-400 focus:ring-stone-400 disabled:opacity-60"
          aria-label="Refinement request"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex-shrink-0 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-40"
        >
          {loading ? '…' : 'Send'}
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </section>
  )
}
