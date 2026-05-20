-- Remove 'bandsintown' as a permitted venues.source value.
--
-- Bandsintown's Data Applications Terms restrict API access to artists and
-- people working on their behalf, and explicitly forbid aggregating their
-- content with third-party data — both of which Gabo violates as a consumer
-- date planner. The client and sync code have been removed; this migration
-- purges any leftover rows and drops the value from the CHECK constraint so
-- new inserts can't reintroduce it.

-- 1) Delete any stragglers. There is no replacement source — these rows are
-- simply gone from the catalog.
delete from venues where source = 'bandsintown';

-- 2) Rebuild the source CHECK without 'bandsintown'. Postgres has no
-- "alter check" so we drop and re-add. The constraint name was auto-generated
-- when the column was created in 0004 with an inline CHECK; we look it up
-- dynamically to avoid hard-coding a name that may differ between
-- environments.
do $$
declare
  conname text;
begin
  select c.conname
    into conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'venues'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%bandsintown%';
  if conname is not null then
    execute format('alter table venues drop constraint %I', conname);
  end if;
end$$;

alter table venues
  add constraint venues_source_check
  check (source in (
    'google_places','foursquare',
    'sistic','museum','editorial','manual'
  ));
