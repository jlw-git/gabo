'use client'

import { useState } from 'react'
import type { Override } from '@/lib/planner/types'
import { PlaceSearchInput, type PlaceSelection } from './PlaceSearchInput'

type Props = {
  onSubmit: (payload: {
    start_a: { lat: number; lng: number } | null
    start_b: { lat: number; lng: number } | null
    scheduled_for: string
    override_tags: string[]
    startADetails: PlaceSelection | null
    startBDetails: PlaceSelection | null
  }) => void
  disabled?: boolean
  defaultStartA?: PlaceSelection | null
  defaultStartB?: PlaceSelection | null
  plannerName?: string
  partnerName?: string
}

const OCCASION_CHIPS: { tag: Override; label: string }[] = [
  { tag: 'anniversary', label: 'Anniversary' },
  { tag: 'birthday', label: 'Birthday' },
]

export function PlanDateForm({
  onSubmit,
  disabled,
  defaultStartA = null,
  defaultStartB = null,
  plannerName,
  partnerName,
}: Props) {
  const [youStart, setYouStart] = useState<PlaceSelection | null>(defaultStartA)
  const [partnerStart, setPartnerStart] = useState<PlaceSelection | null>(defaultStartB)
  const [time, setTime] = useState(defaultDateTime())
  const [occasion, setOccasion] = useState<Override[]>([])
  const [customOccasion, setCustomOccasion] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)

  const canSubmit = !!time

  function toggle(tag: Override) {
    setOccasion((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    const custom = customOccasion.trim()
    const override_tags: string[] = [...occasion, ...(custom ? [custom] : [])]
    onSubmit({
      start_a: youStart ? { lat: youStart.lat, lng: youStart.lng } : null,
      start_b: partnerStart ? { lat: partnerStart.lat, lng: partnerStart.lng } : null,
      scheduled_for: new Date(time).toISOString(),
      override_tags,
      startADetails: youStart,
      startBDetails: partnerStart,
    })
  }

  const youLabel = plannerName?.trim() ? `${plannerName}'s start` : "Your start"
  const partnerLabel = partnerName?.trim() ? `${partnerName}'s start` : 'Their start'

  return (
    <section className="space-y-8">
      <header className="space-y-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600">Gabo</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl lg:text-5xl">
          When are you two heading out?
        </h1>
        <p className="mx-auto max-w-xl text-sm text-stone-500 md:text-base">
          Tell us when and where you&rsquo;re each starting from. We&rsquo;ll find date spots that work for both of you in 60 seconds.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="rounded-3xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] ring-1 ring-stone-200 md:p-5"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(180px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end md:gap-2">
          <Field label="When">
            <input
              id="when"
              type="datetime-local"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-11 w-full rounded-xl bg-stone-50 px-3 text-sm ring-1 ring-stone-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
            />
          </Field>

          <Field label={youLabel} hint="Optional">
            <PlaceSearchInput
              id="you-start"
              label=""
              placeholder="e.g. Raffles Place"
              value={youStart}
              onChange={setYouStart}
            />
          </Field>

          <Field label={partnerLabel} hint="Optional">
            <PlaceSearchInput
              id="partner-start"
              label=""
              placeholder="e.g. Jurong East MRT"
              value={partnerStart}
              onChange={setPartnerStart}
            />
          </Field>

          <button
            type="submit"
            disabled={!canSubmit || disabled}
            className="h-11 rounded-xl bg-stone-900 px-6 text-sm font-semibold text-white transition hover:bg-stone-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-stone-300 md:min-w-[120px]"
          >
            {disabled ? 'Finding…' : 'Plan it'}
          </button>
        </div>

        {youStart && partnerStart && (
          <p className="mt-3 text-xs text-stone-500">
            We&rsquo;ll favour spots roughly midway between you both.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className="rounded-full px-2 py-1 text-xs font-medium text-stone-500 hover:text-stone-800"
            aria-expanded={moreOpen}
          >
            {moreOpen ? 'Less options ▴' : 'Special occasion? ▾'}
          </button>
          {!moreOpen &&
            occasion.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200"
              >
                {OCCASION_CHIPS.find((c) => c.tag === tag)?.label ?? tag}
              </span>
            ))}
        </div>

        {moreOpen && (
          <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
            <div className="flex flex-wrap gap-2">
              {OCCASION_CHIPS.map((c) => {
                const on = occasion.includes(c.tag)
                return (
                  <button
                    type="button"
                    key={c.tag}
                    onClick={() => toggle(c.tag)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                      on
                        ? 'bg-rose-50 text-rose-700 ring-rose-300'
                        : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
              <input
                type="text"
                value={customOccasion}
                onChange={(e) => setCustomOccasion(e.target.value)}
                placeholder="Something else? proposal, reunion, first date…"
                maxLength={60}
                className="min-w-[180px] flex-1 rounded-full bg-stone-50 px-3 py-1.5 text-xs ring-1 ring-stone-200 placeholder:text-stone-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
              />
            </div>
          </div>
        )}
      </form>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="flex items-baseline gap-1.5 text-[11px] font-medium uppercase tracking-wider text-stone-500">
          <span>{label}</span>
          {hint && <span className="text-[10px] font-normal normal-case tracking-normal text-stone-400">{hint}</span>}
        </label>
      )}
      {children}
    </div>
  )
}

// Default to tonight at 19:30; if it's already past 18:00, default to tomorrow.
function defaultDateTime(): string {
  const d = new Date()
  if (d.getHours() >= 18) d.setDate(d.getDate() + 1)
  d.setHours(19, 30, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
