-- Marketplace files live on the publisher's machine (~/.benana/marketplace), never in Supabase.
-- Supabase keeps only the rows: listings, versions, checkpoints, votes, reviews, reports.

alter table public.listings drop constraint if exists listings_source_repo_url_check;
alter table public.listings add constraint listings_source_repo_url_check
  check (source_repo_url ~ '^(https://|benana-local://)');
alter table public.listings add column if not exists storage text not null default 'local'
  check (storage in ('local'));

alter table public.versions add column if not exists playtest_status text not null default 'unknown'
  check (playtest_status in ('passed', 'failed', 'not_tested', 'unknown'));
alter table public.versions add column if not exists checkpoint_count int not null default 0;
alter table public.versions add column if not exists tokens bigint not null default 0;
alter table public.versions add column if not exists transcripts int not null default 0;

-- No file storage: remove the upload policies (buckets are removed through the Storage API).
drop policy if exists jars_write on storage.objects;
drop policy if exists jars_read on storage.objects;
drop policy if exists jars_delete on storage.objects;
