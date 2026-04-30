'use client'

import { useEffect, useState } from 'react'
import type { PlanCard as PlanCardType, Profile, TransitMode } from '@/lib/planner/types'
import { isEvent } from '@/lib/planner/category'
import { loadShortlist, saveShortlist } from '@/lib/shortlist-storage'
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

const SECTIONS: { key: keyof Recommendations; title: string; subtitle: string; icon: string }[] = [
  {
    key: 'limited',
    title: 'Catch before it ends',
    subtitle: 'Pop-ups closing in the next two weeks.',
    icon: '⏳',
  },
  {
    key: 'new',
    title: 'Just opened',
    subtitle: 'Fresh on the scene — go before everyone else does.',
    icon: '✨',
  },
  {
    key: 'trending',
    title: 'Trending this week',
    subtitle: 'Buzzy spots and critic picks across the island.',
    icon: '🔥',
  },
]

// Pre-search recommendations rendered on the home / form view. No ETAs since
// no start points exist yet — cards skip the FairnessPill automatically.
export function RecommendationsFeed({ profile }: Props) {
  const [recs, setRecs] = useState<Recommendations | null>(null)
  const [error, setError] = useState<string | null>(null)
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
      if (next.has(card.id)) next.delete(card.id)
      else next.add(card.id)
      saveShortlist([...next])
      return next
    })
  }

  if (error) return null
  if (!recs) {
    return (
      <div className="space-y-4">
        {SECTIONS.map((s) => (
          <div key={s.key} className="space-y-2">
            <div className="h-5 w-40 animate-pulse rounded bg-stone-200" />
            <div className="-mx-4 flex gap-3 overflow-hidden px-4">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-64 w-[84vw] max-w-[320px] flex-shrink-0 animate-pulse rounded-2xl bg-white/60 ring-1 ring-stone-200"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const allCards = [...recs.limited, ...recs.new, ...recs.trending]
  const allHaveZeroResults = allCards.length === 0
  if (allHaveZeroResults) return null

  const defaultMode: TransitMode = profile.transit_pref === 'mrt' ? 'transit' : 'drive'
  const plannerLabel = profile.planner_name?.trim() || 'You'
  const partnerLabel = profile.partner_name?.trim() || 'Partner'

  return (
    <div className="space-y-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">This week in Singapore</h2>
          <p className="text-xs text-stone-500">
            Tap a card to see details, or run a search above to plan around a specific time.
          </p>
        </div>
      </div>

      {SECTIONS.map((section) => {
        const cards = recs[section.key]
        if (cards.length === 0) return null
        return (
          <section key={section.key}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <span aria-hidden="true">{section.icon}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight">{section.title}</h3>
                <p className="text-xs text-stone-500">{section.subtitle}</p>
              </div>
            </div>
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:snap-none md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="w-[84vw] max-w-[320px] flex-shrink-0 snap-start md:w-auto md:max-w-none md:flex-shrink"
                >
                  <PlanCard
                    card={card}
                    profile={profile}
                    defaultMode={defaultMode}
                    plannerLabel={plannerLabel}
                    partnerLabel={partnerLabel}
                    shortlisted={shortlist.has(card.id)}
                    onBook={() => {
                      // No booking flow on the home view — open details instead.
                      setDetails(card)
                    }}
                    onOpenDetails={(c) => setDetails(c)}
                    onShare={(c) => setShared(c)}
                    onToggleShortlist={toggleShortlist}
                  />
                </div>
              ))}
            </div>
          </section>
        )
      })}

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
            // Reuse share flow for "Get tickets / Reserve" from the home view —
            // there's no scheduledFor here yet, so we just hand off the link.
            setDetails(null)
            if (details.chope_url) window.open(details.chope_url, '_blank', 'noopener,noreferrer')
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

// Suppress an unused import in environments that strip it.
void isEvent
