'use client'

import { useRef, useState } from 'react'
import type { PlanRequest } from '@/lib/planner/request-validation'
import type { Buckets } from './ResultsView'
import type { ChatTurn } from './RefineBar'

type Props = {
  initialDraft: PlanRequest
  onPlanned: (request: PlanRequest, buckets: Buckets, chat: ChatTurn[]) => void
  onBack: () => void
}

type Frame =
  | { type: 'status'; label: string }
  | { type: 'result'; assistantMessage: string; request: PlanRequest; planned: boolean; buckets: Buckets | null }

// Chat-first intake (F1). Streams progress (SSE) while the agent gathers the
// plan; on `planned`, hands the request + buckets up to transition to results.
export function ChatPanel({ initialDraft, onPlanned, onBack }: Props) {
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const draftRef = useRef<PlanRequest>(initialDraft)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const message = input.trim()
    if (!message || loading) return
    const priorHistory = messages
    const withUser = [...messages, { role: 'user' as const, text: message }]
    setMessages(withUser)
    setInput('')
    setLoading(true)
    setStatus('Thinking…')

    try {
      const res = await fetch('/api/plan/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: priorHistory, draft: draftRef.current }),
      })
      if (!res.ok || !res.body) throw new Error(`chat ${res.status}`)

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let result: Extract<Frame, { type: 'result' }> | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue
          let frame: Frame
          try {
            frame = JSON.parse(line.slice(5).trim()) as Frame
          } catch {
            continue
          }
          if (frame.type === 'status') setStatus(frame.label)
          else if (frame.type === 'result') result = frame
        }
      }

      if (!result) throw new Error('no result')
      draftRef.current = result.request
      const finalChat = [...withUser, { role: 'assistant' as const, text: result.assistantMessage }]
      setMessages(finalChat)
      setStatus(null)
      if (result.planned && result.buckets) {
        onPlanned(result.request, result.buckets, finalChat)
      } else {
        setLoading(false)
      }
    } catch (err) {
      console.error('chat failed', err)
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: 'Something went wrong — mind trying again?' },
      ])
      setStatus(null)
      setLoading(false)
    }
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4 md:max-w-2xl">
      <header>
        <button onClick={onBack} className="text-sm text-stone-500 hover:text-stone-800">
          ← Use the form instead
        </button>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Plan by chat</h1>
        <p className="text-sm text-stone-500">
          Describe your date night — when, roughly where, the vibe — and I’ll put it together.
        </p>
      </header>

      <div className="min-h-[8rem] space-y-2 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        {messages.length === 0 && !loading && (
          <p className="text-sm text-stone-400">
            e.g. “this Saturday evening, somewhere romantic near the water, she’s coming from Tiong Bahru”
          </p>
        )}
        {messages.map((t, i) => (
          <div
            key={i}
            className={
              t.role === 'user'
                ? 'ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-stone-900 px-3 py-1.5 text-sm text-white'
                : 'mr-auto w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-stone-100 px-3 py-1.5 text-sm text-stone-700'
            }
          >
            {t.text}
          </div>
        ))}
        {loading && status && (
          <div className="mr-auto flex w-fit items-center gap-2 rounded-2xl rounded-bl-sm bg-stone-50 px-3 py-1.5 text-sm text-stone-500">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
            {status}
          </div>
        )}
      </div>

      <form onSubmit={send} className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          placeholder="Tell me about your date night…"
          aria-label="Describe your date night"
          className="flex-1 rounded-xl bg-white px-3 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200 outline-none placeholder:text-stone-400 focus:ring-stone-400 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex-shrink-0 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-40"
        >
          {loading ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
