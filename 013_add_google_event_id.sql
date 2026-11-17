-- Run in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Links each booking to the Google Calendar event created for it, so a
-- reschedule moves that same event and a cancellation deletes it
-- (service/googleCalendar.js). Nullable: bookings for businesses without
-- Google Calendar sync simply leave it empty.

alter table public.bookings
  add column if not exists google_event_id text;
