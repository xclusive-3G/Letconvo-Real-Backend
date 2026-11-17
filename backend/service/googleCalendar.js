// Google Calendar sync for bookings.
//
// When a business has connected Google Calendar (calendar_integrations row,
// connected = true) AND has "Google Calendar Sync" switched on
// (client_settings.calendar_sync = true), every booking path keeps the
// business's calendar in step with the bookings table:
//
//   read   -> getBusyIntervals / isSlotBusy: the owner's existing calendar
//             events block those times from being offered or booked
//   store  -> syncBookingToCalendar: a new booking creates an event
//   modify -> syncBookingToCalendar: a reschedule moves the event, a
//             cancellation deletes it
//
// The bookings table stays the source of truth. Every function here is
// best-effort: a Google outage, an expired grant, or a slow response must
// never block or fail a booking — callers get null/false back and the
// booking proceeds on the DB alone.

import { google } from "googleapis";
import { supabase } from "../config/supabase.js";
import { createOAuthClient } from "../config/googleOath.js";
import { ACTIVE_STATUSES, toHHMM } from "../utils/bookings.js";
import { resolveTimeZone, wallTimeToUtcMs } from "../utils/timezone.js";

export { wallTimeToUtcMs };

// Slots are hourly (see router/retellGetSlot.js), so each booking blocks
// one hour on the calendar.
export const APPOINTMENT_MINUTES = 60;

const GOOGLE_TIMEOUT_MS = 5000;

// Adds minutes to a wall-clock date/time without involving any timezone,
// e.g. ("2026-11-20", "23:30", 60) -> { date: "2026-11-21", time: "00:30" }.
function addMinutesToWallTime(dateStr, hhmm, minutes) {
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  const [h, mi] = toHHMM(hhmm).split(":").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, (mi || 0) + minutes, 0));
  return {
    date: t.toISOString().slice(0, 10),
    time: t.toISOString().slice(11, 16)
  };
}

// ---------------------------------------------------------------------------
// Connection lookup
// ---------------------------------------------------------------------------

/**
 * Returns { calendar, calendarId, timeZone, userId } when this business has
 * Google Calendar connected AND sync switched on; otherwise null.
 * A fresh OAuth2 client per call — never a shared module-level one — so two
 * businesses' requests can't end up using each other's credentials.
 */
export async function getCalendarContext(clientId) {
  try {
    if (!clientId) return null;

    const { data: client } = await supabase
      .from("clients")
      .select("user_id")
      .eq("id", clientId)
      .maybeSingle();
    if (!client?.user_id) return null;

    const { data: settings } = await supabase
      .from("client_settings")
      .select("calendar_sync, timezone")
      .eq("client_id", clientId)
      .maybeSingle();
    if (settings?.calendar_sync !== true) return null;

    const { data: integration } = await supabase
      .from("calendar_integrations")
      .select("refresh_token, calendar_id, connected")
      .eq("user_id", client.user_id)
      .eq("provider", "google")
      .maybeSingle();
    if (!integration?.connected || !integration.refresh_token) return null;

    const auth = createOAuthClient();
    auth.setCredentials({ refresh_token: integration.refresh_token });

    return {
      calendar: google.calendar({ version: "v3", auth }),
      calendarId: integration.calendar_id || "primary",
      timeZone: resolveTimeZone(settings?.timezone),
      userId: client.user_id
    };
  } catch (err) {
    console.error("⚠️ Google Calendar context lookup failed:", err.message);
    return null;
  }
}

// If the business revoked Letconvo's access in their Google account, mark
// the integration disconnected so the dashboard stops claiming it's
// connected and we stop retrying on every booking.
async function handleGoogleError(ctx, err, action) {
  const reason = err?.response?.data?.error || err?.message;
  console.error(`⚠️ Google Calendar ${action} failed:`, reason);
  if (reason === "invalid_grant" && ctx?.userId) {
    await supabase
      .from("calendar_integrations")
      .update({ connected: false })
      .eq("user_id", ctx.userId)
      .eq("provider", "google");
    console.warn(`⚠️ Google Calendar access revoked for user ${ctx.userId} — marked disconnected`);
  }
}

// ---------------------------------------------------------------------------
// Read: busy times
// ---------------------------------------------------------------------------

/**
 * Busy intervals ([{ start, end }] in epoch ms) on the business's calendar
 * between two instants. Events marked "Free" (transparent — which is the
 * Google default for all-day events), cancelled events, and events the
 * business declined are ignored. Pass excludeEventId to ignore a booking's
 * own event (e.g. when rescheduling it).
 * Returns null when sync isn't active or Google can't be reached, so
 * callers fall back to DB-only availability.
 */
export async function getBusyIntervals(clientId, fromMs, toMs, { excludeEventId, ctx: givenCtx } = {}) {
  const ctx = givenCtx || (await getCalendarContext(clientId));
  if (!ctx) return null;

  try {
    const busy = [];
    let pageToken;
    do {
      const { data } = await ctx.calendar.events.list(
        {
          calendarId: ctx.calendarId,
          timeMin: new Date(fromMs).toISOString(),
          timeMax: new Date(toMs).toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
          pageToken
        },
        { timeout: GOOGLE_TIMEOUT_MS }
      );

      for (const ev of data.items || []) {
        if (ev.status === "cancelled") continue;
        if (ev.transparency === "transparent") continue;
        if (excludeEventId && ev.id === excludeEventId) continue;
        const self = (ev.attendees || []).find((a) => a.self);
        if (self?.responseStatus === "declined") continue;

        const tz = ev.start?.timeZone || ctx.timeZone;
        const start = ev.start?.dateTime
          ? Date.parse(ev.start.dateTime)
          : wallTimeToUtcMs(ev.start?.date, "00:00", tz);
        const end = ev.end?.dateTime
          ? Date.parse(ev.end.dateTime)
          : wallTimeToUtcMs(ev.end?.date, "00:00", tz);
        if (Number.isFinite(start) && Number.isFinite(end)) busy.push({ start, end });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return busy;
  } catch (err) {
    await handleGoogleError(ctx, err, "busy-time lookup");
    return null;
  }
}

export function overlapsBusy(busy, startMs, endMs) {
  return (busy || []).some((b) => b.start < endMs && b.end > startMs);
}

/**
 * True when the business's Google Calendar already has something at this
 * local date/time. False when it's free, sync is off, or Google is
 * unreachable (the DB clash check still applies either way).
 */
export async function isSlotBusy(clientId, dateStr, hhmm, { excludeEventId } = {}) {
  const ctx = await getCalendarContext(clientId);
  if (!ctx) return false;

  const start = wallTimeToUtcMs(dateStr, hhmm, ctx.timeZone);
  const end = start + APPOINTMENT_MINUTES * 60 * 1000;
  const busy = await getBusyIntervals(clientId, start, end, { excludeEventId, ctx });
  return overlapsBusy(busy, start, end);
}

// ---------------------------------------------------------------------------
// Store / modify: booking -> calendar event
// ---------------------------------------------------------------------------

function buildEventBody(booking, timeZone) {
  const startTime = toHHMM(booking.appointment_time);
  const end = addMinutesToWallTime(booking.appointment_date, startTime, APPOINTMENT_MINUTES);
  const what = booking.service || "Appointment";

  const description = [
    `Customer: ${booking.customer_name}`,
    booking.customer_phone ? `Phone: ${booking.customer_phone}` : null,
    booking.customer_email ? `Email: ${booking.customer_email}` : null,
    booking.service ? `Service: ${booking.service}` : null,
    booking.notes ? `Notes: ${booking.notes}` : null,
    `Status: ${booking.status}`,
    "",
    "Booked by Letconvo AI receptionist."
  ]
    .filter((line) => line !== null)
    .join("\n");

  return {
    summary: `${what} – ${booking.customer_name}`,
    description,
    start: { dateTime: `${booking.appointment_date}T${startTime}:00`, timeZone },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone },
    extendedProperties: { private: { letconvoBookingId: String(booking.id) } }
  };
}

async function saveEventId(bookingId, eventId) {
  const { error } = await supabase
    .from("bookings")
    .update({ google_event_id: eventId })
    .eq("id", bookingId);
  if (error) console.error("⚠️ Could not save google_event_id on booking:", error.message);
}

const isGone = (err) => [404, 410].includes(err?.code || err?.response?.status);

/**
 * Brings the business's calendar in line with this booking row:
 *   active (pending/confirmed/rescheduled) -> create the event, or update it
 *   cancelled                              -> delete the event
 *   completed                              -> leave the event as a record
 * Never throws.
 */
export async function syncBookingToCalendar(booking) {
  if (!booking?.id || !booking.client_id) return;

  const ctx = await getCalendarContext(booking.client_id);
  if (!ctx) return;

  try {
    if (booking.status === "cancelled") {
      if (booking.google_event_id) {
        try {
          await ctx.calendar.events.delete(
            { calendarId: ctx.calendarId, eventId: booking.google_event_id },
            { timeout: GOOGLE_TIMEOUT_MS }
          );
        } catch (err) {
          if (!isGone(err)) throw err;
        }
        await saveEventId(booking.id, null);
        console.log(`🗓️ Removed Google Calendar event for cancelled booking ${booking.id}`);
      }
      return;
    }

    if (!ACTIVE_STATUSES.includes(booking.status)) return;

    const requestBody = buildEventBody(booking, ctx.timeZone);

    if (booking.google_event_id) {
      try {
        await ctx.calendar.events.patch(
          { calendarId: ctx.calendarId, eventId: booking.google_event_id, requestBody },
          { timeout: GOOGLE_TIMEOUT_MS }
        );
        console.log(`🗓️ Updated Google Calendar event for booking ${booking.id}`);
        return;
      } catch (err) {
        // The owner deleted the event in Google — fall through and recreate it.
        if (!isGone(err)) throw err;
      }
    }

    const { data: event } = await ctx.calendar.events.insert(
      { calendarId: ctx.calendarId, requestBody },
      { timeout: GOOGLE_TIMEOUT_MS }
    );
    await saveEventId(booking.id, event.id);
    console.log(`🗓️ Created Google Calendar event for booking ${booking.id}`);
  } catch (err) {
    await handleGoogleError(ctx, err, `sync for booking ${booking.id}`);
  }
}

/**
 * Pushes this business's upcoming active bookings that aren't on the
 * calendar yet. Run when the calendar is first connected or sync is
 * switched on, so existing appointments show up too. Never throws.
 */
export async function backfillUpcomingBookings(clientId) {
  try {
    const ctx = await getCalendarContext(clientId);
    if (!ctx) return 0;

    const today = new Date().toISOString().slice(0, 10);
    const { data: bookings, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("client_id", clientId)
      .in("status", ACTIVE_STATUSES)
      .is("google_event_id", null)
      .gte("appointment_date", today)
      .order("appointment_date", { ascending: true })
      .limit(50);
    if (error) throw error;

    for (const booking of bookings || []) {
      await syncBookingToCalendar(booking);
    }
    if (bookings?.length) {
      console.log(`🗓️ Backfilled ${bookings.length} upcoming booking(s) to Google Calendar for client ${clientId}`);
    }
    return bookings?.length || 0;
  } catch (err) {
    console.error("⚠️ Google Calendar backfill failed:", err.message);
    return 0;
  }
}
