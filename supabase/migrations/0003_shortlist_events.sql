-- Anonymous shortlist event log. Powers the internal-velocity component of
-- trending_score (see lib/trending/refresh.ts). No PII — venue id + timestamp
-- only. Service-role writes; nobody reads except the cron.

create table if not exists shortlist_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null references venues(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists shortlist_events_venue_created_idx
  on shortlist_events(venue_id, created_at desc);

alter table shortlist_events enable row level security;

-- Anyone (incl. anon) can insert; nobody reads via PostgREST. The cron uses
-- the service-role key which bypasses RLS.
create policy "anon insert shortlist events"
  on shortlist_events for insert
  to anon, authenticated
  with check (true);
