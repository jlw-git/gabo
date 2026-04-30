# PRD — Gabo
**Find a great place to eat and an activity to do after**
Owner: PM | Status: Hackathon v2 (2026-04-24) | Target: GrabMaps API Hackathon submission

---

## 1. Problem & Goal
Time-strapped couples in Singapore spend ~30 minutes per date night juggling tabs to find a place that's open, fresh, and worth their time — often defaulting to the same five restaurants and missing the city's best pop-ups, exhibitions, and limited-run experiences.

**Goal:** Compress 30 minutes of fragmented research into a 60-second decision. The planner uses the tool solo; the partner only sees a thoughtful plan land in WhatsApp.

**v2 redesign focus:** the search is now **date-first**, locations are **optional**, and results split into two tabs — **Dining** and **Events** — so a date night can include "dinner first, exhibition after" without forcing the user to open another app for the activity half.

---

## 2. Core User Flow

### A. Onboarding (one-time, ~60s) — **built**
1. **3-step multi-select quiz** (no names): (1) cuisines loved; (2) cuisines avoided + dietary hard-stops; (3) vibe defaults + budget bands. Every step has a Skip; cuisines and dietary steps support free-text fallback for items not in the chip set.
2. Profile persists to `localStorage['gabo:profile-v2']`. UI falls back to "You" / "Partner" labels everywhere a name would appear.
3. Last-used start points persist to `localStorage['gabo:last-starts-v1']` and pre-fill the form on return.
4. **Shortlist** persists to `localStorage['gabo:shortlist-v1']` — array of venue IDs the user has saved while reviewing.

### B. Planning (~60s) — **built**
1. **Date-first form.** The only required field is **When**. Both starting points are **optional**; if either is blank the search runs islandwide (or single-origin if only one is provided). Special Occasion chips are optional.
2. CTA reads **Search**. Title: "Plan a date night in Singapore."
3. Backend filters + scores + categorises candidates. Returns up to **6 dining + 6 events**.
4. Results page renders two **tabs** — Dining / Events — with a count badge on each. List ↔ Map view toggle. **Filter chips** above the list narrow further: All / Recommended / Limited-run / Just opened / ★ Shortlist.
5. Cards display: photo, **category pill** (Dining/Event) top-left, **badge chip** top-right (colour-matched: rose for closing-soon, emerald for soft-launch, amber for critic, violet for award), small **shortlist (☆/★)** and **share (↗)** icon buttons; venue name, address, FairnessPill (per-card driving ↔ transit toggle, suppressed when no starts were given), one-line "why this for them", and **Reserve** (dining) or **Get tickets** (events) + **Grab ride** CTAs.
6. **Trending** pill rendered for venues with `trending_score ≥ 0.7` and no other badge — surfaces buzzy spots that aren't critic picks.
7. **Highlighting**: cards with badges get a colour-coded ring matching the badge chip — closing-soon pop-ups read as time-sensitive at a glance.
8. **Detail modal** (tap card or shortlist/share buttons) — full hours, badge meta, profile-match tag highlights, embedded **GrabMaps mini-map** with both partners' driving routes drawn, **cross-recommendations** (top 3 venues from the opposite category within 6 km), category-aware Reserve/Get tickets CTA + Grab ride.
9. **Overview Map** (single-screen view) — all picks pinned, color-coded by category (rose dining / violet events). Tap pin → detail modal.

### C. Handoff (~10s) — **built**
1. The **share button (↗)** on any card or detail modal opens an editable textarea pre-filled with: venue name, formatted date/time, address, GrabMaps location link.
2. No date-night branding in the default text — neutral, ready to paste into WhatsApp / iMessage.
3. The Reserve / Get tickets CTA also routes through a confirmation sheet (BookingOverlay) and then opens the share modal automatically — for users who want to send the plan after they've reserved.

---

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

### 3.1 Catalog composition (53 venues)
- **41 eateries** across all major cuisines (Japanese, Italian, Chinese, Korean, Thai, Indian, Middle Eastern, Mediterranean, Spanish, French, Vietnamese, Peranakan, Malay, Modern European, American, Mexican, Latin, cocktail bars).
- **12 experiences**: ArtScience Museum, Van Gogh: The Immersive Experience (closing_soon), Marvel: The Exhibition (closing_soon), Gardens by the Bay Flower Dome, Cloud Forest Dome, National Gallery Singapore, Singapore Art Museum @ Distripark (soft_launch), Timbre X S.E.A. (award_fresh), Blu Jaz Cafe, Lockdown SG, Mind Cafe, Night Safari.
- All venues have a non-null `chope_url`: real Chope-style placeholders for eateries, real public ticket / info pages for experiences.

---

## 4. Business Logic Rules

### 4.1 Candidate Filtering (hard filters)
- Venue `active = true`.
- Open at `scheduled_for` (cross-midnight aware; PH override TODO).
- No `cuisines_avoided` overlap with `cuisine_tags`.
- All `dietary_hardstops` satisfied by `dietary_flags`.
- If override `vegetarian` → `vegetarian_friendly` required.
- If weather is `rain` AND `is_outdoor` → exclude. Weather: NEA `/v1/environment/rainfall-forecast`.
- Budget filter applies to **dining only** — experiences span budget_bands and aren't excluded by the user's restaurant budget preference.

### 4.2 ETA & Transit Mode
- GrabMaps Direction (`driving`, `geometries=geojson`, `overview=full`) called for each routed candidate, once per provided start.
- **Server always stores driving minutes**. Transit (🚆) is a UI-only client-side derivation: `simulatedMrtEta(driving) = round(driving × 1.4) + 5`. Each card has its own driving / transit toggle; default mode comes from `profile.transit_pref`.
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
| All | every card in the tab |
| Recommended | `badge ∈ {critic_pick, award_fresh}` OR `trending_score ≥ 0.7` |
| Limited-run | `badge = closing_soon` |
| Just opened | `badge = soft_launch` |
| ★ Shortlist | venue id is in localStorage shortlist |

The category split is determined by `isEvent(venue)` in `lib/planner/category.ts` — currently `'experience' ∈ cuisine_tags`. Future cleanup: promote to a dedicated `category` column.

### 4.5 Override Behavior
- `Anniversary` / `Birthday`: boosts freshness weight, softens friction across all three scoring paths. Section reordering (Wild-first) from v1 is gone — there are no Wild/Stretch sections to reorder anymore.
- `Vegetarian`: hard filter (requires `vegetarian_friendly`).
- `No alcohol`: not wired (would need `alcohol_free` flag).
- Overrides are session-only.

### 4.6 Personalization Learning (post-MVP)
Feedback table is scaffolded; not wired. Shortlist (localStorage) is a lightweight precursor — venues a user shortlists are not yet fed back into scoring.

### 4.7 Linkouts
- **Reserve / Get tickets** (primary CTA on each card + detail modal). For dining, opens the Chope-style listing in `chope_url`. For events, opens the official ticket / info page in the same `chope_url` field — the field is dual-purpose by category. Confirmation sheet (BookingOverlay) shows category-aware copy ("Reserve at X" / "Get tickets for X") before the linkout fires.
- **Grab ride** (secondary CTA): `lib/grab-ride.ts` builds `grab://open?screenType=BOOKING&dropOffLatitude=<lat>&dropOffLongitude=<lng>&dropOffKeywords=<name>`. Mobile-only behaviour; desktop click is a no-op.
- **Share (↗)** (tertiary): opens editable share modal with venue + time + address + GrabMaps location URL.

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
Partner-facing app, account sharing, real-time scraping, true MRT/bus routing, push notifications, payment, rescheduling, magic-link auth, server-side personalization / feedback loop, PH hours override, `no_alcohol` wiring, PWA manifest.

**Schema divergence** to fix before enabling Supabase auth: `profiles.vibe_default` + `budget_band` are singular in the migration; code uses arrays.

---

## 6. Demo Simulation Decisions
- **MRT ETA**: derived client-side as `round(driving × 1.4) + 5`. GrabMaps Routing doesn't expose SG transit modes.
- **Trending score**: seeded manually per venue; no live feed.
- **Chope rIDs**: placeholder pattern for eateries — not verified against real Chope rIDs. The functional booking flow uses **Reserve → Chope listing URL** for dining and **Get tickets → official site** for events. Grab ride is real for both.

Everything else (fairness, routing geometry, POI search, map tiles, weather, venue filters, scoring, bucketing, cross-recs, shortlist) is live.

---

## 7. Demo Disclosure
No public disclosure in the app. Simulation boundary documented here.

---

## 8. GrabMaps Integration Surface
Why GrabMaps is load-bearing:

1. **POI search** powers the optional start-point inputs (`/api/places/search` → `/maps/poi/v1/search`).
2. **Directions API** computes ETAs (when starts are provided), drives fairness sorting in the two-start path, and supplies the GeoJSON route geometry rendered on the detail mini-map.
3. **Style + tiles** render both the detail mini-map and the full overview map via MapLibre. A backend proxy (`/api/grabmaps/proxy?u=<encoded>`) brokers style.json, tiles, sprites, and glyphs so `GRABMAPS_API_KEY` never reaches the browser. MapLibre's `transformRequest` rewrites every `maps.grab.com` URL through the proxy and returns absolute URLs so tile workers can resolve them.
4. **Prewarm** (`/api/prewarm`) seeds the 1-hour direction cache for common start pairs to keep first-plan latency under 5s.
