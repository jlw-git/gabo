'use client'

import { useState } from 'react'
import type {
  PlanCard as PlanCardType,
  Profile,
  TransitMode,
} from '@/lib/planner/types'
import type { PlaceSelection } from './PlaceSearchInput'
import { PlanCard } from './PlanCard'
import { BookingOverlay } from './BookingOverlay'
import { WhatsAppShareModal } from './WhatsAppShareModal'
import { VenueDetailModal } from './VenueDetailModal'
import { OverviewMap } from './OverviewMap'

export type Buckets = {
  safe: PlanCardType[]
  stretch: PlanCardType[]
  wild: PlanCardType[]
}

type Props = {
  buckets: Buckets
  profile: Profile
  scheduledFor: Date
  overrideTags: string[]
  startA: PlaceSelection
  startB: PlaceSelection
  onBack: () => void
}

type Section = {
  key: keyof Buckets
  eyebrow: string
  title: string
  subtitle: string
  dot: string // tailwind bg-* for the accent dot
  eyebrowTone: string // tailwind text-* for the eyebrow
}

const SECTIONS: Section[] = [
  {
    key: 'safe',
    eyebrow: 'EASY',
    title: 'Easy yes',
    subtitle: 'Familiar ground — you know what you’re getting.',
    dot: 'bg-emerald-500',
    eyebrowTone: 'text-emerald-700',
  },
  {
    key: 'stretch',
    eyebrow: 'STRETCH',
    title: 'A small detour',
    subtitle: 'Nudges your usual, stays within reach.',
    dot: 'bg-amber-500',
    eyebrowTone: 'text-amber-700',
  },
  {
    key: 'wild',
    eyebrow: 'WILD',
    title: 'Worth the leap',
    subtitle: 'Fresh, buzzy, or limited-run.',
    dot: 'bg-rose-500',
    eyebrowTone: 'text-rose-700',
  },
]

export function ResultsView({
  buckets,
  profile,
  scheduledFor,
  overrideTags,
  startA,
  startB,
  onBack,
}: Props) {
  const [booking, setBooking] = useState<PlanCardType | null>(null)
  const [shared, setShared] = useState<PlanCardType | null>(null)
  const [details, setDetails] = useState<PlanCardType | null>(null)
  const [view, setView] = useState<'list' | 'map'>('list')

  const defaultMode: TransitMode =
    profile.transit_pref === 'mrt' ? 'transit' : 'drive'
  const totalCards = buckets.safe.length + buckets.stretch.length + buckets.wild.length
  const plannerLabel = profile.planner_name?.trim() || 'You'
  const partnerLabel = profile.partner_name?.trim() || 'Partner'

  function confirmBooking(card: PlanCardType) {
    setBooking(null)
    setShared(card)
    if (card.chope_url) window.open(card.chope_url, '_blank', 'noopener,noreferrer')
  }

  // If it's a celebratory occasion, lead with the Wild section.
  const celebratory =
    overrideTags.includes('anniversary') || overrideTags.includes('birthday')
  const orderedSections = celebratory
    ? [SECTIONS.find((s) => s.key === 'wild')!, ...SECTIONS.filter((s) => s.key !== 'wild')]
    : SECTIONS

  return (
    <div className="space-y-6">
      <header>
        <button onClick={onBack} className="text-sm text-stone-500 hover:text-stone-800">
          ← Plan another
        </button>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {totalCards === 0 ? 'No matches this time.' : 'Pick a few to share.'}
        </h1>
        <p className="text-sm text-stone-500">
          {scheduledFor.toLocaleString('en-SG', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}
        </p>
      </header>

      {totalCards > 0 && (
        <div
          className="inline-flex self-start rounded-full bg-stone-100 p-1 ring-1 ring-stone-200"
          role="tablist"
          aria-label="Results view"
        >
          <ViewTab active={view === 'list'} onClick={() => setView('list')} label="List" />
          <ViewTab active={view === 'map'} onClick={() => setView('map')} label="Map" />
        </div>
      )}

      {totalCards === 0 && (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-stone-200">
          <p className="text-sm text-stone-600">
            Nothing quite fits that time. Try a later hour, a different day, or remove an occasion tag.
          </p>
        </div>
      )}

      {totalCards > 0 && view === 'map' && (
        <OverviewMap
          buckets={buckets}
          startA={startA}
          startB={startB}
          plannerLabel={plannerLabel}
          partnerLabel={partnerLabel}
          mode={defaultMode}
          onSelect={(card) => setDetails(card)}
        />
      )}

      {totalCards > 0 && view === 'list' && (
        <div className="space-y-10">
          {orderedSections.map((section) => {
          const cards = buckets[section.key]
          return (
            <section key={section.key}>
              <div className="mb-3 flex items-stretch gap-3">
                <span
                  className={`w-1 flex-shrink-0 rounded-full ${section.dot}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p
                    className={`text-[11px] font-bold tracking-[0.2em] ${section.eyebrowTone}`}
                  >
                    {section.eyebrow}
                  </p>
                  <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
                  <p className="text-sm text-stone-500">{section.subtitle}</p>
                </div>
              </div>
              {cards.length === 0 ? (
                <div className="rounded-2xl bg-white/60 p-5 text-sm text-stone-500 ring-1 ring-stone-200">
                  {emptyCopy(section.key)}
                </div>
              ) : (
                <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {cards.map((c) => (
                    <div
                      key={c.id}
                      className="w-[84vw] max-w-[320px] flex-shrink-0 snap-start"
                    >
                      <PlanCard
                        card={c}
                        profile={profile}
                        defaultMode={defaultMode}
                        plannerLabel={plannerLabel}
                        partnerLabel={partnerLabel}
                        onBook={(card) => setBooking(card)}
                        onOpenDetails={(card) => setDetails(card)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
        </div>
      )}

      {booking && (
        <BookingOverlay
          card={booking}
          scheduledFor={scheduledFor}
          overrideTags={overrideTags}
          onConfirm={() => confirmBooking(booking)}
          onClose={() => setBooking(null)}
        />
      )}
      {shared && (
        <WhatsAppShareModal
          card={shared}
          profile={profile}
          scheduledFor={scheduledFor}
          onClose={() => setShared(null)}
        />
      )}
      {details && (
        <VenueDetailModal
          card={details}
          profile={profile}
          defaultMode={defaultMode}
          startA={startA}
          startB={startB}
          onBook={(card) => {
            setDetails(null)
            setBooking(card)
          }}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  )
}

function ViewTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
        active ? 'bg-white text-stone-900 shadow-sm ring-1 ring-stone-200' : 'text-stone-500 hover:text-stone-800'
      }`}
    >
      {label}
    </button>
  )
}

function emptyCopy(key: keyof Buckets): string {
  if (key === 'safe')
    return 'No easy picks this time — your start points may be too far apart. Try a closer meeting point.'
  if (key === 'stretch') return 'No mid-range picks matched. Widen your cuisine preferences to fill this row.'
  return 'No fresh or buzzy spots fit this slot. Check a later time — pop-ups often open evenings.'
}
