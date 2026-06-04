'use client'

import { useEffect, useState } from 'react'
import { PlanDateForm, type PlanQualityPatch } from '@/components/PlanDateForm'
import { RecommendationsFeed } from '@/components/RecommendationsFeed'
import { ResultsView, type Buckets } from '@/components/ResultsView'
import { ChatPanel } from '@/components/ChatPanel'
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
import {
  computeTasteAffinity,
  enrichProfileWithTaste,
  loadTasteEvents,
  tasteNarrationPayload,
  tasteSummary,
} from '@/lib/taste-memory'
import type { LatLng, Profile } from '@/lib/planner/types'
import { agenticFlag } from '@/lib/agentic-flags'

const TASTE_ENABLED = agenticFlag(process.env.NEXT_PUBLIC_AGENTIC_TASTE_ENABLED)
// LLM-narrated hint (F5 flesh-out). When off, the hint stays the deterministic
// templated summary and nothing leaves the device.
const TASTE_NARRATE_ENABLED =
  agenticFlag(process.env.NEXT_PUBLIC_AGENTIC_TASTE_NARRATE_ENABLED)
const CHAT_ENABLED = agenticFlag(process.env.NEXT_PUBLIC_AGENTIC_CHAT_ENABLED)

type Diagnostics = {
  candidatesTotal: number
  afterLocalFilters: number
  relaxationAttempted: boolean
  startsProvided: 0 | 1 | 2
}

type Stage =
  | { kind: 'form' }
  | { kind: 'chat' }
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
    profilePatch: PlanQualityPatch
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
    let mergedProfile = mergeProfilePatch(stored.profile, payload.profilePatch)
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
              profile: mergedProfile,
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

    // F5: enrich the profile with recency-weighted taste learned from saves
    // (client-only, gated). Additive — never overrides explicit preferences.
    const finalProfile = TASTE_ENABLED
      ? enrichProfileWithTaste(mergedProfile, loadTasteEvents(), Date.now())
      : mergedProfile

    const planRequest: PlanRequest = {
      start_a: mergedStartA,
      start_b: mergedStartB,
      scheduled_for: payload.scheduled_for,
      override_tags: mergedOverrides,
      profile: finalProfile,
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
        overrideTags: mergedOverrides,
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

  // Chat-first intake (F1): the conversation produced a plan — transition to the
  // results stage carrying the request + buckets + the chat thread so the refine
  // bar continues the same conversation.
  function handleChatPlanned(request: PlanRequest, buckets: Buckets, chat: ChatTurn[]) {
    const toSel = (p: LatLng | null, label: string): PlaceSelection | null =>
      p ? { label, address: '', lat: p.lat, lng: p.lng } : null
    const startsProvided = ((request.start_a ? 1 : 0) + (request.start_b ? 1 : 0)) as 0 | 1 | 2
    setStage({
      kind: 'results',
      buckets,
      scheduledFor: new Date(request.scheduled_for),
      overrideTags: request.override_tags,
      startA: toSel(request.start_a, 'You'),
      startB: toSel(request.start_b, 'Partner'),
      weather: null,
      outdoorExcluded: 0,
      diagnostics: {
        candidatesTotal: 0,
        afterLocalFilters: 0,
        relaxationAttempted: false,
        startsProvided,
      },
      request,
      chat,
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
          {TASTE_ENABLED && <TasteHint />}
          <PlanDateForm
            onSubmit={handlePlan}
            defaultStartA={lastStarts.a}
            defaultStartB={lastStarts.b}
            plannerName={stored.profile.planner_name}
            partnerName={stored.profile.partner_name}
          />
          {CHAT_ENABLED && (
            <button
              onClick={() => setStage({ kind: 'chat' })}
              className="-mt-6 self-start text-sm font-medium text-stone-500 hover:text-stone-800"
            >
              💬 Or plan by chat →
            </button>
          )}
          <RecommendationsFeed profile={stored.profile} />
        </div>
      )}
      {hydrated && stage.kind === 'chat' && stored && (
        <div className="w-full max-w-md md:max-w-2xl">
          <ChatPanel
            initialDraft={{
              start_a: null,
              start_b: null,
              scheduled_for: '',
              override_tags: [],
              profile: stored.profile,
              shortlist_ids: loadShortlist(),
            }}
            onPlanned={handleChatPlanned}
            onBack={() => setStage({ kind: 'form' })}
          />
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

function mergeProfilePatch(profile: Profile, patch: PlanQualityPatch): Profile {
  const avoided = new Set([...profile.cuisines_avoided, ...patch.cuisines_avoided])
  const loved = [...profile.cuisines_loved, ...patch.cuisines_loved].filter((c) => !avoided.has(c))

  return {
    ...profile,
    cuisines_loved: [...new Set(loved)],
    cuisines_avoided: [...avoided],
    vibe_defaults: [...new Set([...profile.vibe_defaults, ...patch.vibe_defaults])],
    budget_bands: [...new Set([...profile.budget_bands, ...patch.budget_bands])],
  }
}

// F5: explainable taste hint. Reads the local taste log (client-only; this
// block renders post-hydration so there's no SSR mismatch) and shows the
// inferred leaning. Renders nothing below the signal floor.
//
// The deterministic templated summary shows immediately. When the narrate flag
// is on, we then ask the LLM (server-side, over the aggregated tags only) for a
// warmer line and swap it in if it returns — so the hint never blocks on the
// network and degrades cleanly to the template.
function TasteHint() {
  const [summary, setSummary] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      const aff = computeTasteAffinity(loadTasteEvents(), Date.now())
      const templated = tasteSummary(aff)
      setSummary(templated)
      if (!templated || !TASTE_NARRATE_ENABLED) return

      const payload = tasteNarrationPayload(aff)
      if (!payload) return

      fetch('/api/taste/narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { narration?: string | null } | null) => {
          if (!cancelled && data?.narration) setSummary(data.narration)
        })
        .catch(() => {
          /* keep the templated summary */
        })
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!summary) return null
  return (
    <div className="flex items-center gap-2 self-start rounded-full bg-white px-3 py-1.5 text-xs text-stone-600 ring-1 ring-stone-200">
      <span aria-hidden="true">✨</span>
      <span>{summary}</span>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="h-40 w-full animate-pulse rounded-2xl bg-white/70 ring-1 ring-stone-200" />
  )
}

const LOADING_STEPS = [
  "Checking what's open…",
  'Matching your taste…',
  'Curating your night out…',
]

function LoadingCard() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1))
    }, 1800)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-10 ring-1 ring-stone-200">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-rose-200 border-t-rose-600" />
      <p className="text-sm text-stone-600 transition-all duration-300">{LOADING_STEPS[step]}</p>
    </div>
  )
}

function ErrorCard({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="rounded-2xl bg-white p-6 ring-1 ring-rose-200">
      <h2 className="mb-2 font-semibold text-rose-700">That didn&apos;t work</h2>
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
