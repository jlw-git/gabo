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

  // Locations are optional — only the time is required to submit.
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

  const namedSubtitle =
    plannerName && partnerName
      ? `Tonight in Singapore — tailored for ${plannerName} & ${partnerName}.`
      : 'Tonight in Singapore — tailored for both of you.'

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm font-medium tracking-wide text-rose-600">Gabo</p>
        <h1 className="text-3xl font-semibold tracking-tight">Plan a date night in Singapore.</h1>
        <p className="text-sm text-stone-500">{namedSubtitle}</p>
      </header>

      <div>
        <label htmlFor="when" className="mb-1 block text-xs font-medium uppercase tracking-wider text-stone-500">
          When
        </label>
        <input
          id="when"
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-rose-300"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-stone-500">
          Starting points <span className="font-normal normal-case text-stone-400">· optional · we’ll go islandwide if blank</span>
        </p>
        <div className="space-y-3">
          <PlaceSearchInput
            id="you-start"
            label="Your start"
            placeholder="e.g. Home, Raffles Place, Paya Lebar"
            value={youStart}
            onChange={setYouStart}
          />
          <PlaceSearchInput
            id="partner-start"
            label="Your partner's start"
            placeholder="e.g. Jurong East MRT, their office"
            value={partnerStart}
            onChange={setPartnerStart}
          />
        </div>
        {youStart && partnerStart && (
          <p className="pt-1 text-xs text-stone-500">
            We’ll lean toward spots that are roughly midway between you both.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium uppercase tracking-wider text-stone-500">
          Special occasion <span className="font-normal normal-case text-stone-400">· optional</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {OCCASION_CHIPS.map((c) => {
            const on = occasion.includes(c.tag)
            return (
              <button
                type="button"
                key={c.tag}
                onClick={() => toggle(c.tag)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition ${
                  on
                    ? 'bg-rose-600 text-white ring-rose-600'
                    : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
                }`}
              >
                {c.label}
              </button>
            )
          })}
        </div>
        <input
          type="text"
          value={customOccasion}
          onChange={(e) => setCustomOccasion(e.target.value)}
          placeholder="Something else? e.g. proposal, reunion, first date"
          maxLength={60}
          className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-300"
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit || disabled}
        className="w-full rounded-2xl bg-rose-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-stone-300 disabled:shadow-none"
      >
        {disabled ? 'Finding spots…' : 'Search'}
      </button>
    </form>
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
