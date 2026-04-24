'use client'

import { useEffect, useState } from 'react'
import { PlanDateForm } from '@/components/PlanDateForm'
import { ResultsView, type Buckets } from '@/components/ResultsView'
import { OnboardingQuiz, type OnboardingResult } from '@/components/OnboardingQuiz'
import type { PlaceSelection } from '@/components/PlaceSearchInput'
import {
  clearStoredProfile,
  loadLastStarts,
  loadStoredProfile,
  saveLastStarts,
  saveStoredProfile,
  type StoredProfile,
} from '@/lib/profile-storage'
import type { LatLng } from '@/lib/planner/types'

type Stage =
  | { kind: 'onboarding' }
  | { kind: 'form' }
  | { kind: 'loading' }
  | {
      kind: 'results'
      buckets: Buckets
      scheduledFor: Date
      overrideTags: string[]
      startA: PlaceSelection
      startB: PlaceSelection
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
      const profile = loadStoredProfile()
      const starts = loadLastStarts()
      setStored(profile)
      setLastStarts({ a: starts?.start_a ?? null, b: starts?.start_b ?? null })
      setStage(profile ? { kind: 'form' } : { kind: 'onboarding' })
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function handleOnboardingComplete(result: OnboardingResult) {
    saveStoredProfile(result.profile)
    setStored({ profile: result.profile, saved_at: new Date().toISOString() })
    setStage({ kind: 'form' })
  }

  function handleEditProfile() {
    clearStoredProfile()
    setStored(null)
    setStage({ kind: 'onboarding' })
  }

  async function handlePlan(payload: {
    start_a: LatLng
    start_b: LatLng
    scheduled_for: string
    override_tags: string[]
    startADetails: PlaceSelection
    startBDetails: PlaceSelection
  }) {
    if (!stored) return
    // Persist last-used start points so next visit pre-fills them.
    saveLastStarts(payload.startADetails, payload.startBDetails)
    setLastStarts({ a: payload.startADetails, b: payload.startBDetails })
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
        buckets: data.buckets ?? { safe: [], stretch: [], wild: [] },
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
    <main className="gabo-bg flex min-h-screen w-full justify-center px-4 py-8">
      <div className="flex w-full max-w-md flex-col">
        {!hydrated && <SkeletonCard />}
        {hydrated && stage.kind === 'onboarding' && (
          <OnboardingQuiz onComplete={handleOnboardingComplete} />
        )}
        {hydrated && stage.kind === 'form' && stored && (
          <PlanDateForm
            onSubmit={handlePlan}
            defaultStartA={lastStarts.a}
            defaultStartB={lastStarts.b}
            plannerName={stored.profile.planner_name}
            partnerName={stored.profile.partner_name}
            onEditProfile={handleEditProfile}
          />
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
      <p className="text-sm text-stone-600">Finding spots fair to both commutes…</p>
    </div>
  )
}

function ErrorCard({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="rounded-2xl bg-white p-6 ring-1 ring-rose-200">
      <h2 className="mb-2 font-semibold text-rose-700">Something went wrong</h2>
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
