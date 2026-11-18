-- Run in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Each business gets a Retell knowledge base built from its website at
-- signup (service/retellKnowledgeBase.js). The id is attached to that
-- business's calls by router/retellInboundWebhook.js once Retell reports
-- it ready; the status is cached here so calls don't have to ask Retell.

alter table public.client_settings
  add column if not exists retell_knowledge_base_id text,
  add column if not exists retell_knowledge_base_status text;
