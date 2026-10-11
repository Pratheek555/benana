-- Benana marketplace schema. Rules come from docs/marketplace/SPEC.md (decisions 1–18).

-- ---------- roles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  github_login text,
  created_at timestamptz not null default now()
);

create table public.moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.moderators where user_id = auth.uid());
$$;

-- Account age comes from auth.users, which clients cannot edit.
create or replace function public.account_age_days() returns numeric
language sql stable security definer set search_path = public, auth as $$
  select extract(epoch from now() - created_at) / 86400 from auth.users where id = auth.uid();
$$;

-- A profile row for every new user, filled from GitHub metadata.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, github_login)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- listings and versions ----------
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  name text not null check (char_length(name) between 2 and 60),
  summary text not null default '' check (char_length(summary) <= 500),
  source_repo_url text not null check (source_repo_url ~ '^https://'),
  status text not null default 'live' check (status in ('live', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Decision 12: at most 10 listings per account.
create or replace function public.enforce_listing_cap() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.listings where owner_id = new.owner_id and status <> 'removed') >= 10 then
    raise exception 'listing cap reached (10 per account)';
  end if;
  return new;
end $$;
create trigger listing_cap before insert on public.listings
  for each row execute function public.enforce_listing_cap();

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  number int not null check (number > 0),
  jar_path text not null,
  jar_sha256 text not null check (jar_sha256 ~ '^[0-9a-f]{64}$'),
  jar_bytes int not null check (jar_bytes between 1 and 10485760),
  bundle_path text,
  bundle_manifest_sha256 text check (bundle_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  playtest_summary text not null default '' check (char_length(playtest_summary) <= 2000),
  created_at timestamptz not null default now(),
  unique (listing_id, number)
);

create table public.version_checkpoints (
  version_id uuid not null references public.versions (id) on delete cascade,
  checkpoint_id text not null check (checkpoint_id ~ '^[0-9A-Z]{26}$'),
  has_transcript boolean not null default false,
  primary key (version_id, checkpoint_id)
);

-- ---------- community ----------
create table public.votes (
  listing_id uuid not null references public.listings (id) on delete cascade,
  voter_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (listing_id, voter_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  stars int not null check (stars between 1 and 5),
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  hidden_reason text check (hidden_reason in ('spam', 'harassment', 'personal_data', 'copied')),
  created_at timestamptz not null default now(),
  unique (listing_id, author_id)
);

create table public.review_replies (
  review_id uuid primary key references public.reviews (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- Only the listing's owner may reply to a review of it.
create or replace function public.enforce_reply_by_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.reviews r join public.listings l on l.id = r.listing_id
    where r.id = new.review_id and l.owner_id = new.author_id
  ) then
    raise exception 'only the listing owner can reply';
  end if;
  return new;
end $$;
create trigger reply_by_owner before insert on public.review_replies
  for each row execute function public.enforce_reply_by_owner();

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  category text not null check (category in ('safety', 'spam', 'copied', 'personal_data', 'other')),
  reason text not null check (char_length(reason) between 5 and 1000),
  created_at timestamptz not null default now(),
  unique (listing_id, reporter_id)
);

-- Decision 5: a listing is hidden after 3 reports, pending review.
create or replace function public.hide_after_reports() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.reports where listing_id = new.listing_id) >= 3 then
    update public.listings set status = 'hidden', updated_at = now()
      where id = new.listing_id and status = 'live';
    insert into public.moderation_actions (listing_id, actor_id, action, reason)
      values (new.listing_id, null, 'auto_hide', '3 reports');
  end if;
  return new;
end $$;

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('auto_hide', 'hide', 'reinstate', 'remove', 'hide_review', 'restore_review')),
  reason text not null,
  created_at timestamptz not null default now()
);

create trigger reports_hide after insert on public.reports
  for each row execute function public.hide_after_reports();

-- ---------- public read models ----------
create view public.listing_stats with (security_invoker = true) as
  select l.id as listing_id,
         (select count(*) from public.votes v where v.listing_id = l.id) as votes,
         (select round(avg(stars)::numeric, 2) from public.reviews r where r.listing_id = l.id and r.status = 'visible') as stars,
         (select count(*) from public.reviews r where r.listing_id = l.id and r.status = 'visible') as reviews
  from public.listings l;

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.moderators enable row level security;
alter table public.listings enable row level security;
alter table public.versions enable row level security;
alter table public.version_checkpoints enable row level security;
alter table public.votes enable row level security;
alter table public.reviews enable row level security;
alter table public.review_replies enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;

create policy profiles_read on public.profiles for select using (true);

create policy moderators_read on public.moderators for select to authenticated using (public.is_moderator());

-- Listings: everyone reads live ones; owners and moderators also see their hidden or removed ones.
create policy listings_read on public.listings for select
  using (status = 'live' or owner_id = auth.uid() or public.is_moderator());
create policy listings_insert on public.listings for insert to authenticated
  with check (owner_id = auth.uid());
-- Owners edit their own listing but cannot un-hide it; only moderators change a hidden status.
create policy listings_update_owner on public.listings for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and status in ('live', 'removed'));
create policy listings_update_mod on public.listings for update to authenticated
  using (public.is_moderator()) with check (true);

create or replace function public.guard_listing_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'hidden' and new.status <> 'hidden' and not public.is_moderator() then
    raise exception 'a hidden listing can only be reinstated by a moderator';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger listing_status_guard before update on public.listings
  for each row execute function public.guard_listing_status();

create policy versions_read on public.versions for select
  using (exists (select 1 from public.listings l where l.id = listing_id and (l.status = 'live' or l.owner_id = auth.uid() or public.is_moderator())));
create policy versions_insert on public.versions for insert to authenticated
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid() and l.status = 'live'));

create policy vcp_read on public.version_checkpoints for select
  using (exists (select 1 from public.versions v join public.listings l on l.id = v.listing_id
                 where v.id = version_id and (l.status = 'live' or l.owner_id = auth.uid() or public.is_moderator())));
create policy vcp_insert on public.version_checkpoints for insert to authenticated
  with check (exists (select 1 from public.versions v join public.listings l on l.id = v.listing_id
                      where v.id = version_id and l.owner_id = auth.uid()));

-- Votes: anyone reads counts; one vote per account; account at least 7 days old; not on your own listing.
create policy votes_read on public.votes for select using (true);
create policy votes_insert on public.votes for insert to authenticated
  with check (voter_id = auth.uid() and public.account_age_days() >= 7
              and not exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy votes_delete on public.votes for delete to authenticated using (voter_id = auth.uid());

create policy reviews_read on public.reviews for select
  using (status = 'visible' or author_id = auth.uid() or public.is_moderator());
create policy reviews_insert on public.reviews for insert to authenticated
  with check (author_id = auth.uid() and status = 'visible'
              and not exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy reviews_update_author on public.reviews for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid() and status = 'visible');
create policy reviews_update_mod on public.reviews for update to authenticated
  using (public.is_moderator()) with check (true);

create policy replies_read on public.review_replies for select using (true);
create policy replies_insert on public.review_replies for insert to authenticated with check (author_id = auth.uid());

-- Reports: insert only. Reporters see their own; moderators see all; listing owners see reports on their listings.
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy reports_read on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_moderator()
         or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));

create policy modactions_read on public.moderation_actions for select to authenticated
  using (public.is_moderator() or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy modactions_insert on public.moderation_actions for insert to authenticated
  with check (public.is_moderator() and actor_id = auth.uid());

-- ---------- storage: jars and bundles, 10 MB each ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jars', 'jars', true, 10485760, array['application/java-archive', 'application/octet-stream']),
       ('bundles', 'bundles', true, 10485760, array['application/json', 'application/jsonl', 'text/markdown', 'text/plain', 'application/octet-stream'])
on conflict (id) do nothing;

-- Objects live under <owner uid>/<listing id>/...; only the owner can write there.
create policy jars_write on storage.objects for insert to authenticated
  with check (bucket_id in ('jars', 'bundles') and (storage.foldername(name))[1] = auth.uid()::text);
create policy jars_read on storage.objects for select using (bucket_id in ('jars', 'bundles'));
create policy jars_delete on storage.objects for delete to authenticated
  using (bucket_id in ('jars', 'bundles') and ((storage.foldername(name))[1] = auth.uid()::text or public.is_moderator()));
