'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  PlanCard as PlanCardType,
  Profile,
  TransitMode,
} from '@/lib/planner/types'
import { bookingUrl } from '@/lib/booking-url'
import { loadShortlist, logShortlistEvent, saveShortlist } from '@/lib/shortlist-storage'
import type { PlaceSelection } from './PlaceSearchInput'
import { PlanCard } from './PlanCard'
import { BookingOverlay } from './BookingOverlay'
import { WhatsAppShareModal } from './WhatsAppShareModal'
import { VenueDetailModal } from './VenueDetailModal'
import { OverviewMap } from './OverviewMap'

export type Buckets = {
  dining: PlanCardType[]
  events: PlanCardType[]
}

type Props = {
  buckets: Buckets
  profile: Profile
  scheduledFor: Date
  overrideTags: string[]
  startA: PlaceSelection | null
  startB: PlaceSelection | null
  onBack: () => void
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
  const [tab, setTab] = useState<Tab>('dining')
  const [filter, setFilter] = useState<Filter>('all')
  const [shortlist, setShortlist] = useState<Set<string>>(new Set())

  // Hydrate shortlist from localStorage once on mount.
  useEffect(() => {
    setShortlist(new Set(loadShortlist()))
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

  const defaultMode: TransitMode =
    profile.transit_pref === 'mrt' ? 'transit' : 'drive'
  const totalCards = buckets.dining.length + buckets.events.length
  const plannerLabel = profile.planner_name?.trim() || 'You'
  const partnerLabel = profile.partner_name?.trim() || 'Partner'

  const allCards = useMemo(
    () => [...buckets.dining, ...buckets.events],
    [buckets.dining, buckets.events]
  )

  function confirmBooking(card: PlanCardType) {
    setBooking(null)
    setShared(card)
    window.open(bookingUrl(card), '_blank', 'noopener,noreferrer')
  }

  const tabCards = tab === 'dining' ? buckets.dining : buckets.events
  const activeCards = useMemo(() => applyFilter(tabCards, filter, shortlist), [tabCards, filter, shortlist])
  const featuredCards = useMemo(() => selectFeatured(tabCards), [tabCards])
  const shortlistCount = useMemo(
    () => allCards.filter((c) => shortlist.has(c.id)).length,
    [allCards, shortlist]
  )

  return (
    <div className="space-y-5">
      <header>
        <button onClick={onBack} className="text-sm text-stone-500 hover:text-stone-800">
          ← New search
        </button>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {totalCards === 0 ? 'Nothing fits this slot.' : 'Here’s what we found.'}
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
          {startA && startB && ' · midway between you both'}
          {!startA && !startB && ' · islandwide'}
        </p>
      </header>

      {totalCards > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CategoryTabs
              active={tab}
              onChange={setTab}
              counts={{ dining: buckets.dining.length, events: buckets.events.length }}
            />
            <div
              className="inline-flex rounded-full bg-stone-100 p-1 ring-1 ring-stone-200"
              role="tablist"
              aria-label="Results view"
            >
              <ViewTab active={view === 'list'} onClick={() => setView('list')} label="List" />
              <ViewTab active={view === 'map'} onClick={() => setView('map')} label="Map" />
            </div>
          </div>

          {view === 'list' && featuredCards.length > 0 && (
            <section
              aria-label="What's new and trending"
              className="border-t border-stone-200 pt-5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold tracking-tight">
                  What&rsquo;s new &amp; trending
                </h2>
                <span className="hidden text-xs text-stone-500 sm:inline">
                  {tab === 'dining'
                    ? 'Spotted by SG food blogs · trending this week'
                    : 'Trending this week'}
                </span>
              </div>
              <div className="mt-3 -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:px-0 lg:grid-cols-3 [&::-webkit-scrollbar]:hidden">
                {featuredCards.map((c) => (
                  <div
                    key={`featured-${c.id}`}
                    className="w-72 flex-shrink-0 md:w-auto"
                  >
                    <PlanCard
                      card={c}
                      profile={profile}
                      defaultMode={defaultMode}
                      plannerLabel={plannerLabel}
                      partnerLabel={partnerLabel}
                      shortlisted={shortlist.has(c.id)}
                      startA={startA ? { lat: startA.lat, lng: startA.lng } : null}
                      startB={startB ? { lat: startB.lat, lng: startB.lng } : null}
                      scheduledFor={scheduledFor}
                      onBook={(card) => setBooking(card)}
                      onOpenDetails={(card) => setDetails(card)}
                      onShare={(card) => setShared(card)}
                      onToggleShortlist={toggleShortlist}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {view === 'list' && (
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
                      <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${on ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700'}`}>
                        {shortlistCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {totalCards === 0 && (
        <div className="rounded-2xl bg-white p-6 ring-1 ring-stone-200">
          <h3 className="text-base font-semibold tracking-tight">Nothing matched your slot.</h3>
          <p className="mt-1 text-sm text-stone-600">
            A few things to try:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
            <li>Pick a later evening or push the time by an hour or two</li>
            <li>Skip the start points to search islandwide</li>
            <li>Loosen any cuisine or dietary filters in your profile</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800"
            >
              Edit search
            </button>
          </div>
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
        <div>
          {activeCards.length === 0 ? (
            <FilterEmptyState
              tab={tab}
              filter={filter}
              otherTabHasContent={
                (tab === 'dining' ? buckets.events.length : buckets.dining.length) > 0
              }
              onClearFilter={() => setFilter('all')}
              onSwitchTab={() => setTab(tab === 'dining' ? 'events' : 'dining')}
            />
          ) : (
            <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:grid-cols-3">
              {activeCards.map((c) => (
                <PlanCard
                  key={c.id}
                  card={c}
                  profile={profile}
                  defaultMode={defaultMode}
                  plannerLabel={plannerLabel}
                  partnerLabel={partnerLabel}
                  shortlisted={shortlist.has(c.id)}
                  startA={startA ? { lat: startA.lat, lng: startA.lng } : null}
                  startB={startB ? { lat: startB.lat, lng: startB.lng } : null}
                  scheduledFor={scheduledFor}
                  onBook={(card) => setBooking(card)}
                  onOpenDetails={(card) => setDetails(card)}
                  onShare={(card) => setShared(card)}
                  onToggleShortlist={toggleShortlist}
                />
              ))}
            </div>
          )}
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
          startA={startA ?? undefined}
          startB={startB ?? undefined}
          scheduledFor={scheduledFor}
          allCards={allCards}
          shortlisted={shortlist.has(details.id)}
          onSelectCrossRec={(card) => setDetails(card)}
          onBook={(card) => {
            setDetails(null)
            setBooking(card)
          }}
          onShare={(card) => setShared(card)}
          onToggleShortlist={toggleShortlist}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  )
}

// Editorial strip: blog-discovered new openings (badge='soft_launch') + Reddit /
// shortlist-velocity trending. Capped to 3, soft-launch boosted so blog finds
// surface alongside high-trending venues.
function selectFeatured(cards: PlanCardType[]): PlanCardType[] {
  const eligible = cards.filter(
    (c) => c.badge === 'soft_launch' || c.trending_score >= 0.7
  )
  return eligible
    .slice()
    .sort((a, b) => {
      const sa = a.trending_score + (a.badge === 'soft_launch' ? 0.5 : 0)
      const sb = b.trending_score + (b.badge === 'soft_launch' ? 0.5 : 0)
      return sb - sa
    })
    .slice(0, 3)
}

function applyFilter(cards: PlanCardType[], filter: Filter, shortlist: Set<string>): PlanCardType[] {
  switch (filter) {
    case 'all':
      return cards
    case 'recommended':
      return cards.filter((c) => c.badge === 'critic_pick' || c.badge === 'award_fresh' || c.trending_score >= 0.7)
    case 'limited':
      return cards.filter((c) => c.badge === 'closing_soon')
    case 'new':
      return cards.filter((c) => c.badge === 'soft_launch')
    case 'shortlist':
      return cards.filter((c) => shortlist.has(c.id))
  }
}

function emptyHeadlineForFilter(tab: Tab, filter: Filter): { headline: string; body: string } {
  if (filter === 'shortlist') {
    return {
      headline: 'Nothing saved yet.',
      body: 'Tap the ☆ on any card to keep it here for later.',
    }
  }
  if (filter === 'limited') {
    return {
      headline: 'No limited-run picks for this slot.',
      body: 'Closing-soon pop-ups in this category aren’t open at this time.',
    }
  }
  if (filter === 'new') {
    return {
      headline: 'No just-opened picks for this slot.',
      body: 'Recently-opened spots in this category aren’t open at this time.',
    }
  }
  if (filter === 'recommended') {
    return {
      headline: 'No critic or award picks for this slot.',
      body: 'Try “All” to see every option, or switch tabs.',
    }
  }
  return tab === 'dining'
    ? {
        headline: 'No dining at this time.',
        body: 'Try the Events tab, or pick a slightly different time.',
      }
    : {
        headline: 'No events at this time.',
        body: 'Try the Dining tab, or pick another evening.',
      }
}

function FilterEmptyState({
  tab,
  filter,
  otherTabHasContent,
  onClearFilter,
  onSwitchTab,
}: {
  tab: Tab
  filter: Filter
  otherTabHasContent: boolean
  onClearFilter: () => void
  onSwitchTab: () => void
}) {
  const { headline, body } = emptyHeadlineForFilter(tab, filter)
  const otherTabLabel = tab === 'dining' ? 'Events' : 'Dining'
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-stone-200">
      <h3 className="text-sm font-semibold tracking-tight text-stone-900">{headline}</h3>
      <p className="mt-1 text-sm text-stone-600">{body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {filter !== 'all' && (
          <button
            type="button"
            onClick={onClearFilter}
            className="rounded-full bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800"
          >
            Show all in this tab
          </button>
        )}
        {otherTabHasContent && (
          <button
            type="button"
            onClick={onSwitchTab}
            className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
          >
            Switch to {otherTabLabel}
          </button>
        )}
      </div>
    </div>
  )
}

function CategoryTabs({
  active,
  onChange,
  counts,
}: {
  active: Tab
  onChange: (t: Tab) => void
  counts: Record<Tab, number>
}) {
  return (
    <div
      role="tablist"
      aria-label="Result category"
      className="inline-flex rounded-full bg-stone-100 p-1 ring-1 ring-stone-200"
    >
      {TABS.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
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
              {counts[t.key]}
            </span>
          </button>
        )
      })}
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
