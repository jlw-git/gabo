# Gabo — Architecture, Decisions & Features

> Engineering-facing overview of how Gabo works *as built*. Complements the
> product spec ([Gabo_prd.md](Gabo_prd.md)), the forward-looking design tracker
> ([AGENTIC_ROADMAP.md](AGENTIC_ROADMAP.md)), and dev gotchas ([CLAUDE.md](CLAUDE.md)).
> Last updated: 2026-06-03.

Gabo is a 60-second date-night planner for dual-income Singapore couples. It
finds a place to eat plus an activity after, balanced so each partner's commute
feels fair, with fresh/limited-run spots surfaced alongside the usual suspects.

---

## 1. The thesis

**Gabo is a deterministic planner with LLM help at the seams — not an agentic
system, despite the `lib/agents/` folder name.** The decision a user actually
sees — *which* venues appear, *in what order*, whether an evening is *feasible* —
is pure rules-based code: auditable, fast, reproducible. LLMs (all Gemini; no
Claude in the runtime yet) are confined to the seams where the input is
unstructured prose or the output is human-facing copy.

The single load-bearing principle, applied to every feature:

> **The user-visible decision stays deterministic.** An LLM may interpret intent,
> argue, suggest a reorder, or write a sentence — but a pure function decides the
> consequence. (Mirrors the tolerance-band ranker's clamp: the model suggests, a
> `±3` clamp decides.)

---

## 2. System architecture

Three layers plus a data store.

### 2.1 Frontend — `app/page.tsx`
A single-page state machine (`form → loading → results → error`), no client-side
AI in the base app. On submit it optionally calls `/api/plan/triage` (freeform
intent → slots), then `POST /api/plan`, and renders `ResultsView` (tabs, filter
chips, list / map / **✨ Evening** views). Profile, shortlist, last-starts, and
taste history persist to `localStorage` (no auth in v1).

### 2.2 Per-request plan pipeline — `lib/planner/plan-date.ts`
Almost entirely deterministic:

1. Validate request (`request-validation.ts`)
2. Load weather (NEA) + venue catalog (Supabase)
3. **Enrich profile** — `applyShortlistAffinity` (server) + F5 taste enrichment (client, pre-request)
4. Hard-filter (hours/PH-aware, dietary, weather × outdoor, budget, run-window)
5. Prescore → cap to 24 candidates (`score.ts`)
6. OneMap drive routing (5-way parallel, 1h cache) + weighted scoring (fairness / match / freshness / friction)
7. Bucket by category, dedup (~220 m + normalized name), ETA-cap 60 min, cap 6/category
8. *(flagged)* deterministic relaxation pre-pass → optional LLM relaxation → optional tolerance-band rerank
9. Per-venue "why" copy (Gemini, timeout-guarded, non-blocking)

### 2.3 Ingestion / cron layer (Vercel Cron)
Seven jobs write the catalog with per-row `source` / `source_url` provenance:
`trending` (Reddit + shortlist velocity), `sync-dining` (Google Places →
Foursquare), `sync-eatbook`, `sync-events`, `sync-museums` (Gemini + Search),
`sync-blogs` (editorial scanner), `verify-freshness` (Gemini + Search). Some use
an LLM for extraction/verification; the rest are pure API/scraping.

### 2.4 Data layer
Supabase Postgres + RLS (public read on `venues`, insert-only on
`shortlist_events`). OneMap powers POI search + drive/transit routing
(`lib/onemap/client.ts`, token cached + 401-refreshed). Maps via MapLibre +
OpenStreetMap raster tiles.

### 2.5 Where the agentic features live

| Feature | Layer | LLM? |
|---|---|---|
| F1 Conversational refine | per-request (`/api/plan/refine`) | Gemini tool-use loop |
| F2 Itinerary composer | per-request, on-demand (`/api/plan/itinerary`) | Gemini select/narrate only; **feasibility deterministic** |
| F3 Booking gate *(scaffold)* | client (BookingOverlay) | none — deterministic tiering |
| F4 Verifier debate *(slice 1)* | cron (blog ingestion) | Gemini proposer + skeptic; **tie-break deterministic** |
| F5 Taste memory | client (localStorage + pre-request enrich) | none — deterministic affinity |

### 2.6 Stack
Next.js 16 (App Router, Turbopack) · TypeScript (strict) · Tailwind v4 · Supabase
· OneMap · MapLibre/OSM · Gemini 2.5 Flash / Flash-Lite. Model tiers centralised
in `lib/agents/models.ts`; every agent call wrapped by `lib/agents/runner.ts`
(observability → `/admin/agents`).

---

## 3. Key decisions

### Cross-cutting

- **Deterministic core, LLM at the seams.** Scoring, hard filters, feasibility,
  keep/drop, action tiers — all pure code. LLMs never decide what the user sees.
  *Why: the fairness math is the product's differentiator; it must be auditable,
  fast, and stable.*
- **Gemini now, Claude-swappable.** Orchestration runs on the existing
  `@google/genai` SDK (no new secret, testable today). `ORCHESTRATION_MODEL` in
  the model registry is the single swap-point for moving to Claude later.
  *Why: velocity + zero key friction now; the registry makes the swap a one-liner.*
- **Latency floor = the fast deterministic plan.** Agents stay off the hot path:
  refine and itinerary are user-triggered, taste enrich is a cheap pre-pass,
  verifier debate is cron-side. *Why: the 60-second promise dies under synchronous agent loops.*
- **Agentic is default-on, flagged + audited.** Agentic surfaces can still be
  disabled with `AGENTIC_*` env flags (server) and/or `NEXT_PUBLIC_AGENTIC_*`
  (client); cron agents log via `recordRun`. *Why: full product by default,
  explicit opt-out for cost/control-sensitive environments.*
- **No simulation, no fixtures.** No fabricated data, no demo-disclosure surfaces,
  no fixture names ("You"/"Partner" fallbacks only). *Why: the product presents as real.*
- **OneMap, post-hackathon.** GrabMaps was retired; OneMap powers all
  routing/search (note: routing coords are `lat,lng`, opposite the old convention).
- **SGT-correct time.** Hours/feasibility evaluated in `Asia/Singapore` via
  `lib/planner/sg-time.ts`, never raw `Date` accessors (Vercel runs UTC).

### Per-feature (locked with the user during build)

| Feature | Decision | Rationale |
|---|---|---|
| **F1** | Refine-*after*-results loop (not chat-first entry) | Smallest surface that removes the form's ceiling; reuses `PlanDateForm` + `ResultsView`. Backend loop reusable for chat-first later. |
| **F1** | Output is a validated `PlanRequest` *patch*; `planDate()` re-runs | Agent changes *inputs*, never *outputs* — scoring stays deterministic. |
| **F2** | On-demand "✨ Evening" view, not auto in `/api/plan` | Keeps the fast plan as the latency floor; pays inter-stop routing + LLM only on click. |
| **F2** | Dinner→activity, 2 stops first | The canonical PRD evening; drinks/dessert/3-stop extend it. |
| **F2** | **Feasibility deterministic**, LLM only picks/narrates | Timing/reachability must be correct; the model can't ship a broken evening. |
| **F4** | Proposer/skeptic debate + **pure tie-break**, starting with blog extraction | Higher precision (skeptic catches more) + recall (proposer rescues borderline → soft_flag). Code owns keep/drop. Reusable for museum/freshness. |
| **F5** | **localStorage-first**, client-side enrich | The `profiles` table is keyed by `auth.users(id)` and there's no auth yet; DB memory is a post-auth follow-up. Enrichment reuses `matchScore` — scoring formula unchanged. |
| **F5** | Recency-weighted (60-day half-life), additive, explainable | Recent/repeated saves dominate; never overrides explicit prefs or `cuisines_avoided`; user sees the "leaning…" hint. |
| **F3** | Build the **HITL safeguard scaffold**, not real booking | No reservation API is integrated and simulation is forbidden — so the gate is real, but "execute" opens the real provider page; **Gabo never books on your behalf.** A real API drops into the `reserve` execute step. |
| **F3** | Action **tiers deterministic** (irreversible / reversible / outward) | Code decides what needs a human gate; confirm the real payload; edit-before-send; audit-logged. |

### Git / delivery
The agentic layer is now a first-class mainline surface. Flags remain as
environment-level opt-outs, but unset flags mean the full Gabo experience is on.

---

## 4. Features

### Live (base app)
- **Planner-first home** — date-first form (When required; two optional OneMap
  start points; special-occasion + freeform disclosures). Weather auto-fetched;
  outdoor venues drop on rain days.
- **Results** — Dining / Events tabs, filter chips (All / Critics' picks /
  Limited-run / Just opened / ★ Shortlist), **List ↔ Map** toggle, per-card
  fairness pill (drive ↔ transit ETA), category-aware Reserve/Get-tickets +
  Directions, real source attribution.
- **Venue detail modal** — hours, badges, profile-match highlights, OSM mini-map
  with both routes, cross-recommendations.
- **Shortlist + trending** — saved venues feed scoring affinity and an anonymous
  velocity signal; trending = Reddit mentions × internal velocity (weekly cron).
- **Handoff** — editable WhatsApp/iMessage share text.

### Agentic (default-on, flag opt-out)
- **F1 · Conversational refine** — "Tweak this plan" on results: *"more romantic,
  less loud"*, *"closer to her side"*, *"cheaper"* → re-planned in place with a
  one-line reply. `AGENTIC_CHAT_ENABLED` + `NEXT_PUBLIC_AGENTIC_CHAT_ENABLED`.
- **F2 · Evening itinerary** — "✨ Evening" view sequencing dinner → activity with
  the travel leg + timing feasibility, shown as a timeline with alternatives.
  `AGENTIC_ITINERARY_ENABLED` + `NEXT_PUBLIC_…`.
- **F3 · Booking concierge (safeguard scaffold)** — confirm-gate with party-size,
  a tiered action plan, real add-to-calendar, edit-before-send handoff, audit
  log; opens the real booking page (never fabricates). `NEXT_PUBLIC_AGENTIC_BOOKING_ENABLED`.
- **F4 · Verifier debate** — blog-extraction verifier upgraded to proposer/skeptic
  + deterministic tie-break for higher catalog precision. `AGENTIC_VERIFIER_DEBATE`.
- **F5 · Taste memory** — recency-weighted taste model from save history enriches
  the plan profile, with an explainable "Leaning …" hint. `NEXT_PUBLIC_AGENTIC_TASTE_ENABLED`.

### Scope honesty
F4 is the verifier-debate *slice* of a larger self-healing-catalog feature
(source discovery, self-heal on HTML change, write-time dedup deferred). F3 is the
*safeguard scaffold* — real autonomous reservation awaits a provider API. See
[AGENTIC_ROADMAP.md](AGENTIC_ROADMAP.md) for status and follow-ups.

---

## 5. Map of the codebase

- `app/page.tsx` — state machine · `app/api/plan/*` — plan, triage, **refine** (F1), **itinerary** (F2)
- `lib/planner/` — `plan-date.ts`, `score.ts`, `hours.ts`, `sg-time.ts`, `category.ts`, `itinerary.ts` (F2)
- `lib/agents/` — `runner.ts` (generateJson / generateWithTools / verify / **debate**), `models.ts`, `conversation.ts` (F1), `verifiers/*` (F4), `triage.ts`, `relaxation.ts`, `ranker.ts`, `vocab.ts`
- `lib/` — `taste-memory.ts` (F5), `booking/*` + `calendar.ts` (F3), `distance.ts`, `booking-url.ts`, `onemap/*`, `sources/*`, `trending/*`
- `components/` — `ResultsView`, `RefineBar` (F1), `ItineraryView` (F2), `BookingOverlay` (F3 gate), `WhatsAppShareModal`, `VenueDetailModal`, `OverviewMap`, …
- Docs: [Gabo_prd.md](Gabo_prd.md) (product spec) · [AGENTIC_ROADMAP.md](AGENTIC_ROADMAP.md) (design + status) · [CLAUDE.md](CLAUDE.md) (dev state + gotchas)
