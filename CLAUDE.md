@AGENTS.md

# Gabo (codename "Fair & Fresh")

Date-night planner for dual-income Singapore households. Originally built for the GrabMaps API Hackathon; **post-hackathon, GrabMaps has been retired and OneMap powers all routing/search**. Full spec in [Gabo_prd.md](Gabo_prd.md). Design notes in [DESIGN.md](DESIGN.md).

## Stack
Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4 + Supabase (Postgres + RLS). Read [AGENTS.md](AGENTS.md) — Next.js 16 has breaking changes; check `node_modules/next/dist/docs/` before writing Next-specific code.

## Current build state
- Supabase live. Per-row `source`/`source_url` columns drive UI attribution. Hand-seeded `source='manual'` rows wiped via `/api/admin/reseed`.
- **Dining catalog** is meant to come from Google Places (with Foursquare fallback). **Both API providers are currently blocked** — Google Places returns 403 `API_KEY_HTTP_REFERRER_BLOCKED`, Foursquare returns 402 (out of credits). The blog scanner (Sethlui food-feed, DFD HTML, MTC sitemap, Ladyironchef, TSL Food) is the active stopgap until those keys are unblocked. See PRD §6.4.
- **Events catalog**: Bandsintown for concerts + Gemini-Flash museum agent for exhibitions (`lib/sources/museum-agent.ts`) + blog scanner running TSL Things-to-Do RSS through an experience-aware Gemini prompt for pop-ups, indie shops, festivals, attractions, workshops, sport activities. Experience rows carry `cuisine_tags=['experience', ...]` which the planner's `isEvent()` (`lib/planner/category.ts`) reads as the dining-vs-event discriminator.
- Onboarding auto-skipped on first visit (empty profile written). Profile persists to `localStorage['gabo:profile-v2']`.
- **Planner-first home**: form is the hero, recs feed below as a tasting strip ("Right now in Singapore", capped to 3 cards × 3 sections).
- Form: When (required) + two optional `PlaceSearchInput` fields (OneMap, pre-filled from `localStorage['gabo:last-starts-v1']`) + Special Occasion behind a disclosure.
- Weather auto-fetched server-side from NEA (`lib/weather.ts`); outdoor venues excluded on rain days.
- Results: tabs (Dining / Events) + filter chips (All / Recommended / Limited / Just opened / ★ Shortlist) + List ↔ Map toggle. Empty states offer concrete actions.
- Tap a card → `VenueDetailModal`: full hours, badge meta, profile-match highlights, OSM mini-map, cross-recs.
- Cards use the shipped CTA pair: dark `stone-900` primary ("Reserve" / "Get tickets") + outlined "Directions" → Google Maps. Body copy uses real signal (`ends 15 May`, `opened 7 weeks ago`, etc) from `badge_meta`.
- **Photo fallbacks**: 4 cuisine-typed SVGs in `public/img/fallback/` (`dining`/`bar`/`cafe`/`event`); `lib/photo-fallback.ts#photoUrlOrFallback` picks one when `photo_url` is null, with `onError` swap on `<img>` to also catch broken external URLs (Gemini-hallucinated, hotlink-blocked, 404).
- Booking link falls back to Google Search when `chope_url` is the placeholder pattern (`lib/booking-url.ts`).
- **OneMap** powers POI search + drive routing + (lazy) public-transit routing. `lib/onemap/client.ts`. Token cached in-memory, refreshed on 401. 1h drive cache, 30m transit cache.
- **Trending is real**: Reddit mentions hybrid-weighted with internal shortlist velocity, recomputed weekly by `/api/cron/trending` (Vercel Cron, Mon 04:00 UTC). Anonymous shortlist events logged to `shortlist_events` via `/api/shortlist-event`.
- **Shortlist affinity** wired into scoring: plan request includes `shortlist_ids`, `applyShortlistAffinity` augments cuisine/vibe preferences from saved venues.
- Map tiles: OpenStreetMap raster (`lib/map-style.ts`).
- **Gemini Flash** (`gemini-2.5-flash`) is used by 3 sites: blog scanner extraction, museum agent search, plan reasoning eval. The retired `gemini-2.0-flash` model name is gone.

## Project layout
- `app/page.tsx` — single-page container; state machine for form → loading → results
- `app/api/plan/` — plan handler: Supabase query → local filters → prescore cap → parallel OneMap drive routing → score → bucket
- `app/api/places/search/` — OneMap POI search (used by `PlaceSearchInput`)
- `app/api/transit-eta/` — lazy public-transit routing (called by `FairnessPill` on 🚆 toggle)
- `app/api/prewarm/` — warms OneMap drive cache for popular start points
- `app/api/shortlist-event/` — anonymous logger feeding internal trending velocity
- `app/api/cron/trending/` — weekly trending refresh (`refreshTrendingScores`)
- `app/api/cron/sync-dining/` — weekly dining catalog refresh (Google Places → Foursquare)
- `app/api/cron/sync-events/` — daily events catalog refresh (Bandsintown + editorial)
- `app/api/cron/sync-blogs/` — weekly editorial-blog scanner (Tue 09:00 UTC)
- `app/api/cron/sync-eatbook/` — weekly Eatbook roundup-style sync
- `app/api/cron/sync-museums/` — monthly museum-exhibition refresh (Gemini-grounded search)
- `app/api/admin/reseed/` — one-shot full wipe + resync (gated by CRON_SECRET)
- `app/api/recommendations/` — pre-search editorial recs feed
- `components/` — `PlanDateForm`, `PlaceSearchInput`, `PlanCard`, `FairnessPill`, `RecommendationsFeed`, `ResultsView`, `VenueDetailModal`, `BookingOverlay`, `WhatsAppShareModal`, `OverviewMap`, `VenueMiniMap`
- `lib/onemap/` — `client.ts` (auth, search, drive, pt routes), `cache.ts`
- `lib/trending/` — `reddit.ts`, `refresh.ts`
- `lib/sources/` — `google-places.ts`, `foursquare.ts` (new `places-api.foursquare.com` host), `dining-sync.ts`, `bandsintown.ts`, `editorial-events.ts`, `events-sync.ts`, `blog-scanner.ts` (per-blog `discover()`: RSS / HTML category / sitemap), `eatbook-rss.ts`, `museum-agent.ts`, `museum-scrapers.ts`
- `lib/planner/` — `types.ts`, `hours.ts` (cross-midnight aware), `score.ts`, `plan-date.ts` (incl. `applyShortlistAffinity`), `gemini-eval.ts` (per-venue reasoning copy)
- `lib/photo-fallback.ts` — `photoUrlOrFallback(card)` selects one of 4 SVG placeholders
- `lib/booking-url.ts` — chope_url → Google Search fallback
- `lib/directions.ts` — Google Maps directions URL builder
- `lib/map-style.ts` — OSM raster style
- `lib/venues/catalog.ts` — legacy 53-venue seed; no longer used by the app, kept until prod has been resynced and verified
- `lib/profile-storage.ts`, `lib/shortlist-storage.ts` — localStorage helpers
- `public/img/fallback/{dining,bar,cafe,event}.svg` — generic card images
- `supabase/migrations/` — `0001_gabo_schema.sql`, `0002_venues_public_read.sql`, `0003_shortlist_events.sql`, `0004_venue_sources.sql`, `0005_fix_source_unique_constraint.sql`, `0006_accepts_reservations.sql`
- `scripts/audit-chope-urls.mjs` — probe each catalog `chope_url` for liveness; outputs CSV
- `vercel.json` — cron config (trending, dining, events, eatbook, museums, blogs)

## Stack gotchas
- **OneMap auth**: tokens are 3-day JWTs from `POST /api/auth/post/getToken` with email+password. Cached in `lib/onemap/cache.ts`. Refresh on 401.
- **OneMap routing coords are `lat,lng`** (different from the GrabMaps `lng,lat` convention we used to follow).
- **Supabase public tables need an RLS policy even if the grant is there.** `grant select to anon` alone isn't enough; PostgREST blocks reads until RLS is enabled with a permissive SELECT policy (see `0002_venues_public_read.sql`).
- **shortlist_events writes** use the anon key but RLS allows insert-only. Reads only happen from the cron via service role.
- **`AbortSignal.timeout(N)` at module scope is a footgun.** The signal's clock starts at module-load time, not per-request. Reusing a module-level `signal` aborts every fetch once the module has been alive longer than `N` ms. Wrap in a function (`fetchOpts(): RequestInit { return { signal: AbortSignal.timeout(15_000) } }`) and call it per request.
- **`gemini-2.0-flash` is retired** — Google returns 404 "no longer available to new users". Use `gemini-2.5-flash` everywhere (blog scanner, museum agent, plan eval).
- **Foursquare migrated hosts**: legacy `api.foursquare.com/v3` was deprecated in 2024. Use `places-api.foursquare.com/places/search` with `Authorization: Bearer <key>` and an `X-Places-Api-Version: 2025-06-17` header. Field renames: `fsq_id` → `fsq_place_id`, `geocodes.main.{lat,lng}` → top-level `latitude`/`longitude`. 402 means the freePro tier is out of credits, not a bug.
- **Google Places 403 with empty Referer** = `API_KEY_HTTP_REFERRER_BLOCKED`. Server-to-server calls always have an empty Referer; in GCP Console, change the key's Application restrictions from "HTTP referrers" to "None" or to "IP addresses" with Vercel egress IPs.
- **Next.js prod build runs `tsc` strict; `next dev` (Turbopack) doesn't.** Type errors won't show locally during dev but will fail Vercel deploys. Run `npx next build` before pushing if you've touched API routes.
- **`Date#getDay`/`getHours`/`getMinutes` use the host timezone**, which is UTC on Vercel. The planner's hours filter and any per-day/per-hour bucketing must be evaluated in `Asia/Singapore` or a SGT lunch slot looks like 04:30 to the server and `isOpenAt` filters every venue out (returning the empty "Nothing fits this slot" state). Use the helpers in `lib/planner/sg-time.ts` (`sgDayKey`, `sgHHMM`, `sgHourMinute`) instead of raw `Date` accessors anywhere we compare against `hours_json` or build a per-day window.

## Doc maintenance
**Update [Gabo_prd.md](Gabo_prd.md) in the same commit as any change that affects what users see or how the planner decides.** This includes:
- New UI surfaces (sections, banners, badges, pills) → §2 user flow
- Hard-filter rule changes → §4.1
- Scoring weight or formula changes → §4.3
- New data sources or provenance behaviour → §6
- Planner-visible env-var or operational-state changes → §6.4

CLAUDE.md captures dev state and gotchas; the PRD is the canonical product spec. Implementation polish (marker shapes, animation timings, internal helpers) doesn't need a PRD entry.

## UX preferences — already learned, don't ignore
(See also `feedback_ux_patterns.md` in memory.)
- **No fixture names** ("Alex"/"Sam" etc) in the UI. Only show real names captured from onboarding; fallback is "You"/"Partner".
- **No public demo-disclosure surfaces** — no About modal, no inline "this is simulated" callouts.
- **Time-agnostic copy** — "Plan a date night", not "Plan tonight".
- **Multi-select by default** for preferences; **skip buttons** on every onboarding step; **free-form text fallback** when chips might not cover the user's case.

## Outstanding simulation
None of the data is fabricated, but the API-provider layer for dining is currently degraded (PRD §6.4):
- **Google Places** returns 403 (referrer-restricted key — needs GCP fix).
- **Foursquare** returns 402 (freePro tier out of credits — needs top-up).
- The blog scanner is filling in as the active dining source, producing ~10–20 venues per weekly run with cuisine-aware default hours (`badge_meta.hours_source = 'default'`). Once one of the API providers is restored, the catalog should grow to the original ~80–150 range.

Parked enhancements:
- **Sistic scraping** for ~70% of paid SG events (TOS review pending).
- **Cross-blog dedup** in the blog scanner (Burnt Ends mentioned by Sethlui AND DFD currently becomes two rows).
- **Gemini hours extraction** to replace the synthetic cuisine-aware default hours on blog-sourced venues.
- Museum scrapers exist (`lib/sources/museum-scrapers.ts` + the agent in `museum-agent.ts`) — no longer parked.
- The legacy `lib/venues/catalog.ts` file is no longer used by the app but kept until `/api/admin/reseed` has been run in prod and verified.

## Secrets
- `.env.local` (see `.env.example`): `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`, `GOOGLE_PLACES_API_KEY`, `FOURSQUARE_API_KEY` (fallback), `GOOGLE_GEMINI_API_KEY` (blog scanner, museum agent, plan eval), `BANDSINTOWN_APP_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_*` mirrors. Optional: `CRON_SECRET` (gates `/api/cron/*` and `/api/admin/reseed`), `PREWARM_TOKEN`. Never commit. The old `GRABMAPS_API_KEY` is no longer used.

## Out of scope for v1
Partner-facing app, account sharing, push notifications, payment, rescheduling, magic-link auth (deferred — localStorage profile works for demo).

## Known follow-ups
- Restore the Google Places + Foursquare API access (user-side fixes per PRD §6.4) so the dining catalog scales beyond the blog-scanner stopgap.
- Schema alignment: `profiles` table still has singular `vibe_default` + `budget_band`; code uses arrays. Migration needed if we persist to DB (currently localStorage only).
- `no_alcohol` override unwired (needs `alcohol_free` dietary flag).
- PH (public holiday) hours override is TODO in `lib/planner/hours.ts`.
- README.md is heavily out of date (still describes GrabMaps + 53-venue catalog + Easy yes / Worth the leap buckets).
