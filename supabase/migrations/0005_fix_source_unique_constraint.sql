-- The partial index (WHERE source_id IS NOT NULL) cannot be referenced by
-- ON CONFLICT (source, source_id) in PostgREST upserts. Replace it with a
-- full unique index. PostgreSQL treats NULLs as distinct in unique indexes so
-- multiple manual rows with source_id = NULL are still allowed.

drop index if exists venues_source_id_idx;

create unique index venues_source_id_idx
  on venues(source, source_id);
