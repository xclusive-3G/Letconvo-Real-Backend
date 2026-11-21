-- Run in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Lets a business owner pause their AI receptionist from the dashboard
-- (Settings -> Danger Zone). Kept separate from clients.status, which the
-- system also flips to "paused" on low credits and back to "active" on a
-- top-up — this flag stops those automatic resumes from undoing an owner's
-- deliberate pause.

alter table public.clients
  add column if not exists paused_by_owner boolean not null default false;
