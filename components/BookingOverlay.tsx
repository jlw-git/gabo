'use client'

import { useState } from 'react'
import type { PlanCard as PlanCardType } from '@/lib/planner/types'
import { isEvent } from '@/lib/planner/category'
import { buildActionPlan, type ActionTier } from '@/lib/booking/action-plan'
import { recordBooking } from '@/lib/booking/booking-log'
import { googleCalendarUrl } from '@/lib/calendar'

type Props = {
  card: PlanCardType
  scheduledFor: Date
  overrideTags: string[]
  onConfirm: () => void
  onClose: () => void
}

const BOOKING_GATE = process.env.NEXT_PUBLIC_AGENTIC_BOOKING_ENABLED === 'true'

// Confirmation sheet. For dining, "Reserve" → opens the venue's Chope listing.
// For events, "Get tickets" → opens the official event page (catalog
// `chope_url` field is overloaded as event_url for non-eatery venues).
//
// F3: behind NEXT_PUBLIC_AGENTIC_BOOKING_ENABLED, this becomes the booking
// concierge's human-in-the-loop gate — a tiered action plan, party-size, a real
// add-to-calendar action, an honest "we never book without you" note, and an
// audit-logged confirm. Flag off → the original sheet, unchanged.
const KNOWN_OCCASIONS = new Set(['anniversary', 'birthday', 'vegetarian', 'no_alcohol'])

export function BookingOverlay({ card, scheduledFor, overrideTags, onConfirm, onClose }: Props) {
  const event = isEvent(card)
  const known = overrideTags.find((t) => t === 'anniversary' || t === 'birthday')
  const custom = overrideTags.find((t) => !KNOWN_OCCASIONS.has(t))
  const occasionLabel = known ? capitalize(known) : custom ? capitalize(custom) : null

  const title = event ? `Get tickets for ${card.name}` : `Reserve at ${card.name}`
  const cta = event ? 'Continue to event page →' : 'Continue to Chope →'
  const venueLabel = event ? 'Event' : 'Restaurant'

  const [partySize, setPartySize] = useState(2)
  const [calendarAdded, setCalendarAdded] = useState(false)

  const dateStr = scheduledFor.toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
  const timeStr = scheduledFor.toLocaleTimeString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  function addToCalendar() {
    const url = googleCalendarUrl({
      title: event ? card.name : `Date night — ${card.name}`,
      start: scheduledFor,
      durationMin: 120,
      location: card.address,
      details: `Planned with Gabo. ${event ? 'Tickets' : `Reservation for ${partySize}`}.`,
    })
    window.open(url, '_blank', 'noopener,noreferrer')
    setCalendarAdded(true)
  }

  function confirm() {
    if (BOOKING_GATE) {
      recordBooking({
        venue_id: card.id,
        name: card.name,
        party_size: event ? 0 : partySize,
        actions: calendarAdded ? ['reserve', 'calendar'] : ['reserve'],
      })
    }
    onConfirm()
  }

  // Flag off → the original sheet, unchanged.
  if (!BOOKING_GATE) {
    return (
      <Sheet title={title} onClose={onClose}>
        <div className="mb-4 rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200">
          <Row label={venueLabel} value={card.name} />
          <Row label="Date" value={dateStr} />
          <Row label="Time" value={timeStr} />
          {!event && <Row label="Party" value="2" />}
          {occasionLabel && <Row label="Occasion" value={occasionLabel} />}
        </div>
        <PrimaryButton onClick={onConfirm} label={cta} />
      </Sheet>
    )
  }

  // Flag on → the safeguard gate.
  const actions = buildActionPlan(card, scheduledFor, partySize)
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="mb-4 rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200">
        <Row label={venueLabel} value={card.name} />
        <Row label="Date" value={dateStr} />
        <Row label="Time" value={timeStr} />
        {card.address && <Row label="Where" value={card.address} />}
        {occasionLabel && <Row label="Occasion" value={occasionLabel} />}
        {!event && (
          <div className="flex items-center justify-between py-1 text-sm">
            <span className="text-stone-500">Party</span>
            <Stepper value={partySize} onChange={setPartySize} />
          </div>
        )}
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
        Here’s what happens
      </p>
      <ul className="mb-4 space-y-2">
        {actions.map((a) => (
          <li key={a.kind} className="flex items-start gap-2 text-sm">
            <TierDot tier={a.tier} />
            <div>
              <p className="font-medium text-stone-900">{a.label}</p>
              <p className="text-xs text-stone-500">{a.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={addToCalendar}
        className="mb-2 w-full rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 transition hover:bg-stone-50"
      >
        {calendarAdded ? '✓ Calendar event opened' : '📅 Add to calendar'}
      </button>

      <PrimaryButton onClick={confirm} label={cta} />
      <p className="mt-2 text-center text-xs text-stone-400">
        You complete the booking yourself — Gabo never books on your behalf.
      </p>
    </Sheet>
  )
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PrimaryButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl bg-rose-600 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-rose-700 active:scale-[0.99]"
    >
      {label}
    </button>
  )
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-3">
      <StepBtn label="Decrease party size" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>
        −
      </StepBtn>
      <span className="w-4 text-center font-medium text-stone-900">{value}</span>
      <StepBtn label="Increase party size" disabled={value >= 12} onClick={() => onChange(Math.min(12, value + 1))}>
        +
      </StepBtn>
    </span>
  )
}

function StepBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled: boolean
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-100 text-stone-700 ring-1 ring-stone-200 transition hover:bg-stone-200 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

const TIER_COLOR: Record<ActionTier, string> = {
  irreversible: 'bg-rose-500',
  outward: 'bg-amber-500',
  reversible: 'bg-emerald-500',
}

function TierDot({ tier }: { tier: ActionTier }) {
  return <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${TIER_COLOR[tier]}`} aria-hidden="true" />
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
