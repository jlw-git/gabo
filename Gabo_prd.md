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
4. Results page renders two **tabs** — Dining / Events — with a count badge on each. The **Times** (driving ↔ transit) toggle sits next to the tabs as part of the same cluster so the user can switch ETA mode without scanning to the opposite side of the header. List ↔ Map view toggle sits in a second cluster on the right. The results header shows the planning slot followed by the **names of the two start points** ("between Tampines MRT and Buona Vista MRT") — when only one start was given, "from {start}"; when neither, "islandwide". On the **Map** view, dining and event pins use category **glyphs** (🍽️ for dining, 🎟️ for events) on coloured circular backgrounds, so the marker category is legible at a glance without consulting the legend.
5. **Filter chips** above the list narrow within the active tab: All / Recommended / Limited-run / Just opened / ★ Shortlist. Each filter maps to a chip predicate (see §4.4) — chip visibility on a card guarantees the card appears under the matching filter.
6. Cards display: photo (or category-typed SVG fallback when none), **category pill** (Dining/Event) top-left, a **stack of badge chips** top-right (one chip per applicable signal — colour-matched: rose for limited-run, emerald for just-opened, amber for critic, violet for award), small **shortlist (☆/★)** and **share** (iOS-style square-with-up-arrow SVG) icon buttons; venue name, address, FairnessPill (per-card driving ↔ transit toggle, suppressed when no starts were given), a "why this for them" line that combines up to two concrete reasons drawn from the card's badge_meta (e.g. "ends 30 May · opened 3 weeks ago" or "picked by Seth Lui, DFD · michelin star 2026"), and a **CTA pair**: **Reserve** (dining) or **Get tickets** (events) + **Directions** (Google Maps). The Reserve button is **suppressed for venues that don't take reservations**, decided in this order: (1) the venue's `accepts_reservations` column when populated (true/false set by the source extractor — e.g. blog-scanner's Gemini step reading "walk-in only" / "reservations recommended" from the article); (2) a real `chope_url` → always show Reserve; (3) address contains hawker / food-court / kopitiam / coffee-shop phrases → suppress; (4) name brands itself around a hawker dish (sliced fish, bak kut teh, chicken rice, char kway teow, hokkien mee, laksa, roti prata, etc) → suppress; (5) default → show. When suppressed, **Directions** takes over as the full-width CTA but keeps the secondary (white, outlined) styling — there's no other action to compete with it, so the loud black primary would read as misplaced visual emphasis. **Source attribution** under the CTAs names the source directly — "Seth Lui" / "Daniel Food Diary" / "Miss Tam Chiak" / "Ladyironchef" / "Eatbook" / "The Smart Local" / "Esplanade" for editorial blog-sourced rows (derived from `source_url` hostname), or "Google" / "Foursquare" / "Official venue page" for API-sourced rows. The legacy "via" prefix was dropped — the source name reads cleaner on its own.

Badge chips are rendered from `badge_meta`, not the single `badge` column, so a venue carrying multiple time-sensitive signals (e.g. a Michelin-starred pop-up that opened last week) shows all of them. The `badge` column still drives the ring colour and freshness score; the chip stack is the user-facing surface for label discovery.
7. **Trending** pill rendered for venues with `trending_score ≥ 0.7` and no other badge — surfaces buzzy spots that aren't critic picks.
8. **Highlighting**: cards with badges get a colour-coded ring matching the badge chip — closing-soon pop-ups read as time-sensitive at a glance.
9. **Detail modal** (tap card or shortlist/share buttons) — full hours, badge meta, profile-match tag highlights, embedded **OSM mini-map** with both partners' routes drawn, **cross-recommendations** (top 3 venues from the opposite category within 6 km), category-aware Reserve/Get tickets CTA + Directions linkout.
10. **Overview Map** (single-screen view) — all picks pinned, color-coded by category (rose dining / violet events). Tap pin → detail modal. Start points (You / Partner) render as **teardrop pin shapes** with the letter A / B inside, in distinct colours from the venue dots — so users can tell their own location apart from suggested venues at a glance.
11. **Weather pill** — when NEA's forecast for the requested slot indicates rain *and* the rain filter actually excluded ≥ 1 outdoor venue, a sky-blue pill renders above the results: *"Hiding N outdoor spots — NEA forecast: <text>"*. Hidden on clear days or when no outdoor venues were affected; avoids cluttering sunny-day results while explaining the absence of outdoor picks (e.g. Gardens by the Bay) on rainy slots.

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

### 3.1 Catalog composition (live-sourced, post-hackathon)
The legacy 53-venue hand-seeded catalog has been retired. The catalog now grows weekly from real sources (§6). Composition shifts with each cron cycle, but typical state:
- **Dining**: ~80–150 venues from Google Places + Foursquare when their API access is healthy; ~10–30 from the editorial blog scanner when both API providers are blocked (current state — see §6.4).
- **Events**: museum exhibitions (SAM + NGS live scrapers, plus Gemini-grounded coverage of ArtScience / NHB / Gardens via `lib/sources/museum-agent.ts`), Esplanade in-house programming (theatre / music / dance / festivals via `lib/sources/esplanade.ts`), and date-bounded events from The Smart Local's "Things To Do" feed (Gemini-extracted via `lib/sources/tsl-events.ts`). No general concert source — Bandsintown was removed (terms restrict access to artists/representatives, see §6.4); Sistic remains parked pending TOS review.
- All rows carry `source` + `source_url` for attribution and verifiability (§6.1). Editorial rows are CHECK-constrained to require `source_url`.

---

## 3.2 What's LLM-driven vs rules-based

Gabo is a **deterministic planner with LLM help at the seams**, not an agentic system despite the `lib/agents/` folder name. The user-visible decision — *which* venues appear and *in what order* — is pure rules-based code; no LLM scores or ranks venues in the default configuration. Every LLM call is **Gemini** (no Claude/Anthropic in the runtime) and **every one is single-shot** — none plan, loop, or chain tool calls. The model tier per task is centralised in `lib/agents/models.ts` (extraction → `gemini-2.5-flash`; verify / copy / triage / rank → `gemini-2.5-flash-lite`); every call is wrapped by `lib/agents/runner.ts` for observability (`/admin/agents`).

There are **9 LLM touchpoints + a triage step**. The only ones that reach outside their prompt use Gemini **with Google Search grounding** (museum discovery + the verifiers) and run exclusively in cron ingestion — never on a user's plan request.

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

## 7. Demo Disclosure
No public disclosure in the app. Simulation boundary documented here.

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
