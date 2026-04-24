'use client'

import { useState } from 'react'
import type { Override } from '@/lib/planner/types'
import { PlaceSearchInput, type PlaceSelection } from './PlaceSearchInput'

type Props = {
  onSubmit: (payload: {
    start_a: { lat: number; lng: number }
    start_b: { lat: number; lng: number }
    scheduled_for: string
    override_tags: string[]
    startADetails: PlaceSelection
    startBDetails: PlaceSelection
  }) => void
  disabled?: boolean
  defaultStartA?: PlaceSelection | null
  defaultStartB?: PlaceSelection | null
  plannerName?: string
  partnerName?: string
  onEditProfile?: () => void
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
  onEditProfile,
}: Props) {
  const [youStart, setYouStart] = useState<PlaceSelection | null>(defaultStartA)
  const [partnerStart, setPartnerStart] = useState<PlaceSelection | null>(defaultStartB)
  const [time, setTime] = useState(defaultDateTime())
  const [occasion, setOccasion] = useState<Override[]>([])
  const [customOccasion, setCustomOccasion] = useState('')

  const canSubmit = !!youStart && !!partnerStart && !!time

  function toggle(tag: Override) {
    setOccasion((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !youStart || !partnerStart) return
    const custom = customOccasion.trim()
    const override_tags: string[] = [...occasion, ...(custom ? [custom] : [])]
    onSubmit({
      start_a: { lat: youStart.lat, lng: youStart.lng },
      start_b: { lat: partnerStart.lat, lng: partnerStart.lng },
      scheduled_for: new Date(time).toISOString(),
      override_tags,
      startADetails: youStart,
      startBDetails: partnerStart,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium tracking-wide text-rose-600">Gabo</p>
          {onEditProfile && (
            <button
              type="button"
              onClick={onEditProfile}
              className="text-xs text-stone-500 underline underline-offset-2 hover:text-stone-800"
            >
              Edit profile
            </button>
          )}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Plan a date night.</h1>
        <p className="text-sm text-stone-500">
          {plannerName && partnerName
            ? `The city's best tonight — tailored for ${plannerName} & ${partnerName}.`
            : "The city's best tonight — tailored for both of you."}
        </p>
      </header>

      <div className="space-y-4">
        <PlaceSearchInput
          id="you-start"
          label="Where you're starting"
          placeholder="e.g. Home, Raffles Place, Paya Lebar"
          value={youStart}
          onChange={setYouStart}
        />
        <PlaceSearchInput
          id="partner-start"
          label="Where your partner is starting"
          placeholder="e.g. Jurong East MRT, their office"
          value={partnerStart}
          onChange={setPartnerStart}
        />
      </div>

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
        {disabled ? 'Finding spots…' : 'Find spots'}
      </button>
      {!canSubmit && !disabled && (
        <p className="text-center text-xs text-stone-400">
          Add both starting points and a time to continue.
        </p>
      )}
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
