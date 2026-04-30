'use client'

import { useEffect, useState } from 'react'
import { PlanDateForm } from '@/components/PlanDateForm'
import { RecommendationsFeed } from '@/components/RecommendationsFeed'
import { ResultsView, type Buckets } from '@/components/ResultsView'
import type { PlaceSelection } from '@/components/PlaceSearchInput'
import {
  emptyProfile,
  loadLastStarts,
  loadStoredProfile,
  saveLastStarts,
  saveStoredProfile,
  type StoredProfile,
} from '@/lib/profile-storage'
import type { LatLng } from '@/lib/planner/types'

type Stage =
  | { kind: 'form' }
  | { kind: 'loading' }
  | {
      kind: 'results'
      buckets: Buckets
      scheduledFor: Date
      overrideTags: string[]
      startA: PlaceSelection | null
      startB: PlaceSelection | null
    }
  | { kind: 'error'; message: string }

export default function Home() {
  const [hydrated, setHydrated] = useState(false)
  const [stored, setStored] = useState<StoredProfile | null>(null)
  const [lastStarts, setLastStarts] = useState<{ a: PlaceSelection | null; b: PlaceSelection | null }>({
    a: null,
    b: null,
  })
  const [stage, setStage] = useState<Stage>({ kind: 'form' })

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      // Auto-seed an empty profile on first visit. Preferences live in filter
      // chips on the results page now; no onboarding gate.
      const existing = loadStoredProfile()
      const profile =
        existing ?? { profile: emptyProfile(), saved_at: new Date().toISOString() }
      if (!existing) saveStoredProfile(profile.profile)
      const starts = loadLastStarts()
      setStored(profile)
      setLastStarts({ a: starts?.start_a ?? null, b: starts?.start_b ?? null })
      setStage({ kind: 'form' })
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handlePlan(payload: {
    start_a: LatLng | null
    start_b: LatLng | null
    scheduled_for: string
    override_tags: string[]
    startADetails: PlaceSelection | null
    startBDetails: PlaceSelection | null
  }) {
    if (!stored) return
    // Only persist when both are provided — partial saves would clobber a
    // previous full pair on the next return visit.
    if (payload.startADetails && payload.startBDetails) {
      saveLastStarts(payload.startADetails, payload.startBDetails)
      setLastStarts({ a: payload.startADetails, b: payload.startBDetails })
    }
    setStage({ kind: 'loading' })
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_a: payload.start_a,
          start_b: payload.start_b,
          scheduled_for: payload.scheduled_for,
          override_tags: payload.override_tags,
          profile: stored.profile,
        }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(detail || `Request failed (${res.status})`)
      }
      const data = (await res.json()) as { buckets: Buckets }
      setStage({
        kind: 'results',
        buckets: data.buckets ?? { dining: [], events: [] },
        scheduledFor: new Date(payload.scheduled_for),
        overrideTags: payload.override_tags,
        startA: payload.startADetails,
        startB: payload.startBDetails,
      })
    } catch (err) {
      setStage({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return (
    <main className="gabo-bg flex min-h-screen w-full justify-center px-4 py-8 md:px-8 md:py-12">
      <div className="flex w-full max-w-md flex-col md:max-w-4xl lg:max-w-6xl">
        {!hydrated && <SkeletonCard />}
        {hydrated && stage.kind === 'form' && stored && (
          <div className="space-y-10 lg:grid lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start lg:gap-10 lg:space-y-0">
            <div className="mx-auto w-full max-w-md lg:mx-0 lg:sticky lg:top-12">
              <PlanDateForm
                onSubmit={handlePlan}
                defaultStartA={lastStarts.a}
                defaultStartB={lastStarts.b}
                plannerName={stored.profile.planner_name}
                partnerName={stored.profile.partner_name}
              />
            </div>
            <div>
              <RecommendationsFeed profile={stored.profile} />
            </div>
          </div>
        )}
        {hydrated && stage.kind === 'loading' && <LoadingCard />}
        {hydrated && stage.kind === 'results' && stored && (
          <ResultsView
            buckets={stage.buckets}
            profile={stored.profile}
            scheduledFor={stage.scheduledFor}
            overrideTags={stage.overrideTags}
            startA={stage.startA}
            startB={stage.startB}
            onBack={() => setStage({ kind: 'form' })}
          />
        )}
        {hydrated && stage.kind === 'error' && (
          <ErrorCard message={stage.message} onBack={() => setStage({ kind: 'form' })} />
        )}
      </div>
    </main>
  )
}

function SkeletonCard() {
  return (
    <div className="h-40 w-full animate-pulse rounded-2xl bg-white/70 ring-1 ring-stone-200" />
  )
}

function LoadingCard() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-10 ring-1 ring-stone-200">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-rose-200 border-t-rose-600" />
      <p className="text-sm text-stone-600">Curating your night out…</p>
    </div>
  )
}

function ErrorCard({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="rounded-2xl bg-white p-6 ring-1 ring-rose-200">
      <h2 className="mb-2 font-semibold text-rose-700">That didn’t work</h2>
      <p className="mb-4 text-sm text-stone-600">{message}</p>
      <button
        onClick={onBack}
        className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700"
      >
        Try again
      </button>
    </div>
  )
}
