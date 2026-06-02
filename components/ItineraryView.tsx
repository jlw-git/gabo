'use client'

import { useState } from 'react'
import type { PlanCard as PlanCardType } from '@/lib/planner/types'
import type { Itinerary } from '@/lib/planner/itinerary'
import { photoUrlOrFallback } from '@/lib/photo-fallback'

type Props = {
  itineraries: Itinerary[]
  onOpenDetails?: (card: PlanCardType) => void
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

const ROLE_LABEL: Record<string, string> = { dinner: 'Dinner', activity: 'Activity' }

export function ItineraryView({ itineraries, onOpenDetails }: Props) {
  const [selected, setSelected] = useState(0)

  if (itineraries.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6 ring-1 ring-stone-200">
        <h3 className="text-base font-semibold tracking-tight">No full evening fits this slot.</h3>
        <p className="mt-1 text-sm text-stone-600">
          We couldn’t line up a dinner and an activity that stay open and aren’t too far apart for
          this time. Try a slightly earlier slot, or browse the Dining and Events lists separately.
        </p>
      </div>
    )
  }

  const it = itineraries[Math.min(selected, itineraries.length - 1)]

  return (
    <div className="space-y-4">
      {itineraries.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {itineraries.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                i === selected
                  ? 'bg-stone-900 text-white ring-stone-900'
                  : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              Evening {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-white p-5 ring-1 ring-stone-200">
        {it.why && <p className="mb-4 text-sm font-medium text-stone-800">✨ {it.why}</p>}

        <ol className="relative space-y-3">
          {it.stops.map((stop, i) => (
            <li key={`${stop.card.id}-${i}`}>
              <StopRow stop={stop} onOpen={onOpenDetails} />
              {i < it.stops.length - 1 && (
                <div className="my-2 flex items-center gap-2 pl-4 text-xs text-stone-500">
                  <span aria-hidden="true">{it.leg.mode === 'transit' ? '🚆' : '🚗'}</span>
                  <span>
                    {it.leg.duration_min} min by {it.leg.mode === 'transit' ? 'MRT / bus' : 'car'}
                  </span>
                  <span className="h-px flex-1 bg-stone-200" />
                </div>
              )}
            </li>
          ))}
        </ol>

        <p className="mt-4 text-xs text-stone-400">
          About {Math.round(it.total_min / 30) / 2}h end to end, including travel.
        </p>
      </div>
    </div>
  )
}

function StopRow({
  stop,
  onOpen,
}: {
  stop: Itinerary['stops'][number]
  onOpen?: (card: PlanCardType) => void
}) {
  const { card } = stop
  return (
    <button
      type="button"
      onClick={() => onOpen?.(card)}
      className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-stone-50"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrlOrFallback(card)}
        alt=""
        className="h-14 w-14 flex-shrink-0 rounded-lg object-cover ring-1 ring-stone-200"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            {ROLE_LABEL[stop.role] ?? stop.role}
          </span>
          <span className="text-xs text-stone-500">{fmtTime(stop.arrive)}</span>
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-stone-900">{card.name}</p>
        {card.address && <p className="truncate text-xs text-stone-500">{card.address}</p>}
      </div>
    </button>
  )
}
