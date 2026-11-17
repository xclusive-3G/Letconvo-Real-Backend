import express from "express";
import { supabase } from "../config/supabase.js";
import { getBusinessHours, workingDaySet, formatWorkingDaysText, ACTIVE_STATUSES, resolveRetellClientId } from "../utils/bookings.js";
import { requireRetellSecret } from "../middleware/retellAuth.js";
import {
  APPOINTMENT_MINUTES,
  getCalendarContext,
  getBusyIntervals,
  overlapsBusy
} from "../service/googleCalendar.js";
import {
  resolveTimeZone,
  zonedParts,
  wallTimeToUtcMs,
  weekdayOf,
  addDays
} from "../utils/timezone.js";

const HOUR_MS = 60 * 60 * 1000;
const MAX_SLOTS = 12;

const router = express.Router();

// Called by the Retell agent mid-call to find open appointment slots.
router.post("/retell/get-slots", requireRetellSecret, async (req, res) => {
  console.log("📅 Fetching available slots...");

  try {
    const clientId = resolveRetellClientId(req);
    const { days } = req.body;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required", slots: [] });
    }

    const nowMs = Date.now();
    const windowDays = Number(days) > 0 ? Number(days) : 7;

    const { openHour, closeHour, workingDays, timezone } = await getBusinessHours(clientId);
    const openDays = workingDaySet(workingDays);

    // Everything below is in the business's own timezone — "today", the
    // current hour, the day of week and the business hours — not the
    // server's clock (UTC on EC2). Bookings store local wall-clock times,
    // so raw_date/raw_time stay directly comparable with them.
    const tz = resolveTimeZone(timezone);
    const todayStr = zonedParts(nowMs, tz).date;
    const endStr = addDays(todayStr, windowDays);
    const windowEndMs = nowMs + windowDays * 24 * HOUR_MS;

    // Get already booked slots for this business in the window.
    const { data: booked, error: bookedError } = await supabase
      .from("bookings")
      .select("appointment_date, appointment_time")
      .eq("client_id", clientId)
      .gte("appointment_date", todayStr)
      .lte("appointment_date", endStr)
      .in("status", ACTIVE_STATUSES);

    if (bookedError) throw bookedError;

    const bookedKeys = new Set(
      (booked || []).map(
        (b) => `${b.appointment_date}T${String(b.appointment_time).slice(0, 5)}`
      )
    );

    // If the business synced Google Calendar, also skip times that are
    // already taken there (the owner's own meetings, blocks, etc.). null
    // when sync is off or Google is unreachable -> DB-only availability.
    const calendarCtx = await getCalendarContext(clientId);
    const busy = calendarCtx
      ? await getBusyIntervals(
          clientId,
          nowMs - 24 * HOUR_MS,
          windowEndMs + 2 * 24 * HOUR_MS,
          { ctx: calendarCtx }
        )
      : null;

    const busyInCalendar = (startMs) =>
      busy ? overlapsBusy(busy, startMs, startMs + APPOINTMENT_MINUTES * 60 * 1000) : false;

    // Walk the business's local calendar day by day and hour by hour within
    // its opening hours, skipping non-working days, hours that have already
    // started, booked slots and (if synced) Google Calendar busy times.
    const slots = [];
    const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
    const timeLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

    for (let d = 0; d <= windowDays && slots.length < MAX_SLOTS; d++) {
      const dateStr = addDays(todayStr, d);
      if (!openDays.has(weekdayOf(dateStr))) continue;

      for (let hour = openHour; hour < closeHour && slots.length < MAX_SLOTS; hour++) {
        const timeStr = `${String(hour).padStart(2, "0")}:00`;
        const startMs = wallTimeToUtcMs(dateStr, timeStr, tz);

        // Not in the past (or already under way), and within the window.
        if (startMs <= nowMs || startMs > windowEndMs) continue;
        // A DST "spring forward" gap can make a wall time not exist (e.g.
        // 02:00); wallTimeToUtcMs then lands on another hour — skip it.
        if (zonedParts(startMs, tz).hour !== hour) continue;

        if (bookedKeys.has(`${dateStr}T${timeStr}`) || busyInCalendar(startMs)) continue;

        slots.push({
          date: dateLabel.format(startMs),
          time: timeLabel.format(startMs),
          raw_date: dateStr,
          raw_time: timeStr,
          iso: new Date(startMs).toISOString(),
          timezone: tz
        });
      }
    }

    return res.json({ slots });

  } catch (err) {
    console.error("❌ get-slots error:", err);
    return res.status(500).json({ slots: [], error: err.message });
  }
});

const formatHour = (h) => {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
};

// Called by the Retell agent mid-call when a caller asks about business
// hours. Live inbound calls are transferred to Retell over a raw SIP
// trunk (see service/telnyx.js's transferCallToRetellSip) with no channel
// to inject per-client dynamic variables at call start, so this works the
// same way /retell/get-slots does — the agent calls it on demand instead
// of relying on hours being baked into the call setup.
router.post("/retell/get-business-hours", requireRetellSecret, async (req, res) => {
  try {
    const clientId = resolveRetellClientId(req);

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    const { openHour, closeHour, workingDays } = await getBusinessHours(clientId);

    return res.json({
      openHour,
      closeHour,
      workingDays,
      hoursText: `We're open from ${formatHour(openHour)} to ${formatHour(closeHour)} on ${formatWorkingDaysText(workingDays)}.`
    });
  } catch (err) {
    console.error("❌ get-business-hours error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
