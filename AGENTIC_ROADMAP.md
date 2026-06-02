# Gabo — Agentic Roadmap

> **Status:** design / pre-build · **Last updated:** 2026-06-02
>
> Living design + build-tracking doc for the next-generation agentic features.
> This is **not** canonical spec — the source of truth for shipped behaviour is
> [Gabo_prd.md](Gabo_prd.md). When a feature here ships, promote its user-visible
> behaviour into the PRD (§2 flow / §4 rules / §6 sources) and update the status
> below. CLAUDE.md should carry only a one-line pointer to this file, never its
> contents (it's loaded into context every session).

## Status legend

`◻ Not started` · `◐ In progress` · `◼ Shipped` · `⏸ Parked`

| # | Feature | Status |
|---|---------|--------|
| F1 | Conversational planner | ◻ Not started |
| F2 | Whole-evening itinerary composition | ◻ Not started |
| F3 | Booking concierge (human-in-the-loop) | ◻ Not started |
| F4 | Self-healing catalog agent | ◻ Not started |
| F5 | Longitudinal taste memory | ◻ Not started |

---

## The core reframe

Gabo today **recommends venues**. These features move it to **plan and execute an
evening**. Architecturally that's one inversion:

> Today the deterministic planner (`/api/plan`) is the top of the stack and Gemini
> hangs off its seams as single-shot calls. **Flip it** — make the deterministic
> planner a *tool an agent calls*, and let an orchestrating agent run the loop:
> interpret intent → call the planner → critique the result → re-call → compose → act.

This preserves what makes Gabo good — fairness math, hard filters, and scoring stay
deterministic, auditable, and fast — while unlocking what a single-shot call
structurally can't do: multi-turn negotiation, whole-evening reasoning, and action.

## Guiding principles (do not violate)

1. **Agents at the seams, not the whole pipeline.** The instinct already in
   `AI_BUILDER_NOTES.md` survives the upgrade. Looping agents are reserved for cases
   the cheap deterministic path can't satisfy.
2. **The user-visible decision stays deterministic.** Fairness/match/freshness/friction
   scoring (`lib/planner/score.ts`) is the product's differentiator. An agent may
   *reorder, compose, or propose*; deterministic code governs the consequence — exactly
   like the ranker's `±3` clamp does today (`lib/agents/ranker.ts`).
3. **Latency floor is the fast deterministic plan.** The 60-second promise dies under
   synchronous agent loops. Keep agents *off the hot path*: stream the deterministic
   plan instantly, refine/compose/verify asynchronously.
4. **Irreversible actions are human-gated.** Bookings, outbound messages, calendar/
   payment writes: propose → confirm → execute. Never autonomous (see F3).
5. **Everything is flagged and audited.** New agents ship dark behind `AGENTIC_*` env
   flags (matching `AGENTIC_PLAN_ENABLED` / `AGENTIC_RANKER_ENABLED`) and log through
   `lib/agents/runner.ts` → `run-log.ts` → `/admin/agents`.

## Shared architecture foundation

These land once and underpin F1–F5:

- **Planner-as-tool.** Wrap `/api/plan` (and OneMap routing/hours) as agent-callable
  tools so an orchestrator can invoke the deterministic engine without recomputing it.
- **Orchestration layer = Claude; extraction = Gemini.** Gabo runs zero Claude today.
  The reasoning/tool-use/looping layer is where Claude earns its place (extended
  thinking, tool use, memory); Gemini stays the cheap extraction workhorse
  (`models.ts` already centralises tiers — add an `ORCHESTRATION_MODEL`).
- **Agent runner already exists.** `lib/agents/runner.ts` + `run-log.ts` + `/admin/agents`
  is the observability substrate. Every new agent routes through it.

- [ ] Wrap `/api/plan` as an agent tool (structured in/out, no recompute)
- [ ] Wrap OneMap drive/transit + hours checks as agent tools
- [ ] Add `ORCHESTRATION_MODEL` to `lib/agents/models.ts`
- [ ] Extend `runner.ts` to log multi-step agent loops (not just single calls)

---

## F1 — Conversational planner  ◻

**Goal.** Replace the form's ceiling. Handle fuzzy intent the structured form can't:
*"somewhere romantic but we just ate, maybe a walk near the water, and he hates
anything too loud."*

**User value.** A smarter *planner*, not just a smarter form — multi-turn negotiation
toward a plan the user actually wants.

**Current state.** `lib/agents/triage.ts` is single-shot: freeform text → plan request,
once. No back-and-forth, no re-plan.

**Agentic design.** A planning agent holds a multi-turn loop with the planner-as-tool:
propose → user pushes back (*"too far for her"*) → re-plan → confirm. Asks **one**
clarifying question only when it materially changes the result.

**Stays deterministic.** The planner the agent calls is unchanged. The agent slot-fills
and orchestrates; it does not score or rank.

**Risks / guardrails.** Latency (stream partial results; don't block on the loop);
clarification fatigue (ask sparingly); flag `AGENTIC_CHAT_ENABLED`.

**Phases.**
- [ ] Multi-turn intent loop over `triage.ts` → plan request
- [ ] "Push back and re-plan" turn (consume prior plan + user correction)
- [ ] Single-clarifying-question heuristic (only when it changes the outcome)
- [ ] Streaming UI surface (chat-style, falls back to the form)
- [ ] Flag + runner instrumentation

---

## F2 — Whole-evening itinerary composition  ◻

**Goal.** Reason about the *combination*, not independent cards. Dinner at 7 + an
exhibition that closes at 9 forty minutes away is two good cards and a bad night.

**User value.** Gabo returns an *itinerary* (sequenced, paced, transition-aware), not a
parallel list of buckets. This is the clearest "beyond deterministic" win.

**Current state.** `score.ts` scores venues independently; `bucketByCategory` returns
parallel Dining/Events lists. Nothing reasons over the evening as a whole.

**Agentic design.** An agent composes a sequenced evening — pacing, transitions, the
OneMap leg *between* stops, reservation/closing windows, weather windows — using
routing/hours as tools. Combinatorial structure the per-venue scorer can't express.

**Stays deterministic.** Per-venue scoring and hard filters still produce the candidate
set. The agent sequences *within* that vetted set; it can't resurrect a filtered venue.

**Risks / guardrails.** Combinatorial blowup (cap candidates, like the existing
24-cap); latency (async refinement after the fast plan); flag `AGENTIC_ITINERARY_ENABLED`.

**Phases.**
- [ ] Inter-stop routing as a tool (reuse OneMap drive/transit)
- [ ] Itinerary candidate generation over the scored set
- [ ] Sequencing reasoner (timing, closing windows, weather, pacing)
- [ ] Itinerary result shape + UI (timeline view alongside cards)
- [ ] Flag + runner instrumentation

---

## F3 — Booking concierge (human-in-the-loop)  ◻

**Goal.** Move from planner to concierge: check availability, hold/book, calendar,
prepare the handoff. **The safeguard is the feature.**

**User value.** The thing users would actually pay for — Gabo *does* the thing.

**Current state.** CTAs link out (`lib/booking-url.ts` → Chope/Google). No action taken.

### Threat model

The agent takes outward-facing, often irreversible actions: wrong venue/time/party
size; **double-book** on retry; burns a no-show-penalized slot; sends the WhatsApp
handoff to the **wrong contact** or with hallucinated detail; bad calendar/payment write;
acts on a plan still being edited.

### Safeguard: propose → confirm → execute, tiered by reversibility

The agent **never** calls a side-effectful tool directly. It assembles a structured
*action plan*; **deterministic code** (not the model) classifies each action and decides
what needs a human:

| Tier | Examples | Gate |
|------|----------|------|
| **Read-only** | check availability, fetch cancellation policy, wait times | None |
| **Reversible** | add-to-calendar, auto-expiring hold | One tap, non-blocking |
| **Irreversible / outward** | confirmed booking, sending WhatsApp, payment/deposit | **Explicit confirm, full payload, mandatory** |

Trust rules:
1. **Confirm the real payload, not the model's summary.** Card shows the *actual* venue/
   date/time/party/name/phone + provider's verbatim cancellation policy — pulled from the
   booking API, not paraphrased. Users approve facts, not prose. (Biggest hallucination guard.)
2. **Dry-run first.** Simulate the full flow and render "here's exactly what I'll do"
   before any live call.
3. **One confirmation per evening, not per step.** A 3-stop itinerary batches into one
   review card listing all side-effects. Per-step gating trains rubber-stamping;
   confirmation fatigue is itself a safety failure.
4. **Halt-and-hand-off on uncertainty.** Deposit / special request / ambiguous time →
   stop and surface the gap, don't guess.
5. **Idempotency + double-book guard.** Every action carries a key; retries never
   re-fire a committed booking; check existing bookings/shortlist first.
6. **Scoped authority, no standing power.** No "book whatever's best" mode. Payment/holds
   have a per-action cap; over it → mandatory confirm. Authority is per-plan, not persistent.
7. **Immediate undo.** Surface the cancellation path right after execution; the concierge
   can *cancel* on request, not just book.
8. **Partner message = edit-before-send, never auto-send.** Show exact text against the
   exact contact; user edits and sends.

### Maps onto existing surfaces (mostly reuse)

- `BookingOverlay` + `WhatsAppShareModal` become the **gate** (review card + edit-before-send),
  not just linkout shims.
- `runner.ts` + `run-log.ts` + `/admin/agents` = the **audit trail**: log proposed action,
  classified tier, what the user confirmed, what executed, provider response.
- Gate the whole concierge behind `AGENTIC_BOOKING_ENABLED`; ship dark, enable per cohort.

**Phases.**
- [ ] Action-plan schema + deterministic tier classifier
- [ ] Read-only availability/policy tools (no gate)
- [ ] Confirmation card rendering real provider payload (via `BookingOverlay`)
- [ ] Dry-run / preview mode
- [ ] Execute layer with idempotency keys + double-book guard
- [ ] Batched single-confirmation for multi-stop itineraries
- [ ] Edit-before-send WhatsApp guard (via `WhatsAppShareModal`)
- [ ] Undo / cancel path
- [ ] `AGENTIC_BOOKING_ENABLED` flag + full audit logging

---

## F4 — Self-healing catalog agent  ◻

**Goal.** Fix the data problem at its root. The catalog pain (Google Places 403 /
Foursquare 402, blog-scanner stopgap — PRD §6.4) is exactly the schema-flexibility
problem agents are good at.

**User value.** A bigger, fresher, more reliable catalog without manual source plumbing.

**Current state.** `lib/sources/blog-scanner.ts` is single-shot extraction over a
**hardcoded** source list. Three verifiers (`lib/agents/verifiers/*`) are single judges.

**Agentic design.** A discovery agent that autonomously follows links, cross-references
new sources, dedups against the live catalog, and adapts when a site's HTML changes —
making ingestion source-agnostic and self-healing. Verifiers level up from single judges
to a **proposer/skeptic debate** for higher precision.

**Stays deterministic.** Catalog writes still go through the existing source/provenance
columns and dedup (`bucketByCategory` ~200m + normalized name). The agent proposes rows;
verification + dedup gate entry.

**Risks / guardrails.** Source quality drift (verifier debate as the gate); cost (cron
only, never per-request); junk-source guard. Cron-side, so no user latency.

**Phases.**
- [ ] Link-following / source-discovery loop (seed from current sources)
- [ ] Cross-reference + dedup against live catalog before proposing
- [ ] Verifier debate (proposer/skeptic) replacing single-judge verifiers
- [ ] Self-heal on extraction failure (adapt when a site changes)
- [ ] Wire into cron (`sync-blogs` / new `sync-discover`), runner-instrumented

---

## F5 — Longitudinal taste memory  ◻

**Goal.** Build a persistent, explainable model of the couple's taste over time. This is
the PRD's parked §4.6 "personalization learning."

**User value.** *"Shortlisted 3 natural-wine bars, skips every Italian, always picks
<20 min for her"* — recommendations that compound and explain themselves.

**Current state.** `applyShortlistAffinity` is a deterministic one-shot augmentation from
saved venues; profile is localStorage chips. No longitudinal model.

**Agentic design.** A memory agent (e.g. Claude memory tool) maintains a persistent taste
profile from shortlist/plan history, surfacing it as preferences the deterministic planner
consumes — and able to *explain* its inferences.

**Stays deterministic.** Memory produces *preferences*; the planner scores against them
with the same deterministic formula. Memory never scores venues directly.

**Risks / guardrails.** Schema alignment (the `profiles` table still has singular
`vibe_default`/`budget_band` vs array code — see CLAUDE.md follow-ups; resolve before
DB persistence); privacy (taste model is sensitive — local-first or encrypted);
explainability (must show *why* it inferred a preference).

**Phases.**
- [ ] Resolve `profiles` schema (singular → arrays) migration
- [ ] Persistent taste store (memory tool or DB)
- [ ] Inference loop from shortlist/plan history → preferences
- [ ] Feed inferred preferences into `applyShortlistAffinity` input
- [ ] "Why we inferred this" explainability surface
- [ ] Privacy review (local-first vs encrypted server store)

---

## Sequencing

1. **Shared foundation** (planner-as-tool, orchestration model, runner upgrade) — unblocks all.
2. **F1 Conversational planner** — contained, reuses `/api/plan`, removes the form's ceiling.
3. **F2 Itinerary composition** — the genuine product gap; biggest "beyond deterministic" win.
4. **F4 + F5** — infrastructure that compounds quietly underneath (cron-side / personalization).
5. **F3 Booking concierge** — last; the guardrail surface is largest, build it when the
   plan it acts on is already excellent.

## Open decisions

- [ ] Orchestration model choice + cost ceiling per plan
- [ ] Sync vs async UX for F1/F2 (how much streams before the loop resolves)
- [ ] Booking provider(s) for F3 and their availability/cancellation APIs
- [ ] F5 storage: local-first vs server (ties to the `profiles` schema migration)
