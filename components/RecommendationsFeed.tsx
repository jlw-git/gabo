'use client'

import { useEffect, useMemo, useState } from 'react'
import type { PlanCard as PlanCardType, Profile, TransitMode } from '@/lib/planner/types'
import {
  hasClosingSoonLabel,
  hasJustOpenedLabel,
  isRecommended,
} from '@/lib/planner/badges'
import { bookingUrl } from '@/lib/booking-url'
import { loadShortlist, logShortlistEvent, saveShortlist } from '@/lib/shortlist-storage'
import { PlanCard } from './PlanCard'
import { VenueDetailModal } from './VenueDetailModal'
import { WhatsAppShareModal } from './WhatsAppShareModal'

type Recommendations = {
  trending: PlanCardType[]
  new: PlanCardType[]
  limited: PlanCardType[]
}

type Props = {
  profile: Profile
}

type Tab = 'dining' | 'events'
type Filter = 'all' | 'recommended' | 'limited' | 'new' | 'shortlist'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'dining', label: 'Dining', icon: '🍽️' },
  { key: 'events', label: 'Events', icon: '🎟️' },
]

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'recommended', label: 'Recommended' },
  { key: 'limited', label: 'Limited-run' },
  { key: 'new', label: 'Just opened' },
  { key: 'shortlist', label: '★ Shortlist' },
]

function applyFilter(cards: PlanCardType[], filter: Filter, shortlist: Set<string>): PlanCardType[] {
  switch (filter) {
    case 'all':
      return cards
    case 'recommended':
      return cards.filter(isRecommended)
    case 'limited':
      return cards.filter(hasClosingSoonLabel)
    case 'new':
      return cards.filter(hasJustOpenedLabel)
    case 'shortlist':
      return cards.filter((c) => shortlist.has(c.id))
  }
}

export function RecommendationsFeed({ profile }: Props) {
  const [recs, setRecs] = useState<Recommendations | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('dining')
  const [filter, setFilter] = useState<Filter>('all')
  const [details, setDetails] = useState<PlanCardType | null>(null)
  const [shared, setShared] = useState<PlanCardType | null>(null)
  const [shortlist, setShortlist] = useState<Set<string>>(new Set())

  useEffect(() => {
    setShortlist(new Set(loadShortlist()))
    let cancelled = false
    fetch('/api/recommendations')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as Recommendations
      })
      .then((data) => {
        if (!cancelled) setRecs(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [])

  function toggleShortlist(card: PlanCardType) {
    setShortlist((prev) => {
      const next = new Set(prev)
      if (next.has(card.id)) {
        next.delete(card.id)
      } else {
        next.add(card.id)
        logShortlistEvent(card.id)
      }
      saveShortlist([...next])
      return next
    })
  }

  // Flatten and deduplicate across sections. limited first so closing_soon
  // badge is preserved when a venue appears in multiple sections.
  const allCards = useMemo(() => {
    if (!recs) return []
    const seen = new Set<string>()
    const out: PlanCardType[] = []
    for (const c of [...recs.limited, ...recs.new, ...recs.trending]) {
      if (!seen.has(c.id)) {
        seen.add(c.id)
        out.push(c)
      }
    }
    return out
  }, [recs])

  const diningCards = useMemo(() => allCards.filter((c) => c.bucket === 'dining'), [allCards])
  const eventsCards = useMemo(() => allCards.filter((c) => c.bucket === 'event'), [allCards])
  const tabCards = tab === 'dining' ? diningCards : eventsCards
  const activeCards = useMemo(
    () => applyFilter(tabCards, filter, shortlist),
    [tabCards, filter, shortlist]
  )
  const shortlistCount = useMemo(
    () => allCards.filter((c) => shortlist.has(c.id)).length,
    [allCards, shortlist]
  )

  const defaultMode: TransitMode = profile.transit_pref === 'mrt' ? 'transit' : 'drive'
  const plannerLabel = profile.planner_name?.trim() || 'You'
  const partnerLabel = profile.partner_name?.trim() || 'Partner'

  if (error) return null

  if (!recs) {
    return (
      <div className="space-y-5">
        <div className="border-t border-stone-200 pt-7">
          <div className="h-6 w-48 animate-pulse rounded bg-stone-200" />
          <div className="mt-1.5 h-4 w-72 animate-pulse rounded bg-stone-100" />
        </div>
        <div className="h-9 w-64 animate-pulse rounded-full bg-stone-100" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded-full bg-stone-100" />
          ))}
        </div>
        <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-2xl bg-white/60 ring-1 ring-stone-200"
            />
          ))}
        </div>
      </div>
    )
  }

  if (allCards.length === 0) return null

  const otherTabHasContent =
    (tab === 'dining' ? eventsCards.length : diningCards.length) > 0

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 border-t border-stone-200 pt-7">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Right now in Singapore</h2>
          <p className="text-xs text-stone-500">
            A quick taste of what&rsquo;s on. Use the planner above for a tailored shortlist.
          </p>
        </div>
      </div>

      {/* Dining / Events tabs */}
      <div
        role="tablist"
        aria-label="Category"
        className="inline-flex rounded-full bg-stone-100 p-1 ring-1 ring-stone-200"
      >
        {TABS.map((t) => {
          const count = t.key === 'dining' ? diningCards.length : eventsCards.length
          const on = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                on
                  ? 'bg-white text-stone-900 shadow-sm ring-1 ring-stone-200'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span>{t.label}</span>
              <span
                className={`ml-1 rounded-full px-1.5 text-[10px] font-bold ${
                  on ? 'bg-rose-100 text-rose-700' : 'bg-stone-200 text-stone-600'
                }`}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Filter chips */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => {
          const on = f.key === filter
          const showCount = f.key === 'shortlist' && shortlistCount > 0
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                on
                  ? 'bg-stone-900 text-white ring-stone-900'
                  : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              {f.label}
              {showCount && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 text-[10px] ${
                    on ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {shortlistCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Card grid or empty state */}
      {activeCards.length === 0 ? (
        <div className="rounded-2xl bg-white p-5 ring-1 ring-stone-200">
          <h3 className="text-sm font-semibold tracking-tight text-stone-900">
            {filter === 'shortlist'
              ? 'Nothing saved yet.'
              : filter === 'limited'
              ? 'No closing-soon picks right now.'
              : filter === 'new'
              ? 'No new openings at the moment.'
              : filter === 'recommended'
              ? 'No critic or trending picks here yet.'
              : tab === 'dining'
              ? 'No dining picks at the moment.'
              : 'No events on at the moment.'}
          </h3>
          <p className="mt-1 text-sm text-stone-600">
            {filter === 'shortlist'
              ? 'Tap ☆ on any card to save it here.'
              : 'Try a different filter or switch tabs.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {filter !== 'all' && (
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="rounded-full bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800"
              >
                Show all
              </button>
            )}
            {otherTabHasContent && (
              <button
                type="button"
                onClick={() => setTab(tab === 'dining' ? 'events' : 'dining')}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
              >
                Switch to {tab === 'dining' ? 'Events' : 'Dining'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:grid-cols-3">
          {activeCards.map((card) => (
            <PlanCard
              key={card.id}
              card={card}
              profile={profile}
              defaultMode={defaultMode}
              plannerLabel={plannerLabel}
              partnerLabel={partnerLabel}
              shortlisted={shortlist.has(card.id)}
              onBook={() => setDetails(card)}
              onOpenDetails={(c) => setDetails(c)}
              onShare={(c) => setShared(c)}
              onToggleShortlist={toggleShortlist}
            />
          ))}
        </div>
      )}

      {details && (
        <VenueDetailModal
          card={details}
          profile={profile}
          defaultMode={defaultMode}
          allCards={allCards}
          shortlisted={shortlist.has(details.id)}
          onSelectCrossRec={(card) => setDetails(card)}
          onShare={(c) => setShared(c)}
          onToggleShortlist={toggleShortlist}
          onBook={() => {
            setDetails(null)
            window.open(bookingUrl(details), '_blank', 'noopener,noreferrer')
          }}
          onClose={() => setDetails(null)}
        />
      )}
      {shared && (
        <WhatsAppShareModal
          card={shared}
          profile={profile}
          scheduledFor={defaultScheduledFor()}
          onClose={() => setShared(null)}
        />
      )}
    </div>
  )
}

function defaultScheduledFor(): Date {
  const d = new Date()
  if (d.getHours() >= 18) d.setDate(d.getDate() + 1)
  d.setHours(19, 30, 0, 0)
  return d
}
