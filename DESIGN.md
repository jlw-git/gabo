# Gabo — design direction

Updated 2026-09-07. Product requirements live in `Gabo_prd.md`, sections 1–2.

## Intent

Make choosing a thoughtful date feel approachable. The primary surface is a working planner, with enough editorial warmth to suit dinner and culture discovery. The message is “Less planning. More us time.” Avoid unmeasured time guarantees and claims of verified availability.

## Hierarchy and layout

- A restrained wordmark and an “Explore places” anchor frame the page.
- Desktop pairs a short value proposition with a white planning panel; mobile stacks the introduction and form. Supporting steps are hidden on smaller screens to keep input closer to the top.
- Date/time comes first, followed by two optional starts and a contextual explanation of their value.
- Mood uses direct, optional selections. Food preferences and budget are disclosed on demand; occasions and notes remain optional. No preset silently adds cuisines or price bands.
- One full-width terracotta action, “Find our date spots,” completes the form.
- Discovery follows the planner and explicitly describes its role as inspiration. It has loading, empty and failure states, with a route back to planning.
- Result cards use a consistent 16:10 image ratio, two-line venue titles, and bottom-aligned action groups. Existing venue photos and category fallbacks remain the image source.

## Visual system

Tokens are in `app/globals.css`:

| Role | Value / treatment |
|---|---|
| Page | Warm ivory `#f8f5ef` |
| Primary action | Terracotta `#b94b35`, white text |
| Hover / strong accent | `#963a29` |
| Selected control | Pale terracotta `#fbede6`, dark accent text |
| Body | Stone neutrals, white surfaces, thin neutral borders |
| Display | Georgia/system serif for the wordmark and editorial headings |
| Interface | Existing Inter for labels, controls and body text |

Reserve the warm accent for the planner action and selection/focus cues. Repeated booking actions remain near-black; directions are outlined. Existing semantic badge colors communicate venue states. Do not use the accent to imply freshness or verification.

## Interaction and accessibility

Inputs have associated labels; location inputs expose combobox state and keyboard selection. Buttons expose selection/disclosure state. Focus is visible, browser zoom is allowed, and animations respect reduced motion. Newly simplified controls use generous touch targets. Keyboard actions on a nested card control must not also open the parent card.

All planner dates represent Singapore time, including for users travelling abroad. Past dates show an actionable error. Optional selections remain intact while opening/closing disclosures. Changing a selected origin preserves the newly typed query.

## Remaining product work

The redesign does not make incomplete backend guarantees true. Follow the PRD for hours provenance, budget-widening disclosure, full draft preservation, booking/search-link labels, preference reset and complete-evening sharing. Validate mobile, keyboard, live content and outcome metrics before broad release.
