create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  email text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;
create policy "anyone can join the waitlist" on public.waitlist for insert to anon with check (true);
