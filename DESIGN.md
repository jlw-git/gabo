# Gabo — Design notes

A short style guide. Captures the rationale behind the visual system so future
changes stay coherent.

## The problem with the current CTA pair

Each card today shows two solid, fully-saturated buttons side-by-side:

- **Reserve / Get tickets** — `bg-rose-600` (brand red)
- **Grab ride** — `bg-[#00b14f]` (Grab brand green)

Two issues:

1. **Color clash.** Red + green are complementary; placed adjacent at full
   saturation they vibrate, evoke traffic-light/Christmas associations, and
   undermine the romantic-premium positioning the rest of the product aims
   for. (See Itten's color theory; Apple HIG §"Color".)
2. **No hierarchy.** Two equally-weighted filled buttons fight for the click.
   Most mature systems pair **one** filled primary with **one** ghost or
   outlined secondary. Examples:

   | System  | Pattern |
   |---|---|
   | Apple HIG | filled / tinted / plain — never two filled adjacent |
   | Material 3 | filled, tonal, outlined, text — clear weight ladder |
   | shadcn/ui | `default` (solid) + `outline` / `secondary` / `ghost` |
   | Linear | one accent, ghost everywhere else |
   | Stripe | dark primary, outlined secondary |
   | Resy / OpenTable | dark primary, never two saturated buttons per card |

## Proposal: a 3-tier button system

```
Primary    bg-stone-900  text-white                  (one per surface)
Secondary  bg-white      ring-1 ring-stone-300       (supportive action)
Ghost      text-stone-700 hover:bg-stone-100         (tertiary / nav)
```

Plus one **brand accent** primary for hero/marketing moments only:

```
Brand      bg-rose-600   text-white                  (hero / form Search)
```

Why dark stone-900 instead of brand rose for repeating CTAs:

- Premium booking products (Resy, Tock, Airbnb's confirm screens) all default
  to near-black primary CTAs. Dark reads as quiet authority; saturated brand
  reads as marketing.
- Rose-600 stays meaningful when reserved for **once-per-page** moments (the
  big Search button on the form, the page eyebrow "Gabo — Your Date Planner",
  closing-soon urgency badges). Repeating it on every card devalues it.
- A neutral primary lets badges and state colors (rose for closing-soon,
  emerald for just-opened, amber for critic's pick, violet for award-winning)
  continue to do their semantic work without competing.

## Applying it to the cards

Today (loud, two filled buttons):

```
[ Reserve  (rose-600) ] [ Grab ride (grab-green) ]
```

Proposed (clear hierarchy, one quiet pair):

```
[ Reserve  (stone-900) ] [ Get directions (outlined stone) ]
```

The secondary becomes a quieter outlined button. **"Grab ride" replaced with
"Get directions"** — see "Broken integrations" below.

## Badges & state colors

Keep the semantic palette but desaturate one notch so badges support the card,
not dominate it.

| State | Now | Proposed |
|---|---|---|
| Closing soon | `bg-rose-600/90 text-white` | `bg-rose-50 text-rose-700 ring-1 ring-rose-200` |
| Just opened  | `bg-emerald-600/90 text-white` | `bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200` |
| Critic's pick | `bg-amber-600/90 text-white` | `bg-amber-50 text-amber-800 ring-1 ring-amber-200` |
| Award-winning | `bg-violet-600/90 text-white` | `bg-violet-50 text-violet-700 ring-1 ring-violet-200` |
| Trending      | `bg-orange-500/90 text-white` | keep (it's intentionally a "hot" signal) |

The closing-soon ring on the card itself can stay (`ring-rose-300`) — that's a
single accent doing structural work, not visual noise.

## Layout: left/right alignment

The current 400px + 1fr grid puts a 3xl marketing headline ("Short on time?
Gabo has you covered.") opposite a small lg subhead ("This week in
Singapore"). The two columns feel like they belong to different products.

Two fixes, in order of preference:

1. **Match the section heads.** Bump the right-column h2 to `text-2xl
   font-semibold tracking-tight`, give it a brand eyebrow ("Right now in
   Singapore" in `text-rose-600 text-xs uppercase tracking-wide`) so the two
   columns read as paired sections rather than headline-vs-utility.
2. **Optional: add a thin top rule** above each column at `lg:` breakpoint to
   visually anchor them at the same Y.

## Broken integrations (post-hackathon)

GrabMaps API key appears to have been revoked since the hackathon ended:

- `/api/grabmaps/proxy` returns 500 → mini-map shows "Map unavailable"
- Grab ride deep-link `grab://open?...` only works on mobile with Grab app
  installed; silently fails on desktop demo (this was always true, not
  hackathon-specific)

### Recommended replacements

**Map:** switch MapLibre tile source from `maps.grab.com/api/style.json` to a
free provider. Two acceptable options:

- OpenStreetMap raster tiles via a free MapLibre style (no key, lower polish)
- MapTiler free tier (50k tiles/mo, prettier, requires a key)

OSM is the right call for a portfolio piece — no signup, no quota anxiety.

**"Grab ride" CTA:** replace with **"Get directions"** linking to Google Maps
(`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`). Works on
every device, no app required, no broken silent state. The Grab brand green
goes away with it — which actually solves the original CTA-clash complaint at
the root.

(If we want to preserve a Grab-specific path on mobile, the deep link can
still be offered behind a "Book a Grab" entry in the venue detail modal where
a no-op on desktop is less jarring than on the always-visible card.)

## Typography

Already on Inter — good choice for legibility at small sizes. No changes
proposed.

## Background

The radial rose-tinted gradient (`#fff1f2 → #fafaf9`) is fine at the current
intensity. If it ever feels too warm, drop the inner stop to `#fff5f5` or
remove the gradient on `lg:` breakpoints where the form already provides
warmth.
