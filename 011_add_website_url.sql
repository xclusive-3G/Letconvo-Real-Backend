-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Stores the client's business website URL, collected at signup, as
-- reference material for hand-building that client's Retell agent prompt
-- (same role as client_settings.services_offered/booking_policies) — not
-- fetched/scraped by the backend.

alter table public.client_settings
  add column if not exists website_url text;
