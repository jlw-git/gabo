-- Per-cron run summaries. Lets the /admin/agents dashboard render verifier
-- pass/soft_flag/hard_reject rates over the last N weeks without any new
-- aggregation infrastructure: each cron writes its existing summary JSON
-- here, the dashboard reads the latest N rows per kind.
--
-- Service-role writes only; no public read. Older rows can be pruned via a
-- supabase scheduled function later if volume becomes a concern (today the
-- crons fire at most a few times a week).

create table if not exists agent_run_log (
  id uuid primary key default gen_random_uuid(),
  -- Keep this enum small + explicit. Adding a new cron means a new value
  -- here AND a new panel in app/admin/agents/page.tsx.
  kind text not null check (kind in ('blogs', 'museums', 'freshness', 'dining')),
  summary jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_run_log_kind_created_idx
  on agent_run_log(kind, created_at desc);

alter table agent_run_log enable row level security;

-- No public select or insert policy: only the service-role key (which
-- bypasses RLS entirely) can write or read. The admin dashboard uses the
-- service-role client server-side.
