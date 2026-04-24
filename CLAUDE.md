@AGENTS.md

# Gabo (codename "Fair & Fresh")

Date-night planner for dual-income Singapore households. Hackathon MVP for the **GrabMaps API Hackathon**. Full spec in [Gabo_prd.md](Gabo_prd.md); hackathon themes in [GrabMaps API Hackathon](GrabMaps%20API%20Hackathon); GrabMaps API reference in [SKILL.md](SKILL.md).

## Stack
Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4 + Supabase (Postgres + RLS). Read [AGENTS.md](AGENTS.md) — Next.js 16 has breaking changes; check `node_modules/next/dist/docs/` before writing Next-specific code.

## Current build state
- Supabase live, 24 venues seeded via `scripts/seed-supabase.mjs` (idempotent: deletes + reseeds)
- 4-step onboarding quiz at first visit: names, cuisines loved, cuisines/dietary to avoid, vibes+budgets (all multi-select, all skippable). Persists to `localStorage['gabo:profile-v2']`.
- Plan form: two `PlaceSearchInput` fields (GrabMaps POI search, pre-filled from `localStorage['gabo:last-starts-v1']`), datetime, Special Occasion chips + free-form text.
- Weather auto-fetched server-side from NEA (`lib/weather.ts`); outdoor venues excluded on rain days.
- Results: 3 sections (The safe bet / A small detour / Worth the leap), up to 3 cards each = 9 total.
- Tap a card → `VenueDetailModal` with full hours, badge meta, profile-match highlights on tags.
- Booking sheet + WhatsApp share modal.
- GrabMaps is reliable; direction lib (`lib/grabmaps/direction.ts`) is cache-only (no retry/haversine). 1hr in-memory cache + `/api/prewarm` endpoint.

## Project layout
- `app/page.tsx` — single-page container; state machine for onboarding → form → loading → results
- `app/api/plan/` — plan handler: Supabase query → local filters → prescore cap → parallel GrabMaps routing → score → bucket
- `app/api/places/search/` — proxy for GrabMaps POI keyword search (used by `PlaceSearchInput`)
- `app/api/prewarm/` — warms direction cache for common start points
- `app/api/grabmaps/route-matrix/` — single direction lookup (leftover from earlier; still builds)
- `components/` — `OnboardingQuiz`, `PlanDateForm`, `PlaceSearchInput`, `PlanCard`, `FairnessPill`, `ResultsView`, `VenueDetailModal`, `BookingOverlay`, `WhatsAppShareModal`
- `lib/planner/` — `types.ts`, `hours.ts` (cross-midnight aware), `score.ts` (prescore + score + bucket)
- `lib/grabmaps/` — `direction.ts`, `cache.ts`
- `lib/venues/catalog.ts` — 24 venues; source of truth for `seed-supabase.mjs`
- `lib/profile-storage.ts` — localStorage helpers
- `supabase/migrations/` — `0001_gabo_schema.sql`, `0002_venues_public_read.sql`

## Hackathon rules and constraints
- **GrabMaps API must be called from a backend proxy, never the browser.** Hackathon rule; keeps the key hidden and avoids CORS. All server routes that touch GrabMaps live under `app/api/`.
- **GrabMaps coordinates are `lng,lat`** — lng first, not lat. Easy to get wrong.
- **Supabase public tables need an RLS policy even if the grant is there.** `grant select to anon` alone isn't enough; PostgREST blocks reads until RLS is enabled with a permissive SELECT policy (see `0002_venues_public_read.sql`).

## UX preferences — already learned, don't ignore
(See also `feedback_ux_patterns.md` in memory.)
- **No fixture names** ("Alex"/"Sam" etc) in the UI. Only show real names captured from onboarding; fallback is "You"/"Partner".
- **No public demo-disclosure surfaces** — no About modal, no inline "this is simulated" callouts.
- **Time-agnostic copy** — "Plan a date night", not "Plan tonight".
- **Multi-select by default** for preferences; **skip buttons** on every onboarding step; **free-form text fallback** when chips might not cover the user's case.

## Simulated layers (PRD §6 — **not disclosed in UI**)
1. Transit ETA — MRT derived as `driving × 1.4 + 5`
2. Trending score — seeded per venue, no live feed
3. Chope deep-link — pattern is placeholder; tap opens the public listing

## Secrets
- `.env.local` holds `GRABMAPS_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus `NEXT_PUBLIC_*` mirrors for the browser Supabase client. Never commit.

## Out of scope for v1
Partner-facing app, account sharing, real-time scraping, MRT/bus routing (beyond simulated), push notifications, payment, rescheduling, magic-link auth (deferred — localStorage profile works for demo), personalization/feedback loop.

## Known follow-ups
- More venue curation (target 40+ with verified Chope URLs and hours; currently 24 placeholder-ish entries).
- Schema alignment: `profiles` table still has singular `vibe_default` + `budget_band`; type now uses arrays. Migration needed if we persist to DB (currently localStorage only).
- `no_alcohol` override unwired (needs `alcohol_free` dietary flag).
- PH (public holiday) hours override is TODO in `lib/planner/hours.ts`.
