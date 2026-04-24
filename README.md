# Gabo — Date Planner

A 60-second date-night planner for dual-income couples in Singapore.

Time-strapped planners spend ~30 minutes per date night juggling tabs to find places that are open, fresh, and fair to both commutes. Gabo compresses that into a single tap: a curated shortlist of venues and experiences where the ETA from each partner's starting point is close enough to feel fair — with pop-ups, new openings, and critic picks surfaced alongside the usual suspects.

## What's inside

- **Onboarding** (one-time): name, cuisines loved/avoided, dietary hard-stops, vibes, budgets. Persists to `localStorage`.
- **Plan form**: two POI-search inputs (GrabMaps), datetime, optional Special Occasion chips. Weather auto-fetched from NEA — outdoor venues drop out on rain days.
- **Results**: 3 horizontal snap-scroll rows (Easy yes / A small detour / Worth the leap), up to 3 cards each. Toggle to a full **Overview Map** with all 9 picks pinned and color-coded by bucket.
- **Per-card transit toggle** (🚗 Driving / 🚆 Transit) — instant, no re-plan.
- **Detail modal** with opening hours, badges, profile-match highlights, and an embedded **GrabMaps mini-map** showing the venue pin + both partners' pinned start points + the actual driving route polylines for each leg.
- **Grab ride deep-link** on every card → opens the Grab app with the venue pre-filled as drop-off.
- **Share modal**: editable text copy pre-filled with venue, time, address, and a GrabMaps location link.

## GrabMaps integration (hackathon focus)

GrabMaps is load-bearing, not cosmetic:

1. **POI search** powers the start-point inputs (`/api/places/search` → `/maps/poi/v1/search`).
2. **Directions API** computes fairness (2 calls per candidate) and supplies the GeoJSON route geometry reused on the mini-map.
3. **Style + tiles** render both the detail mini-map and the full-screen overview map via MapLibre. A single **backend proxy** (`/api/grabmaps/proxy?u=<encoded>`) brokers style.json, tiles, sprites, and glyphs so `GRABMAPS_API_KEY` never reaches the browser — mandatory under the hackathon rules. MapLibre's `transformRequest` rewrites every `maps.grab.com` URL to the proxy and returns absolute URLs so tile workers can resolve them.
4. **Prewarm** endpoint (`/api/prewarm`) seeds the 1-hour in-memory direction cache for common start pairs so first-plan latency stays under 5s.

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **Tailwind v4**
- **Supabase** (Postgres + RLS) for the venue catalog
- **MapLibre GL** for rendering GrabMaps tiles
- **`next/og`** for the shareable pick-card image (scaffolded at `/api/og/card`)

## Catalog

53 hand-curated venues: **41 eateries** covering all major cuisines + budget bands across Singapore, and **12 experiences** (ArtScience Museum, Van Gogh: The Immersive Experience, Gardens by the Bay, Night Safari, Timbre X S.E.A., Lockdown SG escape rooms, etc.). Badges surface pop-ups (`closing_soon`), new openings (`soft_launch`), and top-tier spots (`critic_pick`, `award_fresh`).

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env.local
# Fill in: GRABMAPS_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

# 3. Set up Supabase
# Run migrations in supabase/migrations/ against your project, then:
node --experimental-strip-types scripts/seed-supabase.mjs

# 4. Run
npm run dev
# → http://localhost:3000

# 5. (optional) Warm the direction cache before a demo
curl http://localhost:3000/api/prewarm
```

## Project layout

```
app/
  page.tsx                       Single-page state machine
  api/
    plan/                        Plan handler: filter → prescore → route → score → bucket
    places/search/               GrabMaps POI search proxy
    grabmaps/
      proxy/                     Backend proxy for style, tiles, sprites, glyphs
      route-matrix/              Single origin→destination lookup for client
    prewarm/                     Warms the direction cache
    og/card/                     Shareable pick card image (next/og)

components/
  OnboardingQuiz.tsx             4-step multi-select onboarding
  PlanDateForm.tsx               Start-points + datetime + occasion
  PlaceSearchInput.tsx           GrabMaps POI combobox
  ResultsView.tsx                3-row snap-scroll results + List/Map toggle
  PlanCard.tsx                   Single venue card with tappable affordance
  FairnessPill.tsx               Per-card 🚗 / 🚆 transit toggle
  VenueDetailModal.tsx           Full details + embedded mini-map
  VenueMiniMap.tsx               MapLibre + GrabMaps tiles + route polylines
  OverviewMap.tsx                Full-screen overview with all 9 pins
  WhatsAppShareModal.tsx         Editable text share with GrabMaps link

lib/
  planner/
    types.ts                     Core types + TransitMode
    hours.ts                     Cross-midnight aware open/closed check
    score.ts                     Prescore, score, bucket
    plan-date.ts                 Planner orchestration
  grabmaps/
    direction.ts                 Direction API call (GeoJSON geometry)
    cache.ts                     1-hour in-memory cache
  grab-ride.ts                   Grab app deep-link helper
  weather.ts                     NEA rainfall forecast
  venues/catalog.ts              53-venue seed source of truth

supabase/migrations/
  0001_gabo_schema.sql
  0002_venues_public_read.sql    RLS policy for anon read

scripts/
  seed-supabase.mjs              Idempotent: deletes + reseeds venues
```

## Hackathon simulation boundary

Three layers are simulated (not live integrations) and disclosed only here:

- **MRT ETA**: derived client-side as `round(driving × 1.4) + 5`. GrabMaps Routing doesn't expose SG transit modes.
- **Trending score**: seeded manually per venue at curation time; no live feed.
- **Chope deep-link**: placeholder pattern — not verified against real Chope rIDs. The functional "how do I get there?" flow uses the **Grab ride deep-link**, which is real.

Everything else (fairness, routing geometry, POI search, map tiles, weather, venue filters, scoring, bucketing) is live.

## See also

- [Gabo_prd.md](Gabo_prd.md) — full product spec and design decisions
- [SKILL.md](SKILL.md) — GrabMaps API reference used throughout
- [AGENTS.md](AGENTS.md) — note to AI collaborators: Next.js 16 has breaking changes
