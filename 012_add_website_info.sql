-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Stores plain-text content scraped from client_settings.website_url at
-- signup (service/websiteInfo.js) — fed to the AI receptionist as a
-- dynamic variable so it can answer questions about the business from real
-- site content instead of guessing.

alter table public.client_settings
  add column if not exists website_info text;
