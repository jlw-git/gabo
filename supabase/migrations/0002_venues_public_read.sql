-- Patch: allow anon + authenticated to SELECT from venues. Without this,
-- PostgREST returns zero rows even though the table is populated.
-- Paste this into the Supabase SQL Editor once.

alter table venues enable row level security;
drop policy if exists venues_public_read on venues;
create policy venues_public_read on venues for select to anon, authenticated using (true);
