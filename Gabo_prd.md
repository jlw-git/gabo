# PRD — (codename "Gabo")
**Date-Night Planner for the Household Planner**
Owner: PM | Status: Hackathon v1 (2026-04-24) | Target: GrabMaps API Hackathon submission

---

## 1. Problem & Goal
Time-strapped planners in dual-income Singapore households spend ~30 min per date night juggling tabs to find places that are open, fresh, and fair to both commutes. They default to safe choices and miss the city's best pop-ups and experiences.

**Goal:** Compress 30 min of fragmented research into a 60-second decision. The planner uses the tool solo; the partner only sees a thoughtful plan land in WhatsApp.

**Success metrics (post-hackathon):** Median time from "Plan" tap → pick shared < 60s. ≥70% of plans selected from Stretch or Wild row (vs. Easy yes).

---

## 2. Core User Flow

### A. Onboarding (one-time, ~60s) — **built**
1. Planner enters their name + partner's name.
2. 4-step multi-select quiz: cuisines loved, cuisines avoided + dietary hard-stops, vibe defaults + budget bands. Every step has a Skip and a free-text fallback for cuisines/dietary.
3. Profile persists to `localStorage['gabo:profile-v2']` (no auth yet — see §5).
4. Last-used start points persist to `localStorage['gabo:last-starts-v1']` and pre-fill the form on return.

### B. Planning (~60s) — **built**
1. Plan form: two GrabMaps POI-search inputs (pre-filled), datetime, optional "Special Occasion" chips (Anniversary, Birthday) + free-form occasion text.
2. Backend filters + scores + buckets candidates → returns **three rows × up to three cards = up to nine results** in ≤5s. Weather auto-fetched from NEA server-side; outdoor venues excluded on rain days.
3. Results layout is **horizontal snap-scroll rows** per bucket (Easy yes / A small detour / Worth the leap) with a colored accent stripe on each section header. A List ↔ Map toggle at the top lets the planner switch to a single-map overview with all nine pins color-coded by bucket.
4. Each card shows: photo, venue name, address (line-clamped to 1 line each for uniform sizing), **FairnessPill** (per-card driving ↔ transit toggle — see §4.2), a one-line "why this for them" (3 lines max, ellipsized), **Book** + **Grab ride** buttons, and a "View details ›" affordance on the photo plus a chevron next to the name. Tapping the card opens the detail modal.
5. **Detail modal:** full hours, expanded badge meta, tag rows with profile-match highlights, and an embedded **GrabMaps mini-map** centred on the venue with both start points pinned (A/B) and the actual driving route polyline for each leg. Clicking **Book** opens the share sheet; **Grab ride** deep-links into the Grab consumer app with the venue pre-filled as drop-off.
6. **Overview Map view:** full-width MapLibre map (via our GrabMaps style proxy) with nine color-coded pins + two start pins. Legend overlay. Tapping any pin opens the same detail modal.

### C. Handoff (~10s) — **built**
1. After Book, the share modal opens with an **editable textarea** pre-filled with:
   - Venue name
   - Formatted date/time
   - Address
   - GrabMaps location link (`https://maps.grab.com/?position=<lat>,<lng>&zoom=17`)
2. Planner can customise the message, then tap **Copy**. Paste into WhatsApp, iMessage, etc.
3. (Not yet) plan saved to history for personalization learning.

---

## 3. Supabase Data Schema

```sql
-- All tables RLS-enabled. Auth deferred — see §5.

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  planner_name text not null,
  partner_name text not null,
  cuisines_loved text[] default '{}',
  cuisines_avoided text[] default '{}',
  dietary_hardstops text[] default '{}',
  -- NOTE: schema is singular; code uses `vibe_defaults text[]` + `budget_bands int[]`
  -- (multi-select per onboarding). Migration required before enabling auth/persistence.
  vibe_default text check (vibe_default in ('cozy','adventurous','celebratory','low_key')),
  budget_band int check (budget_band between 1 and 4),
  transit_pref text check (transit_pref in ('mrt','grab','either')) default 'either',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table venues (
  -- Pre-curated catalog (~53 rows seeded — see §3.1). Shared across users.
  -- Public SELECT via RLS policy in migration 0002_venues_public_read.sql
  -- (the GRANT alone isn't enough once RLS is on).
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  address text,
  cuisine_tags text[] default '{}',     -- overloaded as category: also holds
                                        -- 'experience','exhibition','music','games',
                                        -- 'outdoor','nature' for non-eatery venues.
  vibe_tags text[] default '{}',
  dietary_flags text[] default '{}',
  budget_band int check (budget_band between 1 and 4),
  is_outdoor boolean default false,
  photo_url text,
  chope_url text,                       -- null for non-eatery experiences
  hours_json jsonb,
  ph_hours_json jsonb,                  -- PH override TODO — see §5
  badge text check (badge in ('closing_soon','soft_launch','critic_pick','award_fresh','none')) default 'none',
  badge_meta jsonb,
  trending_score numeric default 0,
  active boolean default true
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references venues(id),
  start_a_lat double precision not null,
  start_a_lng double precision not null,
  start_b_lat double precision not null,
  start_b_lng double precision not null,
  scheduled_for timestamptz not null,
  override_tags text[] default '{}',
  card_bucket text check (card_bucket in ('safe','stretch','wild')) not null,
  eta_a_min int,                        -- driving minutes (server always returns driving)
  eta_b_min int,
  fairness_gap_min int,
  booked boolean default false,
  created_at timestamptz default now()
);

-- Feedback table scaffolded; no UI yet.
```

### 3.1 Catalog composition (53 venues as of 2026-04-24)
- **41 eateries** across Japanese, Italian, Chinese, Korean, Thai, Indian, Middle Eastern, Mediterranean, Spanish, French, Vietnamese, Peranakan, Malay, Modern European, American, Mexican, Latin, cocktail bars.
- **12 experiences** (curation pass 3): ArtScience Museum, Van Gogh: The Immersive Experience (closing_soon), Marvel: The Exhibition (closing_soon), Gardens by the Bay Flower Dome, Cloud Forest Dome, National Gallery Singapore, Singapore Art Museum @ Distripark (soft_launch), Timbre X S.E.A. (award_fresh), Blu Jaz Cafe, Lockdown SG escape rooms, Mind Cafe, Night Safari.
- Budget spread 1–4; geographic spread covers CBD, Orchard, Dempsey, East Coast, Bukit Merah, Mandai, Sentosa, Holland Village, Tanjong Pagar.
- Badge distribution: 3 closing_soon, 5 soft_launch, 12 critic_pick, 7 award_fresh, rest none.

---

## 4. Business Logic Rules

### 4.1 Candidate Filtering (hard filters)
- Venue `active = true`.
- Open at `scheduled_for` per `hours_json` (cross-midnight aware via `lib/planner/hours.ts`; `ph_hours_json` override is TODO).
- No `cuisines_avoided` overlap with `cuisine_tags`.
- All `dietary_hardstops` satisfied.
- If override `vegetarian` → `vegetarian_friendly` required.
- If weather is `rain` AND `is_outdoor` → exclude. Weather pulled from NEA `/v1/environment/rainfall-forecast`.
- Budget: if `profile.budget_bands` is non-empty, venue must be in the set. Empty = no filter.

### 4.2 ETA, Transit Mode, and Display
- Call GrabMaps Direction for both `start_a → venue` and `start_b → venue` in `driving` mode, with `overview=full&geometries=geojson` so route geometry is MapLibre-ready. See `SKILL.md` §3.
- **Server always stores driving minutes** on the card. Transit mode is a **UI-only derived view**:
  - Each card has its own `drive / transit` toggle in the FairnessPill. Default mode is derived from `profile.transit_pref` (`mrt` → transit; else drive).
  - Transit minutes computed client-side via `simulatedMrtEta(driving) = round(driving × 1.4) + 5` — the PRD §6 simulation, re-applied at display time instead of at plan time. Bucketing and scoring always use driving.
- `fairness_gap_min = |driving_eta_a - driving_eta_b|` (driving is canonical).
- **Reject** any candidate with `fairness_gap_min > 15` (relaxes to 20, 25 if pool is thin — see §4.4).
- **Reject** any candidate where `max(eta_a, eta_b) > 60` minutes.
- FairnessPill is neutral (no color-coding on the gap) — the ETAs are self-explanatory.

### 4.2a Rate-Limit & Resilience
- **Prescore cap before routing.** After hard filters, rank survivors by `0.3·match + 0.25·freshness` and take top 20 (`ROUTING_CANDIDATE_CAP`). 40 upstream calls max per plan, well under burst limits.
- **No retry, no haversine fallback in the current build.** GrabMaps was reliable enough in testing to remove both (2026-04-24). If we hit 5xx spikes again, the retry + haversine path is easy to reinstate — the `estimated: true` flag is still in `DirectionResult`.
- **In-memory cache** (`lib/grabmaps/cache.ts`) keyed by `(lng,lat)|(lng,lat)|profile`, 1-hour TTL. Prewarm via `GET /api/prewarm`.

### 4.3 Scoring Formula
For each routed candidate:
```
score = 0.35·fairness + 0.30·match + 0.25·freshness − 0.10·friction

fairness  = 1 / (1 + fairness_gap_min)
match     = |intersect(cuisines_loved, cuisine_tags)| / max(|cuisines_loved|, 1)
            + 0.5 if any(profile.vibe_defaults) in vibe_tags
freshness = {closing_soon:1.0, soft_launch:0.8, critic_pick:0.7,
             award_fresh:0.6, none:0.0} + 0.3·trending_score
friction  = (eta_a + eta_b) / 60
```
Celebratory overrides (anniversary, birthday) reweight to `fairness 0.35 · match 0.20 · freshness 0.40 · friction 0.05` and reorder sections so Wild renders first.

### 4.4 Card Bucketing
Three rows × up to three cards = up to nine picks.

| Bucket | Row headline | Subtitle |
|---|---|---|
| safe | **Easy yes** | Familiar ground — you know what you're getting. |
| stretch | **A small detour** | Nudges your usual, stays within reach. |
| wild | **Worth the leap** | Fresh, buzzy, or limited-run. |

Selection rules (ordered; each picks up to 3):

- **Easy yes**: filter `freshness ≤ 0.3` AND `fairness_gap ≤ 8`, then rank by `match`. Top 3.
- **Worth the leap**: from venues not in Easy yes, rank by `freshness`. Top 3.
- **A small detour**: from venues not in the other two, rank by overall `score`. Prefer pool where `freshness ≥ 0.5` if there are ≥ 3 such candidates.

Fairness relaxation: if fewer than 3 total, relax `fairness_gap` 15 → 20 → 25.

Empty rows always render with a helpful message (e.g. "No easy picks this time — your start points may be too far apart."). Previously we hid empty rows, which made it look like a section was missing.

### 4.5 Override Behavior
- `Anniversary` / `Birthday`: boosts freshness, softens friction, and renders Wild first.
- `Vegetarian`: hard filter — requires `vegetarian_friendly`.
- `No alcohol`: **not wired.** Would need an `alcohol_free` dietary flag in the schema and per-venue seeding.
- Overrides are session-only.
- UI surfaces only **Special Occasion** chips (Anniversary, Birthday) + free-form text. Dietary prefs live in the profile.

### 4.6 Personalization Learning (post-MVP)
Feedback table is scaffolded in schema; not wired in v1.

### 4.7 Booking / Ride / Map Linkouts
- **Chope deep-link — deprioritised.** Chope URLs on eateries use the placeholder pattern `https://book.chope.co/booking?rid=<slug>` and are NOT verified against real Chope rIDs. Experiences carry `chope_url: null`. The Book button in the card opens the share modal regardless; no dependency on a working Chope rid.
- **Grab ride deep-link** (`lib/grab-ride.ts`): each card + detail modal has a **Grab ride** button that opens `grab://open?screenType=BOOKING&dropOffLatitude=<lat>&dropOffLongitude=<lng>&dropOffKeywords=<name>`. Works on mobile with the Grab app installed; silent no-op on desktop (acceptable for SG mobile-first demo).
- **GrabMaps location link** in the share message: `https://maps.grab.com/?position=<lat>,<lng>&zoom=17`. Pattern plausible, not verified against Grab's public map URL spec — worst case lands on the Grab maps homepage. Swap to Google Maps if a verified format isn't found.

### 4.8 Shareable Plan Text
Default share text is minimal, editable, and neutral (no "date night" language):
```
{venue.name}
{scheduled_for, formatted}
{venue.address}
{grabmaps_url}
```

(The OG-image share card at `/api/og/card` exists but is not wired into the share modal in v1 — simplified per feedback that text + link is enough for WhatsApp.)

---

## 5. Out of Scope (v1)
Partner-facing app, account sharing, real-time scraping, true MRT/bus routing (driving + simulated transit suffices), push notifications, payment, rescheduling, magic-link auth, personalization / feedback loop, PH hours override, `no_alcohol` wiring, PWA manifest.

**Schema divergence** to fix before enabling Supabase auth: `profiles.vibe_default` + `budget_band` are singular in the migration; code uses arrays (`vibe_defaults`, `budget_bands`). Currently lives in localStorage only so there's no runtime bug, but a schema migration is required before we persist profiles server-side.

---

## 6. Demo Simulation Decisions
GrabMaps Routing does **not** expose SG transit modes; POI trending is **not** exposed; Chope deep-link contract is **not** public. Rules:

- **Transit ETAs:** GrabMaps `driving` is source of truth. Transit is a deterministic client-side derivation: `round(driving × 1.4) + 5`. Toggleable per card in the UI. Labelled via the 🚆 icon.
- **Trending score:** seeded manually per venue at curation time.
- **Chope deep-link:** placeholder URL pattern. Experiences carry `null`. The Book flow doesn't depend on Chope resolving — it routes into the share modal. Grab ride deep-link is the primary functional linkout for the "how do I get there?" step.

---

## 7. Demo Disclosure
No public disclosure in the app. Product presents as real; the simulation boundary is documented here and in code. The one exception — the "X/Y ETAs estimated" banner for haversine fallback — was removed along with the haversine path in the 2026-04-24 reliability pass.

---

## 8. GrabMaps Integration Surface
Summary for judging (why GrabMaps is load-bearing, not cosmetic):

1. **POI search** powers the "Where you're starting" inputs (`/api/places/search` proxying `/maps/poi/v1/search`).
2. **Directions API** drives the core fairness calculation — two calls per candidate, cached, with the Direction geometry reused for the embedded map route lines.
3. **Style + tiles** — the detail-modal mini-map and the full-screen overview map both render via MapLibre against GrabMaps tiles. A single backend proxy (`/api/grabmaps/proxy?u=<encoded>`) handles style.json, tiles, sprites, and glyphs — the API key never touches the browser. MapLibre's `transformRequest` rewrites every `maps.grab.com` URL through the proxy, returning absolute URLs so tile workers can parse them.
4. **Prewarm** endpoint seeds the direction cache for common start pairs so first-plan latency stays under 5s.
