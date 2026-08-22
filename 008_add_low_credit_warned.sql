-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Tracks whether the one-time "credit balance getting low" warning email
-- has already been sent for the client's current low-balance episode, so
-- it fires exactly once per dip below the threshold instead of on every
-- deduction while the balance stays low. Reset to false automatically
-- once the balance recovers back above the threshold (service/credit.js's
-- pauseClientIfLowCredits).

alter table public.clients
  add column if not exists low_credit_warned boolean not null default false;
