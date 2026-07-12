-- ===========================================================================
--  Susana Stethers Photography — database schema & security policies
--  Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
--
--  Safe to run more than once (everything is IF NOT EXISTS / DROP-then-CREATE).
--
--  ---------------------------------------------------------------------
--  READ THIS FIRST — why this file exists
--  ---------------------------------------------------------------------
--  The site ships a PUBLIC Supabase key in js/config.js. That is normal and
--  correct — but it means ANY visitor can call the database API directly with
--  that key. The email check in js/admin.js ("if user.email !== OWNER_EMAIL")
--  is client-side JavaScript. An attacker never runs your JavaScript. They
--  call the API straight from a terminal.
--
--  So: the ONLY thing standing between a stranger and Susana's client list is
--  the Row Level Security below. Everything else is decoration.
--
--  Threat model this defends against:
--    1. Stranger reads every client inquiry (name, email, phone, message).
--    2. Stranger signs up via the open signUp() endpoint, becomes
--       "authenticated", and thereby gains access. <- the subtle one.
--       We therefore key admin access to a specific OWNER USER ID, never to
--       the blanket `authenticated` role.
--    3. Stranger defaces the site by overwriting photo URLs.
--    4. Stranger uploads arbitrary files (malware, illegal content) to storage.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. WHO IS AN ADMIN
--    A table, not a hardcoded email. Policies reference this.
--    An attacker can sign up, but they cannot insert themselves here:
--    this table is writable by nobody through the API (no policy = no access).
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- Deliberately NO policies on this table. With RLS on and no policy, the
-- anon and authenticated roles get nothing — not even SELECT. Only the
-- service role (dashboard / server) can touch it. That is the point.

-- Helper: is the current caller an admin?
-- SECURITY DEFINER so it can read public.admins despite that table's RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. INQUIRIES  (contact form submissions — REAL CLIENT PII)
-- ---------------------------------------------------------------------------
create table if not exists public.inquiries (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text not null,
  email        text not null,
  session_type text,
  message      text,
  status       text not null default 'new',
  session_date date,
  admin_notes  text
);

-- Server-side length limits. The maxlength attributes in the HTML are a
-- courtesy to humans; a bot posting straight to the API ignores them. These
-- constraints are what actually stop someone writing 40 MB into the table.
alter table public.inquiries drop constraint if exists inquiries_name_len;
alter table public.inquiries drop constraint if exists inquiries_email_len;
alter table public.inquiries drop constraint if exists inquiries_message_len;
alter table public.inquiries drop constraint if exists inquiries_email_shape;
alter table public.inquiries drop constraint if exists inquiries_status_valid;

alter table public.inquiries
  add constraint inquiries_name_len     check (char_length(name)    between 1 and 100),
  add constraint inquiries_email_len    check (char_length(email)   between 3 and 200),
  add constraint inquiries_message_len  check (message is null or char_length(message) <= 2000),
  add constraint inquiries_email_shape  check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add constraint inquiries_status_valid check (status in ('new','contacted','booked','completed','archived'));

create index if not exists inquiries_created_at_idx on public.inquiries (created_at desc);

alter table public.inquiries enable row level security;

drop policy if exists "anon can submit an inquiry"      on public.inquiries;
drop policy if exists "admin can read inquiries"        on public.inquiries;
drop policy if exists "admin can update inquiries"      on public.inquiries;
drop policy if exists "admin can delete inquiries"      on public.inquiries;

-- The public may INSERT. That is all. No SELECT — so a visitor cannot read
-- back even their own submission, let alone anyone else's.
create policy "anon can submit an inquiry"
  on public.inquiries for insert
  to anon, authenticated
  with check (
    status = 'new'          -- can't self-promote a booking to "booked"
    and session_date is null
    and admin_notes is null -- can't inject into the private notes field
  );

create policy "admin can read inquiries"
  on public.inquiries for select
  to authenticated
  using (public.is_admin());

create policy "admin can update inquiries"
  on public.inquiries for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin can delete inquiries"
  on public.inquiries for delete
  to authenticated
  using (public.is_admin());


-- ---------------------------------------------------------------------------
-- 3. SITE_IMAGES  (which photo fills which slot on the website)
--    Public may read (the website needs it). Only an admin may change it,
--    otherwise a stranger could repoint the hero image at anything they like.
-- ---------------------------------------------------------------------------
create table if not exists public.site_images (
  slot         text primary key,
  label        text not null,
  section      text not null default 'General',
  url          text,
  storage_path text,
  alt          text,
  sort         int  not null default 0,
  updated_at   timestamptz not null default now()
);

alter table public.site_images enable row level security;

drop policy if exists "anyone can read site images"   on public.site_images;
drop policy if exists "admin can update site images"  on public.site_images;
drop policy if exists "admin can insert site images"  on public.site_images;

create policy "anyone can read site images"
  on public.site_images for select
  to anon, authenticated
  using (true);

create policy "admin can update site images"
  on public.site_images for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin can insert site images"
  on public.site_images for insert
  to authenticated
  with check (public.is_admin());


-- ---------------------------------------------------------------------------
-- 4. SITE_CONTENT  (every editable piece of text on the website)
--    key = stable identifier used by the build script, e.g. 'home.hero.title'
-- ---------------------------------------------------------------------------
create table if not exists public.site_content (
  key        text primary key,
  value      text not null default '',
  label      text not null,
  page       text not null default 'home',
  section    text not null default 'General',
  kind       text not null default 'text',   -- text | textarea | price | list
  sort       int  not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;

drop policy if exists "anyone can read site content"  on public.site_content;
drop policy if exists "admin can update site content" on public.site_content;
drop policy if exists "admin can insert site content" on public.site_content;

create policy "anyone can read site content"
  on public.site_content for select
  to anon, authenticated
  using (true);

create policy "admin can update site content"
  on public.site_content for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin can insert site content"
  on public.site_content for insert
  to authenticated
  with check (public.is_admin());


-- ---------------------------------------------------------------------------
-- 4b. ADMIN_SETTINGS  (private config — currently the Vercel deploy hook)
--
--     The deploy-hook URL is a "capability URL": anyone who has it can trigger
--     a rebuild of the website. That's not catastrophic, but it is free DDoS
--     fuel and it burns her build minutes. So it does NOT go in config.js.
--     It lives here, readable only by an admin.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.admin_settings enable row level security;

drop policy if exists "admin can read settings"   on public.admin_settings;
drop policy if exists "admin can update settings" on public.admin_settings;

create policy "admin can read settings"
  on public.admin_settings for select
  to authenticated
  using (public.is_admin());

create policy "admin can update settings"
  on public.admin_settings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.admin_settings (key, value)
values ('vercel_deploy_hook', null)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 5. STORAGE  (the 'site-media' bucket that photo uploads land in)
--    Without these, anyone with the public key can upload anything —
--    malware, illegal content — into Susana's bucket, hosted on her domain.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-media', 'site-media', true,
  15728640,                                              -- 15 MB ceiling
  array['image/jpeg','image/png','image/webp']           -- images only, enforced server-side
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = 15728640,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "public can view site media"    on storage.objects;
drop policy if exists "admin can upload site media"   on storage.objects;
drop policy if exists "admin can update site media"   on storage.objects;
drop policy if exists "admin can delete site media"   on storage.objects;

create policy "public can view site media"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'site-media');

create policy "admin can upload site media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'site-media' and public.is_admin());

create policy "admin can update site media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'site-media' and public.is_admin());

create policy "admin can delete site media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'site-media' and public.is_admin());


-- ===========================================================================
--  6. MAKE SUSANA AN ADMIN
--
--  Run this AFTER she has created her account (see MANUAL STEPS below).
--  Nothing in the admin portal works until this row exists.
-- ===========================================================================
insert into public.admins (user_id, email)
select id, email from auth.users
where lower(email) = lower('susanastethersphotography@gmail.com')
on conflict (user_id) do nothing;


-- ===========================================================================
--  VERIFY — run this after the above and read the output.
-- ===========================================================================
select 'RLS enabled?' as check, relname as object,
       case when relrowsecurity then 'YES ✅' else 'NO  ❌ DANGER' end as result
from pg_class
where relname in ('inquiries','site_images','site_content','admins')
union all
select 'Admin registered?', coalesce(email,'(none)'),
       case when count(*) over () > 0 then 'YES ✅' else 'NO  ❌ portal will not work' end
from public.admins
union all
select 'Public can read inquiries?', 'inquiries',
       case when exists (
         select 1 from pg_policies
         where schemaname='public' and tablename='inquiries' and cmd='SELECT'
           and 'anon' = any(roles)
       ) then 'YES ❌ CLIENT DATA IS EXPOSED' else 'NO ✅' end;
