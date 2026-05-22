# scripts/

Operational scripts for Gabo. None are part of the runtime build.

## agent-eval.mjs — Ranker A/B harness

Compares `/api/plan` responses between two server configurations (e.g.
`AGENTIC_RANKER_ENABLED=true` vs unset) to evaluate whether the LLM ranker
is earning its keep before flipping the env flag globally.

Because env flags only take effect inside the server process, the script
cannot toggle them mid-run. The workflow is:

1. **Deploy two Vercel preview builds** of the same branch — one with
   `AGENTIC_RANKER_ENABLED=true` in Project Settings → Environment Variables
   (Preview scope), one with that variable unset. Note both preview URLs.
2. **Capture each side:**
   ```bash
   node scripts/agent-eval.mjs capture --base-url=https://<on-preview>.vercel.app  --label=on
   node scripts/agent-eval.mjs capture --base-url=https://<off-preview>.vercel.app --label=off
   ```
   Each writes `scripts/agent-eval-out/<label>.json` (gitignored).
3. **Diff offline:**
   ```bash
   node scripts/agent-eval.mjs diff --a=on --b=off
   ```
   The summary at the end prints the two rollout gates from
   `~/.claude/plans/let-s-plan-all-the-sprightly-sedgewick.md`:
   - **Top-1 stable** in ≥80% of fixtures (= ranker doesn't destabilise the top result)
   - **≥1 rank_reason** in ≥70% of fixtures (= ranker actually annotates)

Same pattern works for `AGENTIC_PLAN_ENABLED` (relaxation agent) — the
`agent_relaxation` field is included in the per-fixture diff output.

### Fixtures

`agent-eval-fixtures.json` carries 7 representative `PlanRequest` payloads:
baseline two-start, anniversary, narrow vegetarian, islandwide-no-starts,
late-night birthday, weekend brunch, no_alcohol override. Each fixture has
an `_purpose` field documenting what code path it exercises. Add new
fixtures here whenever a new override or filter axis ships.

## test-plan.sh + test-plan-payload.json

Manual smoke test for `/api/plan` — single fixture, prints the response.
Predates the A/B harness; kept for quick local checks.

## audit-dining-dedup.mjs

Reports cross-source duplicates after a `/api/cron/sync-dining` run —
fuzzy name + ~200 m coordinate match between Google/Foursquare rows and
blog-scanner editorial rows. Confirms `lib/planner/score.ts#dedupeByVenue`
will collapse them at planner output. See script header for usage.
