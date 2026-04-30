@AGENTS.md

# Gabo (codename "Fair & Fresh")

Date-night planner for dual-income Singapore households. Originally built for the GrabMaps API Hackathon; **post-hackathon, GrabMaps has been retired and OneMap powers all routing/search**. Full spec in [Gabo_prd.md](Gabo_prd.md). Design notes in [DESIGN.md](DESIGN.md).

## Stack
Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4 + Supabase (Postgres + RLS). Read [AGENTS.md](AGENTS.md) — Next.js 16 has breaking changes; check `node_modules/next/dist/docs/` before writing Next-specific code.

## Current build state
- Supabase live, 53 venues seeded via `scripts/seed-supabase.mjs` (idempotent: deletes + reseeds). Catalog still hand-curated; replacement with Google Places + Foursquare for dining and Sistic + museum sites + Bandsintown + editorial for events is parked.
- Onboarding auto-skipped on first visit (empty profile written). Profile persists to `localStorage['gabo:profile-v2']`.
- **Planner-first home**: form is the hero, recs feed below as a tasting strip ("Right now in Singapore", capped to 3 cards × 3 sections).
- Form: When (required) + two optional `PlaceSearchInput` fields (OneMap, pre-filled from `localStorage['gabo:last-starts-v1']`) + Special Occasion behind a disclosure.
- Weather auto-fetched server-side from NEA (`lib/weather.ts`); outdoor venues excluded on rain days.
- Results: tabs (Dining / Events) + filter chips (All / Recommended / Limited / New / Saved) + List ↔ Map toggle. Empty states offer concrete actions (clear filter, switch tab, edit search).
- Tap a card → `VenueDetailModal`: full hours, badge meta, profile-match highlights, OSM mini-map, cross-recs.
- Cards use the shipped CTA pair: dark `stone-900` primary ("Reserve" / "Get tickets") + outlined "Directions" → Google Maps. Body copy uses real signal (`ends 15 May`, `opened 7 weeks ago`, etc) from `badge_meta`.
- Booking link falls back to Google Search when `chope_url` is the placeholder pattern (`lib/booking-url.ts`).
- **OneMap** powers POI search + drive routing + (lazy) public-transit routing. `lib/onemap/client.ts`. Token cached in-memory, refreshed on 401. 1h drive cache, 30m transit cache.
- **Trending is real**: Reddit mentions hybrid-weighted with internal shortlist velocity, recomputed weekly by `/api/cron/trending` (Vercel Cron, Mon 04:00 UTC). Anonymous shortlist events logged to `shortlist_events` via `/api/shortlist-event`.
- **Shortlist affinity** wired into scoring: plan request includes `shortlist_ids`, `applyShortlistAffinity` augments cuisine/vibe preferences from saved venues.
- Map tiles: OpenStreetMap raster (`lib/map-style.ts`).

## Project layout
- `app/page.tsx` — single-page container; state machine for form → loading → results
- `app/api/plan/` — plan handler: Supabase query → local filters → prescore cap → parallel OneMap drive routing → score → bucket
- `app/api/places/search/` — OneMap POI search (used by `PlaceSearchInput`)
- `app/api/transit-eta/` — lazy public-transit routing (called by `FairnessPill` on 🚆 toggle)
- `app/api/prewarm/` — warms OneMap drive cache for popular start points
- `app/api/shortlist-event/` — anonymous logger feeding internal trending velocity
- `app/api/cron/trending/` — weekly trending refresh (`refreshTrendingScores`)
- `app/api/recommendations/` — pre-search editorial recs feed
- `components/` — `PlanDateForm`, `PlaceSearchInput`, `PlanCard`, `FairnessPill`, `RecommendationsFeed`, `ResultsView`, `VenueDetailModal`, `BookingOverlay`, `WhatsAppShareModal`, `OverviewMap`, `VenueMiniMap`
- `lib/onemap/` — `client.ts` (auth, search, drive, pt routes), `cache.ts`
- `lib/trending/` — `reddit.ts`, `refresh.ts`
- `lib/planner/` — `types.ts`, `hours.ts` (cross-midnight aware), `score.ts`, `plan-date.ts` (incl. `applyShortlistAffinity`)
- `lib/booking-url.ts` — chope_url → Google Search fallback
- `lib/directions.ts` — Google Maps directions URL builder
- `lib/map-style.ts` — OSM raster style
- `lib/venues/catalog.ts` — 53 venues; source of truth for `seed-supabase.mjs` (planned to be replaced by live data sources)
- `lib/profile-storage.ts`, `lib/shortlist-storage.ts` — localStorage helpers
- `supabase/migrations/` — `0001_gabo_schema.sql`, `0002_venues_public_read.sql`, `0003_shortlist_events.sql`
- `scripts/audit-chope-urls.mjs` — probe each catalog `chope_url` for liveness; outputs CSV
- `vercel.json` — cron config (weekly trending refresh)

## Stack gotchas
- **OneMap auth**: tokens are 3-day JWTs from `POST /api/auth/post/getToken` with email+password. Cached in `lib/onemap/cache.ts`. Refresh on 401.
- **OneMap routing coords are `lat,lng`** (different from the GrabMaps `lng,lat` convention we used to follow).
- **Supabase public tables need an RLS policy even if the grant is there.** `grant select to anon` alone isn't enough; PostgREST blocks reads until RLS is enabled with a permissive SELECT policy (see `0002_venues_public_read.sql`).
- **shortlist_events writes** use the anon key but RLS allows insert-only. Reads only happen from the cron via service role.

## UX preferences — already learned, don't ignore
(See also `feedback_ux_patterns.md` in memory.)
- **No fixture names** ("Alex"/"Sam" etc) in the UI. Only show real names captured from onboarding; fallback is "You"/"Partner".
- **No public demo-disclosure surfaces** — no About modal, no inline "this is simulated" callouts.
- **Time-agnostic copy** — "Plan a date night", not "Plan tonight".
- **Multi-select by default** for preferences; **skip buttons** on every onboarding step; **free-form text fallback** when chips might not cover the user's case.

## Outstanding simulation
The venue catalog (`lib/venues/catalog.ts` → Supabase) is hand-curated. Specific exhibition venues are real but their `ends_at`, `opened`, and `badge_meta` are seeded, not pulled from a source. Two parked overhauls:
1. **Dining** → Google Places API (free $200/mo credit) → Foursquare fallback. Per-venue `source` displayed in UI.
2. **Events** → Sistic scraping + direct museum sites (ArtScience, NHB, National Gallery, SAM) + Bandsintown API + editorial layer (`source='editorial'`, mandatory `source_url`).

## Secrets
- `.env.local`: `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_*` mirrors. Optional: `CRON_TOKEN` (gates `/api/cron/trending`), `PREWARM_TOKEN`. Never commit. The old `GRABMAPS_API_KEY` is no longer used.

## Out of scope for v1
Partner-facing app, account sharing, push notifications, payment, rescheduling, magic-link auth (deferred — localStorage profile works for demo).

## Known follow-ups
- Replace seeded venue catalog with live data (see Outstanding simulation above).
- Schema alignment: `profiles` table still has singular `vibe_default` + `budget_band`; code uses arrays. Migration needed if we persist to DB (currently localStorage only).
- `no_alcohol` override unwired (needs `alcohol_free` dietary flag).
- PH (public holiday) hours override is TODO in `lib/planner/hours.ts`.
