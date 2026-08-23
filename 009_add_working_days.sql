-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Stores which days of the week a client is open, so the Retell agent can
-- answer "are you open Saturdays?" from real per-client data instead of
-- the previous hardcoded "closed Sundays only" assumption baked into
-- retellGetSlot.js's slot generation and business-hours tool.

alter table public.client_settings
  add column if not exists working_days text[]
  not null default array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
