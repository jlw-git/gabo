-- Track where each venue came from. Replaces the "everything is hand-seeded"
-- model with real-source provenance: Google Places / Foursquare for dining,
-- Bandsintown / museum sites / Sistic / editorial for events.
--
-- source_id holds the upstream's stable ID (e.g. Google place_id, Foursquare
-- fsq_id, Bandsintown event id, sistic event slug) so re-sync upserts cleanly.
-- source_url is required for editorial rows (verifiable provenance) and
-- optional for API-sourced rows (we can always re-derive a public URL).

alter table venues
  add column if not exists source text
    check (source in (
      'google_places','foursquare','bandsintown',
      'sistic','museum','editorial','manual'
    ))
    default 'manual',
  add column if not exists source_id text,
  add column if not exists source_url text,
  add column if not exists last_synced_at timestamptz;

-- Backfill existing rows so the constraint is satisfied. Hand-seeded catalog
-- becomes 'manual' (distinct from 'editorial' which means human-curated with
-- a verifiable public URL).
update venues set source = 'manual' where source is null;

-- Re-sync upsert key. Two API fetches of the same Google place must collapse
-- into one row, not duplicate. NULL source_id (manual rows) is allowed
-- multiple times.
create unique index if not exists venues_source_id_idx
  on venues(source, source_id)
  where source_id is not null;

-- Editorial rows must declare a verifiable source URL.
alter table venues
  add constraint venues_editorial_needs_source_url
  check (source <> 'editorial' or (source_url is not null and length(source_url) > 8))
  not valid;
-- Mark the existing rows as not-validated so the constraint applies only to
-- new editorial inserts. Once we wipe + reseed, validate it.
