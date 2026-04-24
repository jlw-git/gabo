'use client'

import type { PlanCard as PlanCardType } from '@/lib/planner/types'

type Props = {
  card: PlanCardType
  scheduledFor: Date
  overrideTags: string[]
  onConfirm: () => void
  onClose: () => void
}

// Booking confirmation sheet. On confirm, opens the venue's Chope listing
// in a new tab. The Chope deep-link simulation is disclosed once in the
// "About this demo" modal (PRD §7), not in this primary flow.
const KNOWN_OCCASIONS = new Set(['anniversary', 'birthday', 'vegetarian', 'no_alcohol'])

export function BookingOverlay({ card, scheduledFor, overrideTags, onConfirm, onClose }: Props) {
  const known = overrideTags.find((t) => t === 'anniversary' || t === 'birthday')
  const custom = overrideTags.find((t) => !KNOWN_OCCASIONS.has(t))
  const occasionLabel = known ? capitalize(known) : custom ? capitalize(custom) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Book {card.name}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600" aria-label="Close">✕</button>
        </div>

        <div className="mb-4 rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200">
          <Row label="Restaurant" value={card.name} />
          <Row label="Date" value={scheduledFor.toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'short' })} />
          <Row label="Time" value={scheduledFor.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', hour12: true })} />
          <Row label="Party" value="2" />
          {occasionLabel && <Row label="Occasion" value={occasionLabel} />}
        </div>

        <button
          onClick={onConfirm}
          className="w-full rounded-2xl bg-rose-600 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-rose-700 active:scale-[0.99]"
        >
          Open on Chope →
        </button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-stone-500">{label}</span>
      <span className="font-medium text-stone-900">{value}</span>
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
