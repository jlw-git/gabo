# Gabo

A 60-second date-night planner for busy couples in Singapore.

Time-strapped planners spend ~30 minutes per date night juggling tabs to find places that are open, fresh, and fair to both commutes. Gabo compresses that into a single tap: a curated shortlist of dining and events where each partner's ETA feels fair — with pop-ups, new openings, and critic picks surfaced alongside the usual suspects.

> Originally built for the GrabMaps API Hackathon. **Post-hackathon, GrabMaps has been retired** — [OneMap](https://www.onemap.gov.sg/) (Singapore Land Authority) now powers all POI search and routing.

## Is Gabo AI?

Yes — but precisely, and less than the `lib/agents/` folder name suggests. Gabo is a **deterministic planner with LLM help at the seams**. The decision a user actually sees — *which* venues appear and *in what order* — is pure rules-based code (fairness math, hard filters, weighted scoring, bucketing). No LLM scores or ranks venues in the default configuration. Every LLM call is **Gemini** (no Claude/Anthropic in the runtime), and **every one is a single-shot call** — none plan, loop, or chain tool calls. The honest framing: "agentic" here is mostly a naming convention.

The model tier for each task is centralised in `lib/agents/models.ts` (extraction → `gemini-2.5-flash`; verify / copy / triage / rank → `gemini-2.5-flash-lite`). Every call is wrapped by `lib/agents/runner.ts` for observability (logged to `lib/agents/run-log.ts`, visible at `/admin/agents`).

There are **9 LLM touchpoints + a triage step**, split across two surfaces. The only ones that reach outside their prompt (Gemini **with Google Search grounding**) are the museum agent and the verifiers — and those run exclusively in cron ingestion, never on a user's plan request.

#### Cron ingestion (off the user's latency path)

| Touchpoint | Model | Behavior |
|---|---|---|
| Blog / experience extraction — `lib/sources/blog-scanner.ts` | flash | single-shot: blog prose → structured venue records (cuisine, vibe, price, address, hours) |
| Blog-extraction verifier — `lib/agents/verifiers/blog-extraction.ts` | flash-lite | single-shot judge: pass / soft-flag / hard-reject |
| Museum discovery — `lib/sources/museum-agent.ts` | flash **+ Search** | grounded search for current/upcoming exhibitions |
| Museum-extraction verifier — `lib/agents/verifiers/museum-extraction.ts` | flash-lite (+Search) | grounded single-shot judge |
| Freshness verifier — `lib/agents/verifiers/freshness.ts` | flash-lite **+ Search** | grounded judge; writes `active=false` / badge annotations to Supabase |
| TSL event extraction — `lib/sources/events-sync.ts` (TSL path only) | flash | single-shot extraction |

#### Per-request (`/api/plan`)

| Touchpoint | Model | Behavior |
|---|---|---|
| Triage — `lib/agents/triage.ts` (via `/api/plan/triage`) | flash-lite | single-shot intent parse + OneMap place resolution; **only when the user typed freeform text** |
| Relaxation — `lib/agents/relaxation.ts` | flash-lite | suggests which soft constraints to drop; **gated by `AGENTIC_PLAN_ENABLED`, and only after a deterministic widening pre-pass fails** |
| Tolerance-band ranker — `lib/agents/ranker.ts` | flash-lite | suggests a reorder; **gated by `AGENTIC_RANKER_ENABLED`**, output clamped by deterministic guardrails (±3 positions max) |
| Per-venue "why this fits you" copy — `lib/planner/gemini-eval.ts` | flash-lite | single-shot prose, top ~10 cards, 8s timeout + empty-map fallback (non-blocking) |

> The two per-request "agents" (relaxation, ranker) are **feature-flagged off by default**, and even when on they're single-shot with deterministic clamps deciding the final result. `lib/agents/models.ts` is a model registry — config, not an agent.

### LLM vs rules-based — full split

| Layer | What handles it |
|---|---|
| Catalog ingestion (dining + experiences) from blog prose | **Gemini flash** — `lib/sources/blog-scanner.ts`, then verified by **flash-lite** |
| Hours extraction from article body | **Gemini flash** — same extractor; falls back to cuisine-typed defaults when the article doesn't state hours |
| Museum / exhibition discovery | **Gemini flash + grounded search** — `lib/sources/museum-agent.ts` |
| Catalog freshness re-check (trending venues) | **Gemini flash-lite + grounded search** — `lib/agents/verifiers/freshness.ts` |
| Freeform intent parsing (when given) | **Gemini flash-lite** — `lib/agents/triage.ts` |
| Constraint relaxation on thin results | **Deterministic pre-pass first**, then optional **flash-lite** (flagged) — `lib/agents/relaxation.ts` |
| Reordering within a bucket | **Optional flash-lite suggestion + deterministic clamp** (flagged) — `lib/agents/ranker.ts` |
| Per-venue "why this fits you" copy on each card | **Gemini flash-lite** — `lib/planner/gemini-eval.ts` |
| Hard filters (hours/PH-aware, dietary, weather, budget, run window) | **Rules** — `lib/planner/plan-date.ts`, `lib/planner/hours.ts` |
| Fairness / match / freshness / friction scoring | **Rules** — `lib/planner/score.ts` |
| Trending score (Reddit + shortlist velocity) | **Statistical** — `lib/trending/refresh.ts` |
| Cross-blog dedup, card bucketing, filter-chip predicates | **Rules** — `lib/planner/score.ts`, `app/page.tsx` |
| Routing + ETAs | **OneMap** (drive + public-transit APIs) |

Rule of thumb: **LLM where the input is unstructured prose or the output is human-facing copy; rules where the input is structured data and the output is a user-visible decision.** Even the "agentic" reordering/relaxation steps keep the final, user-visible call in deterministic code.

## What's inside

- **Planner-first home**: the form is the hero. A "Right now in Singapore" tasting strip (capped to 3 cards × 3 sections) sits below for browsing.
- **Plan form**: When (required) + two optional OneMap POI-search inputs (pre-filled from the last session) + a Special Occasion disclosure. Weather auto-fetched server-side from NEA — outdoor venues drop out on rain days.
- **Onboarding** (auto-skipped on first visit, editable later): cuisines loved/avoided, dietary hard-stops, vibes, budgets. Persists to `localStorage`.
- **Results**: Dining / Events tabs + filter chips (All / Critics' picks / Limited run / Just opened / ★ Shortlist) + List ↔ Map toggle. Empty states offer concrete actions.
- **Venue detail modal**: full hours, badges, profile-match highlights, OSM mini-map, cross-recs.
- **CTAs**: dark "Reserve" / "Get tickets" + outlined "Directions" → Google Maps. Booking falls back to a Google Search when the venue has no live Chope rID.
- **Shortlist affinity**: saved venues feed back into scoring on the next plan.
- **Trending is real**: weekly Reddit mentions hybrid-weighted with internal shortlist velocity, recomputed by a Vercel Cron.

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **Tailwind v4**
- **Supabase** (Postgres + RLS) for venues, profiles, and shortlist events
- **OneMap** for POI search, drive routing, and (lazy) public-transit routing
- **MapLibre GL** + **OpenStreetMap** raster tiles
- **Gemini 2.5 Flash** for blog/museum ingestion and plan-reasoning copy

## Data sources

Dining and events are stitched from several feeds, with per-row `source` / `source_url` columns driving UI attribution:

| Domain  | Primary source                                      | Status |
|---------|-----------------------------------------------------|--------|
| Dining  | Google Places (New) → Foursquare fallback           | Both currently blocked (see below) |
| Dining  | Editorial blog scanner (Sethlui, DFD, MTC, Ladyironchef, TSL Food, Eatbook) | **Active stopgap** |
| Events  | Museum agent (NHB / ArtScience / Gardens by the Bay)| Active (monthly Gemini-grounded refresh) |
| Events  | Editorial scanner (TSL Things-to-Do, etc.)          | Active (weekly) |
| Concerts| —                                                   | No source yet — Bandsintown was removed (TOS restricts API access to artists/representatives) |

### Current API-provider state
- **Google Places** returns 403 `API_KEY_HTTP_REFERRER_BLOCKED` — server-to-server calls have an empty Referer; fix is to switch Application restrictions to "None" or IP-allowlist in GCP Console.
- **Foursquare** returns 402 — freePro tier out of credits; needs top-up.

Until one of those is restored, the blog scanner produces ~10–20 venues per weekly run with cuisine-aware default hours. See PRD §6.4.

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env.local
# Required: ONEMAP_EMAIL, ONEMAP_PASSWORD, GOOGLE_GEMINI_API_KEY,
#           SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#           NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
# Optional: GOOGLE_PLACES_API_KEY, FOURSQUARE_API_KEY, CRON_SECRET, PREWARM_TOKEN

# 3. Set up Supabase
# Run everything in supabase/migrations/ against your project.

# 4. Run
npm run dev
# → http://localhost:3000

# 5. (optional) Seed the catalog
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/admin/reseed
```

## Project layout

```
app/
  page.tsx                       Single-page state machine: form → loading → results
  api/
    plan/                        Plan handler: filter → prescore → OneMap routing → score → bucket
    places/search/               OneMap POI search (used by PlaceSearchInput)
    transit-eta/                 Lazy public-transit routing (FairnessPill 🚆 toggle)
    recommendations/             Pre-search editorial recs feed
    shortlist-event/             Anonymous logger feeding internal trending velocity
    prewarm/                     Warms OneMap drive cache for popular start points
    admin/reseed/                Full wipe + resync (gated by CRON_SECRET)
    cron/
      trending/                  Weekly: Reddit + internal velocity → trending scores
      sync-dining/               Weekly: Google Places → Foursquare
      sync-events/               Daily: editorial events
      sync-blogs/                Weekly: Gemini blog scanner
      sync-eatbook/              Weekly: Eatbook roundup sync
      sync-museums/              Monthly: Gemini-grounded museum agent

components/
  PlanDateForm, PlaceSearchInput, PlanCard, FairnessPill,
  RecommendationsFeed, ResultsView, VenueDetailModal,
  BookingOverlay, WhatsAppShareModal, OverviewMap, VenueMiniMap

lib/
  onemap/         client.ts (auth, search, drive, pt routes), cache.ts
  planner/        types, hours (cross-midnight aware), score,
                  plan-date (incl. applyShortlistAffinity), gemini-eval,
                  sg-time (Asia/Singapore-aware Date helpers), category
  sources/        google-places, foursquare, dining-sync,
                  editorial-events, events-sync, blog-scanner,
                  eatbook-rss, museum-agent, museum-scrapers
  trending/       reddit, refresh
  photo-fallback  4 cuisine-typed SVG placeholders + onError swap
  booking-url     chope_url → Google Search fallback
  directions      Google Maps directions URL builder
  map-style       OSM raster style
  weather         NEA rainfall forecast
  profile-storage, shortlist-storage

supabase/migrations/
  0001_gabo_schema.sql
  0002_venues_public_read.sql       RLS: anon SELECT on venues
  0003_shortlist_events.sql
  0004_venue_sources.sql            source / source_url columns
  0005_fix_source_unique_constraint.sql
  0006_accepts_reservations.sql

vercel.json                          Cron config (trending, dining, events,
                                     eatbook, museums, blogs)
```

## Out of scope for v1

Partner-facing app, account sharing, push notifications, payment, rescheduling, magic-link auth (localStorage profile works for now).

## See also

- [Gabo_prd.md](Gabo_prd.md) — full product spec
- [DESIGN.md](DESIGN.md) — design notes
- [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) — dev state and gotchas for AI collaborators (Next.js 16 has breaking changes — check `node_modules/next/dist/docs/` before writing Next-specific code)
