# PRD — Gabo
**Less planning. More us time.**
Owner: Product | Status: Product value and UX revision | Reviewed: 2026-09-07

## 1. Product decision

**Value proposition:** For the person planning a date in Singapore, Gabo brings dinner and things to do into one shortlist, with personal preferences and both starting points in mind, so they can choose a thoughtful idea and share it with their partner.

The product should earn trust by making a decision easier. More venues, AI features, or clicks are not success in themselves.

### 1.1 Audience and job to be done

**Primary user:** A busy person planning an evening with their partner, often starting from different places. They want something enjoyable without doing all the research or asking their partner to install another app.

**Job:** “When we have a free evening, help me choose somewhere we will both enjoy and can reasonably get to, so I can send a concrete suggestion instead of another ‘where should we go?’ message.”

**Trigger:** A free evening, a planned date, or a special occasion. **Successful outcome:** the planner chooses a viable venue or evening and prepares a shareable suggestion. A provider click is not proof of a reservation, and opening a share sheet is not proof a message was sent.

**Secondary use:** Browse for inspiration and save ideas before choosing a date. Discovery supports planning; it must not become an endless feed that replaces the decision.

**Outside the initial focus:** tourists building multi-day trips, large groups, partner accounts, payments, automatic reservations, and cross-device collaboration.

### 1.2 Why choose Gabo?

These are positioning hypotheses to test with users, not externally validated competitor claims.

| Existing approach | Unfinished job | Gabo's differentiated value | Evidence the interface must show |
|---|---|---|---|
| Food or lifestyle articles | Turn inspiration into an option for a specific evening | Date-aware dinner and activity discovery | Event dates, hours provenance, source link |
| Map searches | Compare the effort for two people | Both journeys in the same comparison | Per-person ETA, mode, and clear estimates |
| Booking directories | Decide what suits the couple before booking | Taste-aware shortlist with a reason to choose each option | A concrete match reason, price band, actionable next step |
| Messaging back and forth | Turn options into a clear suggestion | Save and prepare a plan to share | Venue, selected date/time, address, and useful links |

The original “30 minutes to 60 seconds” statement has no research or measurement attached in this repository. Treat 60 seconds as a **usability target**, not a customer-facing guarantee. Do not claim confirmed opening hours, equal commutes, live inventory, or completed bookings when the data cannot establish them.

### 1.3 Review findings and decisions

| Finding | Product consequence | Decision |
|---|---|---|
| PRD mixes a hackathon brief, architecture, and shipped UI details | Teams can ship features without knowing which user outcome matters | Make sections 1–2 the product contract; retain technical detail below for reference |
| Default “Dinner + event” preset added European/cocktail preferences; other presets inferred price restrictions | First-time results can be biased without a choice by the user | Remove implicit cuisine and budget presets; mood chips map directly to selected moods |
| “Quality brief” exposed many chips before the user had seen value | More work than a simple planning promise suggests | Date and optional starts first; disclose food preferences, budget, occasion and notes progressively |
| Fairness is a differentiator, but optional starts do not explain its benefit | People may skip the inputs needed to experience it | Explain the difference between zero, one and two starts at the input |
| Operational history contradicts earlier requirements (GrabMaps, simulated transit, onboarding) | The specification is unreliable | Correct those references; date operational snapshots and verify them before release |
| Source freshness, booking links, and silent constraint widening can undermine confidence | A polished shortlist can still lead to a failed evening | Put trust requirements ahead of additional AI features |

### 1.4 Priorities and release policy

**P0:** Make a credible first choice: low-friction input, relevant shortlist, understandable journeys, trustworthy venue facts, and honest handoff. **P1:** Improve full-evening composition, preference control, and learning from repeat use. **P2:** Expand sources and distribution only after quality and repeat use are established.

The current frontend revision implements the planning simplification and visual hierarchy. It does **not** complete every release requirement below. “Partial” and “gap” rows are explicit backlog items; they must not be represented as shipped guarantees.

## 2. Requirements and validation

### 2.1 Outcome-based requirements

| ID / priority | Requirement and user value | Acceptance criteria | State after this revision |
|---|---|---|---|
| R1 · P0 | Start without setup | No account or quiz gate. Only a future date/time is required. Date input and submitted instant use Singapore time even on a device abroad. No cuisine, price or mood inferred from an untouched form. | Implemented in frontend; existing saved preferences still apply |
| R2 · P0 | Explain why starts matter | Zero starts: islandwide with no fairness claim. One: explain that adding the other enables comparison. Two: show both per-person journeys in results. Missing routing must never look like a zero-minute trip. | Form messaging implemented; existing ETA failure/fallback behavior needs audit |
| R3 · P0 | Reduce the comparison burden | Keep dining and activities distinct. Show name, source, why it fits, price band and time-sensitive facts; initially show up to six per category and allow narrowing. A user can identify a suitable next action without opening several cards. | Existing categories, filters and reasons; price visibility and decision burden need validation |
| R4 · P0 | Make confidence visible | Show whether hours are confirmed, extracted, defaulted or unknown. Expired event runs are excluded. Estimated transit is labeled. A missing source or stale record must not imply verification. | Partial: filtering, sources and ETA labeling exist; per-card hours provenance is a gap |
| R5 · P0 | Make the next action honest | Label actual booking destinations versus a search fallback. Walk-in-only venues must not suggest reservable inventory. Opening a provider page must never mark a booking complete. Share content must not assert a reservation without user confirmation. | Partial: provider handoff and walk-in handling exist; fallback labels and confirmation semantics need audit |
| R6 · P0 | Recover without starting over | Loading is announced, errors offer retry/edit, and empty results offer concrete alternatives. Returning to edit preserves the current date, starts and explicit preferences. Discovery failure has visible recovery. | Loading and discovery states improved; full draft preservation is a gap |
| R7 · P0 | Support mobile and keyboard use | At 360px, no horizontal page overflow; readable labels, visible focus, named inputs, keyboard place selection, reduced-motion support and browser zoom. Primary action remains easy to reach. | Frontend updated; validate against the device checklist below |
| R8 · P0 | Respect explicit constraints | Hard dietary constraints never relax. Budget/avoid widening requires an understandable notice and a way to keep original constraints. No hidden preset should widen a selected budget. | Preset issue removed; existing automatic widening and triage merges need a separate control/notice pass |
| R9 · P1 | Compose a feasible evening | Dinner plus activity has a reachable start time, visit duration and travel buffer. Explain when no pair is feasible; do not fabricate one. Enable sharing the whole evening, not just a venue. | Existing feasibility-based Evening view; complete-evening sharing is a gap |
| R10 · P1 | Help returning users with control | Reuse useful starts, saved venues and tastes. Make inferred preferences understandable and resettable. Explicit choices override learned signals. Saved content is described as device-local until account sync exists. | Existing local memory; unified review/reset and preference precedence need validation |

**Core journey:** choose when → optionally add both starts and mood → “Find our date spots” → compare dining/activities and journeys → inspect or save a favourite → open the provider or prepare a share. Chat is an alternate input path; it does not compete with the primary form. The Evening view is an optional continuation, not a promise made by a preset.

**Browsing:** “Explore places” scrolls to discovery below the form. Discovery is inspiration, not availability for the chosen date. It must have a visible loading, empty, or failure state rather than silently disappearing.

### 2.2 Success measures

All thresholds below are **proposed pilot gates**, not measured results. Product owns user research and the dashboard; engineering owns event accuracy and reliability. Baseline the existing experience before evaluating the revision.

**Primary metric — useful-choice rate:** percentage of sessions with rendered, nonempty planning results that lead to a save, copied suggestion, or provider link opened within 10 minutes. Deduplicate to one success per session. This is a proxy; follow-up research must confirm whether the suggestion was actually useful.

| Measure | Definition | Proposed pilot gate |
|---|---|---|
| Useful-choice rate | Successful sessions / sessions with nonempty results | ≥50% after 100 eligible pilot sessions; report numerator and denominator |
| Time to first useful choice | First form interaction to first successful action; do not hide abandoned sessions | Median ≤60s among successes; publish abandonment alongside it |
| Result reliability | Valid plan requests returning a usable nonempty shortlist | ≥90% over a fixed supported-date/constraint fixture set; report legitimately impossible requests separately |
| Trust | Audited surfaced records with wrong run dates, unsupported availability or broken action links | Zero critical errors in a 30-record pre-release sample; fix and resample affected sources |
| Repeat value | Activated pilot planners making another plan within 28 days | ≥25% of users eligible for the full 28-day window |
| Request performance | Submit to results rendered, including optional interpretation | p95 ≤15s under pilot load; do not conflate backend latency with decision time |

**Instrumentation backlog:** `plan_started`, `plan_submitted`, `plan_results_shown`, `plan_failed`, `venue_saved`, `share_opened`, `share_copied`, `provider_opened`, `plan_refined`. Use a session/request ID, elapsed time, result count, number of starts and failure category. Do not collect raw notes, exact starting coordinates or partner names for product analytics. A share-open event never counts as a sent message. Existing shortlist logging alone does not measure this funnel. Returning-user measurement requires an appropriate pseudonymous identifier and disclosure; cross-device retention remains unavailable without identity.

**Guardrails:** monitor zero-result rate, request failure rate, unsupported-fact reports and model/routing cost per useful choice. Establish the cost baseline before setting a financial gate; more model calls are justified only by better outcomes. Do not optimize provider clicks at the expense of relevance or undisclosed promotion.

### 2.3 Research and release checklist

1. Recruit 8–10 people who regularly plan dates in Singapore. Ask about their last real planning episode before showing Gabo; verify the pain and current time spent.
2. Test a weekday date from two origins, an islandwide search, and an occasion with a specific budget. Counterbalance old/new UI order. Record first-choice time, completion, confusion, and whether the user can explain each journey and the booking handoff.
3. Ask participants to select an idea they would actually send. Treat comprehension and suitability as evidence; visual preference alone is insufficient.
4. Run keyboard-only planning plus 360px mobile, tablet and desktop checks. Exercise optional disclosures, origin selection/editing, invalid/past date, loading, empty results, failures, saved state and provider destinations. Use controlled fixtures for interaction tests and separately audit live data.
5. Product and engineering resolve the P0 trust gaps before broad release, then instrument a pilot. Review results after 100 eligible sessions and retention once the 28-day cohort matures. If discovery is popular but useful-choice rate stays low, improve selection quality before adding features.

**Business hypothesis:** Repeat planning is the first proof of value. Monetization is not committed. Any later referral model must disclose commercial relationships and preserve relevance; test willingness to use repeatedly before introducing paid tiers or partner inventory.

---

The following sections retain engineering and operational reference material. Historical catalog counts, source availability and feature-flag snapshots are not current production attestations. Sections 1–2 govern product requirements where older descriptions conflict.

## 3. Supabase Data Schema

```sql
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  planner_name text not null,
  partner_name text not null,
  cuisines_loved text[] default '{}',
  cuisines_avoided text[] default '{}',
  dietary_hardstops text[] default '{}',
  -- NOTE: schema is singular; code uses arrays. Migrate before enabling auth.
  vibe_default text check (vibe_default in ('cozy','adventurous','celebratory','low_key')),
  budget_band int check (budget_band between 1 and 4),
  transit_pref text check (transit_pref in ('mrt','grab','either')) default 'either',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table venues (
  -- 53 rows seeded. RLS allows anon SELECT (see migration 0002).
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  address text,
  cuisine_tags text[] default '{}',     -- overloaded: also holds 'experience',
                                        -- 'exhibition','art','music','games',
                                        -- 'outdoor','nature' for non-eatery
                                        -- venues. `experience` tag = event.
  vibe_tags text[] default '{}',
  dietary_flags text[] default '{}',
  budget_band int check (budget_band between 1 and 4),
  is_outdoor boolean default false,
  photo_url text,
  chope_url text,                       -- DUAL PURPOSE: dining → Chope listing;
                                        -- events → official ticket / info page.
                                        -- See §4.7.
  hours_json jsonb,
  ph_hours_json jsonb,                  -- PH override TODO
  badge text check (badge in ('closing_soon','soft_launch','critic_pick','award_fresh','none')) default 'none',
  badge_meta jsonb,
  trending_score numeric default 0,     -- 0–1; ≥ 0.7 surfaces a "Trending" pill
  active boolean default true
);
```

### 3.1 Catalog composition (live-sourced, post-hackathon)
The legacy 53-venue hand-seeded catalog has been retired. The catalog now grows weekly from real sources (§6). Composition shifts with each cron cycle, but typical state:
- **Dining**: ~80–150 venues from Google Places + Foursquare when their API access is healthy; ~10–30 from the editorial blog scanner when both API providers are blocked (current state — see §6.4).
- **Events**: museum exhibitions (SAM + NGS live scrapers, plus Gemini-grounded coverage of ArtScience / NHB / Gardens via `lib/sources/museum-agent.ts`), Esplanade in-house programming (theatre / music / dance / festivals via `lib/sources/esplanade.ts`), and date-bounded events from The Smart Local's "Things To Do" feed (Gemini-extracted via `lib/sources/tsl-events.ts`). No general concert source — Bandsintown was removed (terms restrict access to artists/representatives, see §6.4); Sistic remains parked pending TOS review.
- All rows carry `source` + `source_url` for attribution and verifiability (§6.1). Editorial rows are CHECK-constrained to require `source_url`.

---

## 3.2 What's LLM-driven vs rules-based

Gabo is a **deterministic planner with LLM help at the seams**, not an agentic system despite the `lib/agents/` folder name. The user-visible decision — *which* venues appear and *in what order* — is pure rules-based code; no LLM scores or ranks venues in the default configuration. Every LLM call is **Gemini** (no Claude/Anthropic in the runtime). The model tier per task is centralised in `lib/agents/models.ts` (extraction → `gemini-2.5-flash`; verify / copy / triage / rank / orchestration → `gemini-2.5-flash-lite` / `flash`); every call is wrapped by `lib/agents/runner.ts` for observability (`/admin/agents`).

The **base app** has **9 LLM touchpoints + a triage step**, all single-shot. The only ones that reach outside their prompt use Gemini **with Google Search grounding** (museum discovery + the verifiers) and run exclusively in cron ingestion — never on a user's plan request. The **agentic features (F1–F5)** add the first looping/multi-call touchpoints (a bounded tool-use loop in F1, a 2-call debate in F4); they are **default-on with explicit env opt-outs** and still keep every user-visible decision in deterministic code (see the F-series table below).

**Cron ingestion — LLM-driven (off the request path):**

| Touchpoint | Model | Mechanism | Why LLM |
|---|---|---|---|
| **Catalog ingestion (dining)** | flash | Extracts structured venue records from food-blog prose: name, address, cuisine/vibe tags, opening/closing dates, award labels, reservation policy, photo selection (`lib/sources/blog-scanner.ts#extractVenues`) | Articles vary wildly in shape (single review vs roundup vs award write-up) |
| **Catalog ingestion (experiences)** | flash | Same scanner, separate prompt extracts pop-ups, indie shops, festivals with run windows (`lib/sources/blog-scanner.ts#extractExperiences`) | Same |
| **Hours extraction (blog venues)** | flash | Optionally returns parsed weekly hours from article body; stamps `badge_meta.hours_source='extracted'`, else cuisine-typed defaults | Hours stated in free prose ("Tues–Sun, 6pm till late") |
| **Blog-extraction verifier** | flash-lite | Single-shot judge over each extracted row: pass / soft-flag / hard-reject (`lib/agents/verifiers/blog-extraction.ts`) | Catch hallucinated or malformed extractions before they enter the catalog |
| **Museum / exhibition discovery** | flash **+ Search** | Grounded search finds current/upcoming exhibitions across NHB / ArtScience / Gardens (`lib/sources/museum-agent.ts`) | Open-ended discovery problem with no clean API |
| **Museum-extraction verifier** | flash-lite (+Search) | Grounded single-shot judge over discovered exhibitions (`lib/agents/verifiers/museum-extraction.ts`) | Confirm the exhibition is real and current |
| **Freshness verifier** | flash-lite **+ Search** | Grounded re-check of up to 50 trending venues/run; writes `active=false` / badge annotations to Supabase (`lib/agents/verifiers/freshness.ts`) | Catch closed venues / ended runs that the catalog still lists |
| **TSL event extraction** | flash | Single-shot extraction on the TSL Things-to-Do source only (`lib/sources/events-sync.ts`) | Unstructured RSS prose |

**Per-request (`/api/plan`) — mostly deterministic, LLM at the edges:**

| Touchpoint | Model | Mechanism | Notes |
|---|---|---|---|
| **Triage** | flash-lite | Single-shot intent parse + parallel OneMap place resolution (`lib/agents/triage.ts`, via `/api/plan/triage`) | Only fires when the user typed freeform text (≥4 chars); slot-fills the plan request, doesn't plan |
| **Relaxation** | flash-lite | Suggests which soft constraints to drop on thin buckets (`lib/agents/relaxation.ts`) | **Gated by `AGENTIC_PLAN_ENABLED`**; only after a *deterministic* widening pre-pass (`attemptWiden`) fails |
| **Tolerance-band ranker** | flash-lite | Suggests a reorder within a bucket (`lib/agents/ranker.ts`) | **Gated by `AGENTIC_RANKER_ENABLED`**; LLM only *suggests* — deterministic clamp (±3 positions, #1 can't fall below #3) decides |
| **Per-venue reasoning copy** | flash-lite | Generates the "why this fits you" line per card from profile + venue signals (`lib/planner/gemini-eval.ts`) | Always on for top ~10 cards; 8s timeout + empty-map fallback, non-blocking |

**Agentic features (F1–F5) — default-on, flag opt-out:**

Each keeps the user-visible decision (scoring, feasibility, keep/drop, action tiers) in deterministic code; the LLM is confined to interpretation, argument, or prose. See [AGENTIC_ROADMAP.md](AGENTIC_ROADMAP.md) for status + follow-ups and [ARCHITECTURE.md](ARCHITECTURE.md) for the decision rationale.

| Feature | LLM? | Mechanism | Flag |
|---|---|---|---|
| **F1 · Conversational refine** | flash, **bounded tool-use loop** | Per-request `/api/plan/refine`; interprets a plain-language correction into a *validated `PlanRequest` patch*, then `planDate()` re-runs. Agent changes inputs, never outputs (`lib/agents/conversation.ts`) | `AGENTIC_CHAT_ENABLED` + `NEXT_PUBLIC_…` |
| **F2 · Evening itinerary** | flash-lite, single-shot | On-demand `/api/plan/itinerary`; **feasibility (timing/reachability) is deterministic**, the LLM only picks the best feasible evening + writes the pacing line (`lib/planner/itinerary.ts`) | `AGENTIC_ITINERARY_ENABLED` + `NEXT_PUBLIC_…` |
| **F4 · Verifier debate** | flash-lite, **2-call debate** | Cron blog-extraction; proposer + skeptic, then a **pure deterministic tie-break** decides keep/flag/drop (`runner.ts#resolveDebate`) | `AGENTIC_VERIFIER_DEBATE` |
| **F3 · Booking concierge** | **none** (deterministic) | Client gate; tier-classifies actions (irreversible/reversible/outward), confirms the real payload, opens the real provider page — never fabricates a booking (`lib/booking/*`, `BookingOverlay`) | `NEXT_PUBLIC_AGENTIC_BOOKING_ENABLED` |
| **F5 · Taste memory** | optional flash-lite for the hint **wording only** | Client; **signed** recency-weighted affinity over local saves (+1) and "Not for us" skips (−1) enriches the plan profile (reuses `matchScore`; skips suppress promotion, never the hard `cuisines_avoided` filter); explainable "Leaning…" hint, optionally reworded by an LLM over the **aggregated tags only** (`lib/taste-memory.ts`, `/api/taste/narrate`) | `NEXT_PUBLIC_AGENTIC_TASTE_ENABLED` (+ `AGENTIC_TASTE_NARRATE_ENABLED` / `NEXT_PUBLIC_…` for the LLM hint) |

**Deterministic (the user-visible decisions):**

| Layer | Mechanism | Why |
|---|---|---|
| Hard filters (open at time, dietary, weather, budget, run window) | `lib/planner/plan-date.ts#filterCandidates` + `lib/planner/hours.ts` | Must be predictable; user can audit why a venue dropped out |
| Fairness, match, freshness, friction scoring | `lib/planner/score.ts` | Must be debuggable, fast, stable across runs |
| Card bucketing (Dining / Events) + filter-chip predicates | Pure functions on row metadata | Same |
| Trending score (Reddit + shortlist velocity) | Statistical hybrid weight in `lib/trending/refresh.ts` | Statistical aggregation, not understanding |
| Routing + ETAs | OneMap drive / public-transit APIs | Already correct; no LLM value-add |

Rule of thumb: **LLM where the input is unstructured prose or the output is human-facing copy; rules where the input is structured data and the output is a user-visible decision.** Even the flagged "agentic" relaxation/ranker steps keep the final, user-visible call in deterministic code.

---

## 4. Business Logic Rules

### 4.1 Candidate Filtering (hard filters)
- Venue `active = true`.
- Open at `scheduled_for` (cross-midnight aware; on SG public holidays `ph_hours_json` is used when present, otherwise falls back to `hours_json`).
- No `cuisines_avoided` overlap with `cuisine_tags`.
- All `dietary_hardstops` satisfied by `dietary_flags`.
- If override `vegetarian` → `vegetarian_friendly` required.
- If override `no_alcohol` → `alcohol_free` required.
- If weather is `rain` AND `is_outdoor` → exclude. Weather: NEA `/v1/environment/rainfall-forecast`.
- Budget filter applies to **dining only** — experiences span budget_bands and aren't excluded by the user's restaurant budget preference.

### 4.2 ETA & Transit Mode
- OneMap drive routing is called for routed candidates and provided starting points; see §8.
- **Server stores driving minutes for ranking**. The results UI defaults to transit and lazily requests OneMap public-transit ETAs. A simulated estimate is retained for lookup failure or missing context; see §8. Display-mode changes do not re-rank the shortlist by transit fairness.
- `fairness_gap_min = |eta_a - eta_b|` (in driving minutes).
- Reject any candidate with `max(eta_a, eta_b) > 60` min when ETAs are present. With no starts, the filter is a no-op.

### 4.3 Scoring (three paths depending on starts provided)

**Two starts** — original fairness path:
```
score = 0.35·fairness + 0.30·match + 0.25·freshness − 0.10·friction
fairness = 1 / (1 + |eta_a − eta_b|)
friction = (eta_a + eta_b) / 60
```

**One start** — friction without fairness:
```
score = 0.45·match + 0.40·freshness − 0.15·friction
friction = eta / 30
```

**Zero starts** — match + freshness only:
```
score = 0.5·match + 0.5·freshness
```

Celebratory overrides (anniversary, birthday) shift weights toward freshness in all paths.

`match` and `freshness` definitions unchanged from v1.

### 4.4 Card Bucketing — Dining vs Events
The v1 buckets (Easy yes / A small detour / Worth the leap) have been **replaced** with a flat split by category and a tab-based UI. Each tab is capped at **6 cards**. Filter chips on the results page narrow within a tab:

| Filter | Logic |
|---|---|
| All | union of Recommended ∪ Limited-run ∪ Just opened (a card must match at least one badge chip) |
| Recommended | `badge ∈ {critic_pick, award_fresh}` OR `trending_score ≥ 0.7` |
| Limited-run | `badge = closing_soon` |
| Just opened | `badge = soft_launch` |
| ★ Shortlist | venue id is in localStorage shortlist |

**Where badges come from:**
- `closing_soon` — Dining: blog-scanner Gemini extraction of an explicit end date when the article frames a venue as a pop-up / residency / chef takeover / limited engagement (`is_limited_run` + `ends_at`). Events: `ends_at` from the source (editorial / TSL article) within 30 days.
- `soft_launch` — Dining: blog-scanner Gemini extraction of an explicit opening date for venues opened within ~6 months (`is_new_opening` + `opens_at`). Events: editorial / TSL events whose run started within the last 14 days (excluded if `closing_soon` already applies).
- `critic_pick` — set by a post-upsert pass in the blog scanner. A venue gets `critic_pick` when its (case-normalised) name appears across ≥3 distinct blog sources in the editorial catalog. `badge_meta.source` lists the contributing blogs. Demoted to `none` (or back to `award_fresh` if the venue still has award metadata) when the cross-blog count drops below the threshold.
- `award_fresh` — blog-scanner Gemini extraction. Set when an article is explicitly a write-up about Michelin Guide Singapore, Asia's 50 Best, World's 50 Best, World Gourmet Awards / Summit, or Tatler Dining naming the venue. `badge_meta.award` carries the short award label; aged out after 365 days without a fresh mention.

Priority when multiple signals apply: `closing_soon > soft_launch > critic_pick > award_fresh`, matching the freshness weights in `lib/planner/score.ts`.

The category split is determined by `isEvent(venue)` in `lib/planner/category.ts` — currently `'experience' ∈ cuisine_tags`. Future cleanup: promote to a dedicated `category` column.

### 4.5 Override Behavior
- `Anniversary` / `Birthday`: boosts freshness weight, softens friction across all three scoring paths. Section reordering (Wild-first) from v1 is gone — there are no Wild/Stretch sections to reorder anymore.
- `Vegetarian`: hard filter (requires `vegetarian_friendly`).
- `No alcohol`: hard filter (requires `alcohol_free`).
- Overrides are session-only.

### 4.6 Personalization Learning (post-MVP)
Feedback table is scaffolded; not wired. Shortlist (localStorage) is a lightweight precursor — venues a user shortlists are not yet fed back into scoring.

### 4.7 Linkouts
- **Reserve / Get tickets** (primary CTA on each card + detail modal). For dining, opens the Chope-style listing in `chope_url`. For events, opens the official ticket / info page in the same `chope_url` field — the field is dual-purpose by category. Confirmation sheet (BookingOverlay) shows category-aware copy ("Reserve at X" / "Get tickets for X") before the linkout fires.
- **Grab ride** (secondary CTA): `lib/grab-ride.ts` builds `grab://open?screenType=BOOKING&dropOffLatitude=<lat>&dropOffLongitude=<lng>&dropOffKeywords=<name>`. Mobile-only behaviour; desktop click is a no-op.
- **Share** (tertiary, iOS-style square-with-up-arrow icon): opens editable share modal with venue + time + address + GrabMaps location URL.

### 4.8 Shareable Plan Text
Default share text (editable):
```
{venue.name}
{scheduled_for, formatted}
{venue.address}
https://maps.grab.com/?position=<lat>,<lng>&zoom=17
```
No "date night" branding. The OG-image route (`/api/og/card`) is scaffolded but not wired — the simple text + link beats it for WhatsApp.

### 4.9 Cross-Recommendations
On the detail modal, after a card, surface the top 3 nearest venues from the **opposite** category within 6 km, as compact rows: thumb + name + distance. Tapping reopens the modal on that card.

- On a **dining** card → events nearby (label: "After your meal").
- On an **event** card → dining nearby (label: "Dine before this").

Distance is haversine; the neighbour pool is the current result set, so cross-recs respect the user's filters / weather / time.

### 4.10 Shortlist
Tap **☆ → ★** on any card to shortlist (icon button overlaid on the photo, top-right). Persisted to `localStorage['gabo:shortlist-v1']` as a string array of venue IDs. The **★ Shortlist** filter chip on the results page narrows to shortlisted venues only. Works without auth — a deliberate v1 simplification.

---

## 5. Out of Scope (v1 / v2)
Partner-facing app, account sharing, real-time scraping, true MRT/bus routing, push notifications, payment, rescheduling, magic-link auth, server-side personalization / feedback loop, PWA manifest.

**Schema divergence** to fix before enabling Supabase auth: `profiles.vibe_default` + `budget_band` are singular in the migration; code uses arrays.

---

## 6. Data sources — what's real, what's still simulated

GrabMaps was retired post-hackathon. The product now runs on real, public,
free APIs everywhere it can:

| Surface | Source | Real? |
|---|---|---|
| Drive ETAs + route geometry | OneMap `/api/public/routingsvc/route?routeType=drive` | Real |
| Public-transit ETAs | OneMap `/api/public/routingsvc/route?routeType=pt` (lazy on toggle) | Real |
| Address / POI search | OneMap `/api/common/elastic/search` | Real |
| Map tiles | OpenStreetMap raster | Real |
| Weather | NEA rainfall forecast | Real (already was) |
| Trending score | Reddit mention count (r/singapore + r/SingaporeEats + r/SingaporeFoodPorn) past 7d, hybrid-weighted with internal shortlist-velocity from `shortlist_events` | Real |
| Reservation deep-link | `chope_url` if set, else Google Search fallback (`<name> singapore reservation/tickets`) | Real |
| **Dining venues** | Three-layer pipeline: (1) Google Places (New) Text Search → (2) Foursquare fallback per query when Google fails → (3) editorial blog scanner (Sethlui food-section RSS, Daniel Food Diary HTML category, Miss Tam Chiak sitemap, Ladyironchef RSS, The Smart Local Food category RSS) feeding Gemini Flash extraction. Quality-filtered (Google rating ≥ 4.0 with ≥ 100 ratings on the API path; blog path validates addresses against OneMap). | Real |
| **Events: theatre / dance / music / festivals at Esplanade** | `lib/sources/esplanade.ts` — sitemap.xml → `/whats-on/{year}/{slug}` URLs → JSON-LD `@type: Event` parse on each page (`startDate`, `endDate`, `name`, `image` server-rendered). Single fixed venue (1 Esplanade Drive). | Real |
| **Events: exhibitions / pop-ups** | Live HTML scrapers for SAM (`/art-events`) and NGS (`/whats-on`); Gemini-grounded coverage of ArtScience / NHB / Gardens via `lib/sources/museum-agent.ts`; one-off editorial layer (`source='editorial'`, mandatory `source_url`) for venues with no scraper or API | Real |
| **Events: TSL "Things To Do"** | `lib/sources/tsl-events.ts` — TheSmartLocal WP REST API (`/wp-json/wp/v2/posts?categories=13620`) → article HTML → Gemini Flash extraction returning a single date-bounded event per article (rejects listicles and ongoing-attraction posts) → OneMap address validation | Real |
| **Events: indie shops / lifestyle / night activities** | `lib/sources/blog-scanner.ts` running TSL Things-to-Do RSS (`/category/things-to-do/feed/`) through an experience-aware Gemini prompt → extracts pop-ups, fairs, light shows, indie bookstores, attractions, workshops, sport experiences, festivals. Rows are persisted with `cuisine_tags=['experience', ...]` so the planner classifies them as events, with experience-typed default hours (most venues open until 22:00). Same weekly cron as the dining blog scanner. | Real |

### 6.1 Provenance — `venues.source`
Every row carries `source` ∈ {`google_places`, `foursquare`, `museum`, `editorial`, `manual`}, with `source_id` (upstream's stable ID) and `source_url` (public page anyone can verify). (Historical: `source='bandsintown'` rows existed pre-removal; any stragglers in the DB should be purged on next reseed.) Editorial rows are CHECK-constrained to require `source_url`. The UI surfaces "via Google" / "via Foursquare" / "official venue page" / "editor's pick" on every card per Google + Foursquare TOS, and recognised editorial hosts get specific labels ("via Seth Lui", "via The Smart Local", "via Esplanade", etc.) so users can tell sources apart at a glance.

`source = 'manual'` rows are the legacy hand-seeded catalog — wiped on first run of `/api/admin/reseed`.

### 6.2 Editorial scanner — dining + experiences
`lib/sources/blog-scanner.ts` (run weekly via `/api/cron/sync-blogs`) covers two layers: dining (new openings + stopgap general catalog while the API providers are blocked) and experiences (pop-ups, indie shops, night activities, festivals, attractions). Each blog config carries a `kind: 'dining' | 'experience'` field that selects the matching Gemini prompt and row shape. Pipeline per blog:

1. **Article discovery** — strategy depends on what each blog publishes:
   - Sethlui (food-section RSS, dining), Ladyironchef (RSS, dining), and The Smart Local Food category (RSS at `/category/food-things-to-do/feed/`, dining) — classic feeds. TSL articles cover roundups ("16 New Cafes & Restaurants in May 2026") and single-venue reviews; the dining extractor handles both shapes via the same "single review OR roundup" prompt.
   - The Smart Local Things-to-Do (RSS at `/category/things-to-do/feed/`, experience) — same RSS shape as the food feed, different Gemini prompt and row shape. Output rows carry `cuisine_tags=['experience', ...]` so the planner's `isEvent()` classifies them as events.
   - Daniel Food Diary (dining) — `/feed/` is permanently broken upstream, so we scrape `/category/singapore/` HTML for `/YYYY/MM/DD/slug/` URLs (pubDate from path).
   - Miss Tam Chiak (dining) — Gatsby SSG with no RSS plugin; we read `sitemap-0.xml`, trust newest-first ordering, filter out category/tag/page archives.
   90-day lookback (where pubDate is available); per-blog cap of 25 articles per run.
2. **Article fetch** — cheerio strips nav/footer/ads, collects every `<img>` URL inside the article body for grounded photo selection.
3. **Gemini extraction** — one Gemini Flash call per article. Dining blogs return a venue array with: name/address/cuisine_tags/vibe_tags, `is_new_opening` + `opens_at`, `is_limited_run` + `ends_at` (pop-ups / residencies / chef takeovers), `is_award_winner` + `award_name` (Michelin / Asia's 50 Best / World Gourmet / Tatler Dining), `accepts_reservations`, `alcohol_free` (tri-state — when `true`, `dietary_flags` carries `'alcohol_free'`, which feeds the `no_alcohol` override; `false`/`null` leave the flag absent). Experience blogs return an experience array with: name/address, `experience_tags` from a separate vocabulary (art, exhibition, music, theatre, nightlife, shopping, bookstore, market, pop_up, fair, workshop, class, wellness, games, sport, nature, outdoor, family), vibe_tags, `starts_at` + `ends_at` for time-limited events, `opens_at` for new permanent venues, `is_outdoor` so the planner can hide outdoor experiences on rainy evenings. **Photo URL is constrained to the cheerio-collected set** to defend against URL hallucination on roundup posts.
4. **Address validation** — `resolveAddress` tries `{name} {cleaned address}` (unit numbers stripped), then cleaned address alone, then 6-digit postal code, then venue name as last resort. Coords must fall inside the SG bounding box.
5. **Upsert** — `source='editorial'`, `source_id={blog-prefix}-{slug}`. Per-venue badge is the highest-priority signal that applies, in order: `closing_soon` (is_limited_run + future ends_at) → `soft_launch` (is_new_opening + opens_at) → `award_fresh` (is_award_winner + award_name) → `none`. `hours_json` uses the Gemini-extracted weekly hours when the article stated them in a parseable form (`badge_meta.hours_source = 'extracted'`); otherwise it falls back to cuisine-aware defaults (bar 17:00–24:00, cafe 09:00–21:00, default dining 11:30–22:30, all 7 days) with `badge_meta.hours_source = 'default'`. `dietary_flags` carries `'alcohol_free'` when the article was explicit (no inference from cuisine alone).
6. **Cross-blog critic_pick pass** — after upsert, the scanner reloads the editorial catalog, groups rows by case-normalised name, counts distinct blog prefixes per group, and promotes rows with ≥3 distinct blogs to `badge='critic_pick'` (preserving `closing_soon` / `soft_launch` rows). `badge_meta.source` lists the contributing blogs. When a group's count drops below the threshold, rows are demoted to `award_fresh` (if award metadata is still present) or `none`.
7. **Aging** — at the start of each run, time-sensitive badges are aged out: `soft_launch` after 90 days without a fresh mention, `award_fresh` after 365 days, `closing_soon` once `badge_meta.ends_at` is in the past.

Cross-blog dedup is not applied at the catalog level — keeping per-blog rows is what lets the post-upsert `critic_pick` pass count distinct blog mentions. Dedup happens **at planner output** (`bucketByCategory`): rows are grouped by normalised name + ~200 m coordinate bucket and only the highest-scoring row survives. `badge_meta.source` on that row already lists every contributing blog, so the user-facing "Critic's pick" label is unaffected.

### 6.3 Parked follow-ups
- **Sistic scraping** — would cover ~70% of paid SG events. Held back pending TOS review.
- **STB Tourism Information Hub** — closed to non-tourism-trade applicants (we can't register).
- **Generic photo fallback** is in place (`lib/photo-fallback.ts` + 4 SVGs in `public/img/fallback/`), so venues without a photo (and venues where the source URL fails to load) render a category-typed placeholder rather than a blank tile.

**Recently shipped (was parked):**
- **Cross-blog dedup** — planner-side dedup by normalised name + ~200 m coordinate bucket; the highest-scoring row wins. Multi-blog `badge_meta.source` is preserved so the "Critic's pick" label still names every contributing blog.
- **Gemini hours extraction** — blog scanner now asks Gemini for parsed weekly hours from the article body. When present and validly shaped (`{ mon: [{open, close}], … }` with HHMM strings), `hours_json` carries the extracted hours and `badge_meta.hours_source = 'extracted'`. Falls back to cuisine-typed defaults (`hours_source: 'default'`) when the article doesn't state hours.

### 6.4 Current operational state (2026-05)
The API-provider layer of §6 is currently degraded; the blog scanner is the sole active dining source until these are fixed:

- **Google Places** returns `403 API_KEY_HTTP_REFERRER_BLOCKED`. The API key has HTTP-referrer restrictions in GCP that block server-to-server calls (which always have an empty Referer). Fix: in GCP Console → Credentials, change "Application restrictions" to "None" or to "IP addresses" with Vercel's egress IPs allowlisted. Then enable Places API (New) on the project if it isn't already.
- **Foursquare** returns `402 No API credits remaining`. The freePro tier is exhausted. Fix: top up at https://foursquare.com/developers/orgs. The client itself is on the new `places-api.foursquare.com` host (the legacy v3 endpoint was deprecated in 2024).
- **Bandsintown** concert source has been removed. Its Data Applications Terms (https://corp.bandsintown.com/data-applications-terms) restrict API access to "artists, or people working in connection with or on behalf of artists" and explicitly forbid uses that "aggregate, in any way, any Bandsintown Content with third party content (without distinction)" — both of which Gabo violates as a consumer date planner blending events from multiple sources. The terms also limit caching to session-only with notification, which is incompatible with our daily Supabase upsert pipeline. No replacement concert source has been wired in; Sistic remains parked pending TOS review.
- **Gemini model deprecation**: `gemini-2.0-flash` is no longer available to new users. All call sites (blog scanner, museum agent, plan eval) are now on `gemini-2.5-flash`.

---

## 7. Data confidence
Estimated routing, defaulted opening hours and search-fallback booking links must be understandable at the point of decision (R4–R5). Documenting them only here is insufficient. Missing provenance disclosure remains a release gap; do not claim all venues or journeys are verified.

---

## 8. OneMap Integration Surface
GrabMaps is gone. OneMap replaces it for everything routing/search:

1. **POI search** — `/api/places/search` → OneMap `/api/common/elastic/search`. Used by `PlaceSearchInput` for optional start-point inputs.
2. **Drive routing** — `lib/onemap/client.ts#fetchDriveRoute` → OneMap routing in `drive` mode. Returns `duration_sec`, `distance_m`, GeoJSON `LineString` (decoded from Google polyline). Used by `lib/planner/plan-date.ts` to compute fairness ETAs.
3. **Public-transit routing** — `lib/onemap/client.ts#fetchTransitRoute` → OneMap routing in `pt` mode. Used by `/api/transit-eta` which `FairnessPill` calls lazily when the user toggles to 🚆 mode. **Transit is the default ETA mode on the results page** — most SG date-night users take the MRT, and the per-card driving ↔ transit toggle plus the global Times toggle remain available for the minority who want to compare. Replaces the previous `simulatedMrtEta` formula; the formula is kept as a fallback when transit lookup fails or required context is missing. The pill labels each ETA with the corresponding **start point name** (truncated to 18 chars with an ellipsis) when one was supplied, falling back to the onboarding planner / partner name and finally to "You" / "Partner".
4. **Prewarm** — `/api/prewarm` seeds the OneMap drive-route cache (`lib/onemap/cache.ts`) for popular start points × catalog.
5. **Auth** — `lib/onemap/client.ts#getToken` exchanges `ONEMAP_EMAIL` + `ONEMAP_PASSWORD` for a 3-day JWT, cached in-memory and refreshed on 401 / near-expiry.

Map tiles are OSM raster (`lib/map-style.ts#osmStyle`) — not OneMap, since
their tile API also requires the JWT and OSM is sufficient for the demo.

---

## 9. Trending refresh

`lib/trending/refresh.ts` recomputes `venues.trending_score` from two real
signals, rewritten weekly by `/api/cron/trending` (Vercel Cron config in
`vercel.json`, runs Mon 04:00 UTC):

1. **External buzz** — Reddit mention count past 7d per venue across
   r/singapore + r/SingaporeEats + r/SingaporeFoodPorn (`lib/trending/reddit.ts`).
2. **Internal velocity** — count of shortlist additions past 7d from
   `shortlist_events` (Supabase table, anonymous, logged via
   `/api/shortlist-event`).

Both are min-max normalised across the catalog and combined. The Reddit
weight is 0.8 in cold-start (until total shortlist events ≥ 25 catalog-wide),
then drops to 0.4 once internal data is meaningful.

Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/trending`.

---

## 10. Personalisation — shortlist affinity

The plan request now includes `shortlist_ids: string[]` (read from
`localStorage['gabo:shortlist-v1']`). `lib/planner/plan-date.ts#applyShortlistAffinity`
looks up the cuisine and vibe tags of saved venues and merges them into a
working `Profile` for that plan. Effect: venues sharing tags with the
user's shortlist get the same `matchScore` boost as their explicit
preferences. Cuisines that the user has explicitly avoided are not added.

### 10.1 Longitudinal Taste Memory (F5, Default-On, Flag Opt-Out)

Beyond the stateless shortlist affinity above, the taste model
(`lib/taste-memory.ts`, gated by `NEXT_PUBLIC_AGENTIC_TASTE_ENABLED`) keeps a
**persistent, signed** log of taste signals in `localStorage['gabo:taste-events-v1']`:

- **Save (+1)** — shortlisting a card records a positive event over its cuisine + vibe tags.
- **"Not for us" (−1)** — a skip control on each result card records a negative
  event over the same tags and hides the card from the results (list, map, counts).

Signals aggregate into one **signed, recency-weighted** weight per tag (60-day
half-life), so a skip subtracts what a same-day save would add. Net-positive tags
above the floor enrich the working profile (additive — never overriding explicit
choices); skips therefore **suppress promotion** but, by design, never feed the
**hard `cuisines_avoided` filter** (inferred taste must not be able to empty a
result set). A small **"Leaning…"** hint on the form explains the inference.

**LLM narration (optional, `AGENTIC_TASTE_NARRATE_ENABLED`).** When enabled, the
hint is reworded by `flash-lite` via `/api/taste/narrate` into one warmer line
(e.g. *"Cozy Japanese and Italian nights are always a hit"*). Privacy: only the
**aggregated top tags** — the same ones the deterministic hint already shows —
leave the device; the raw event log never does. The call is non-blocking and
degrades to the deterministic template on any failure, so the feature is
local-first by default and the narration is a thin, optional copy layer.
