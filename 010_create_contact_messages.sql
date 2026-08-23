-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Stores public "Contact Us" form submissions (letconvo.live/#contact) so
-- they show up as a real inbox on the admin panel, not just a fire-and-forget
-- email.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  email text not null,
  phone text,
  company_name text,
  interest text,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);
