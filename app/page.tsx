'use client'

import { useEffect, useState } from 'react'
import { PlanDateForm } from '@/components/PlanDateForm'
import { RecommendationsFeed } from '@/components/RecommendationsFeed'
import { ResultsView, type Buckets } from '@/components/ResultsView'
import type { ChatTurn, RefineResult } from '@/components/RefineBar'
import type { PlaceSelection } from '@/components/PlaceSearchInput'
import type { PlanRequest } from '@/lib/planner/request-validation'
import {
  emptyProfile,
  loadLastStarts,
  loadStoredProfile,
  saveLastStarts,
  saveStoredProfile,
  type StoredProfile,
} from '@/lib/profile-storage'
import { loadShortlist } from '@/lib/shortlist-storage'
import type { LatLng } from '@/lib/planner/types'

type Diagnostics = {
  candidatesTotal: number
  afterLocalFilters: number
  relaxationAttempted: boolean
  startsProvided: 0 | 1 | 2
}

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
      weather: { condition: 'clear' | 'rain'; text: string | null } | null
      outdoorExcluded: number
      diagnostics: Diagnostics
      // The request these results came from — fed to the refine loop (F1).
      request: PlanRequest
      chat: ChatTurn[]
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
    freeform: string
  }) {
    if (!stored) return
    // Only persist when both are provided — partial saves would clobber a
    // previous full pair on the next return visit.
    if (payload.startADetails && payload.startBDetails) {
      saveLastStarts(payload.startADetails, payload.startBDetails)
      setLastStarts({ a: payload.startADetails, b: payload.startBDetails })
    }
    setStage({ kind: 'loading' })

    // Triage step: if the user typed a free-text description, ask the LLM
    // to extract structured slots before we hit the planner. Triage carries
    // its own timeout + graceful fallback in the route handler, so a
    // failure here cleanly degrades to "submit what the form gave us."
    let mergedProfile = stored.profile
    let mergedStartA: LatLng | null = payload.start_a
    let mergedStartB: LatLng | null = payload.start_b
    let mergedOverrides = payload.override_tags
    if (payload.freeform) {
      try {
        const tRes = await fetch('/api/plan/triage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            freeform: payload.freeform,
            partial: {
              profile: stored.profile,
              start_a: payload.start_a,
              start_b: payload.start_b,
              override_tags: payload.override_tags,
            },
          }),
        })
        if (tRes.ok) {
          const tData = (await tRes.json()) as {
            profile?: typeof stored.profile
            start_a?: LatLng | null
            start_b?: LatLng | null
            override_tags?: string[]
          }
          if (tData.profile) mergedProfile = tData.profile
          if (tData.start_a) mergedStartA = tData.start_a
          if (tData.start_b) mergedStartB = tData.start_b
          if (tData.override_tags) mergedOverrides = tData.override_tags
        }
      } catch (err) {
        console.warn('triage failed, falling back to form values', err)
      }
    }

    const planRequest: PlanRequest = {
      start_a: mergedStartA,
      start_b: mergedStartB,
      scheduled_for: payload.scheduled_for,
      override_tags: mergedOverrides,
      profile: mergedProfile,
      shortlist_ids: loadShortlist(),
    }

    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(planRequest),
      })
      if (!res.ok) {
        // Server messages can include sensitive config detail (env-var names,
        // file paths, internal credentials text). Log the real response for
        // developers; show users a generic, actionable message.
        const detail = await res.text().catch(() => '')
        console.error(`/api/plan ${res.status}:`, detail)
        throw new Error(
          "We couldn't put together a plan right now. Please try again in a moment."
        )
      }
      const data = (await res.json()) as {
        buckets: Buckets
        meta?: {
          weather?: { condition: 'clear' | 'rain'; text: string | null } | null
          outdoor_excluded?: number
          candidates_total?: number
          after_local_filters?: number
          starts_provided?: number
          agent_relaxation?: unknown[]
        }
      }
      const startsProvided = (mergedStartA ? 1 : 0) + (mergedStartB ? 1 : 0)
      setStage({
        kind: 'results',
        buckets: data.buckets ?? { dining: [], events: [] },
        scheduledFor: new Date(payload.scheduled_for),
        overrideTags: payload.override_tags,
        startA: payload.startADetails,
        startB: payload.startBDetails,
        weather: data.meta?.weather ?? null,
        outdoorExcluded: data.meta?.outdoor_excluded ?? 0,
        diagnostics: {
          candidatesTotal: data.meta?.candidates_total ?? 0,
          afterLocalFilters: data.meta?.after_local_filters ?? 0,
          relaxationAttempted: (data.meta?.agent_relaxation?.length ?? 0) > 0,
          startsProvided: (data.meta?.starts_provided ?? startsProvided) as 0 | 1 | 2,
        },
        request: planRequest,
        chat: [],
      })
    } catch (err) {
      setStage({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  // Conversational refine (F1): swap in the agent's updated buckets/request and
  // append the exchange to the chat thread. scheduled_for may have changed, so
  // re-derive the display date from the returned request.
  function handleRefined(userMessage: string, result: RefineResult) {
    setStage((prev) => {
      if (prev.kind !== 'results') return prev
      return {
        ...prev,
        buckets: result.buckets ?? prev.buckets,
        request: result.request ?? prev.request,
        scheduledFor: result.request?.scheduled_for
          ? new Date(result.request.scheduled_for)
          : prev.scheduledFor,
        chat: [
          ...prev.chat,
          { role: 'user', text: userMessage },
          { role: 'assistant', text: result.assistantMessage },
        ],
      }
    })
  }

  return (
    <main className="gabo-bg flex min-h-screen w-full flex-col items-center px-4 py-8 md:px-8 md:py-12">
      {!hydrated && (
        <div className="w-full max-w-md">
          <SkeletonCard />
        </div>
      )}
      {hydrated && stage.kind === 'form' && stored && (
        <div className="flex w-full max-w-md flex-col gap-12 md:max-w-3xl lg:max-w-5xl lg:gap-16">
          <PlanDateForm
            onSubmit={handlePlan}
            defaultStartA={lastStarts.a}
            defaultStartB={lastStarts.b}
            plannerName={stored.profile.planner_name}
            partnerName={stored.profile.partner_name}
          />
          <RecommendationsFeed profile={stored.profile} />
        </div>
      )}
      {hydrated && stage.kind === 'loading' && (
        <div className="w-full max-w-md">
          <LoadingCard />
        </div>
      )}
      {hydrated && stage.kind === 'results' && stored && (
        <div className="w-full max-w-md md:max-w-4xl lg:max-w-6xl">
          <ResultsView
            buckets={stage.buckets}
            profile={stored.profile}
            scheduledFor={stage.scheduledFor}
            overrideTags={stage.overrideTags}
            startA={stage.startA}
            startB={stage.startB}
            weather={stage.weather}
            outdoorExcluded={stage.outdoorExcluded}
            diagnostics={stage.diagnostics}
            onBack={() => setStage({ kind: 'form' })}
            request={stage.request}
            chat={stage.chat}
            onRefined={handleRefined}
          />
        </div>
      )}
      {hydrated && stage.kind === 'error' && (
        <div className="w-full max-w-md">
          <ErrorCard message={stage.message} onBack={() => setStage({ kind: 'form' })} />
        </div>
      )}
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
