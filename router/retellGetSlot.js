import express from "express";
import { supabase } from "../config/supabase.js";
import { getBusinessHours, workingDaySet, formatWorkingDaysText, ACTIVE_STATUSES, resolveRetellClientId } from "../utils/bookings.js";
import { requireRetellSecret } from "../middleware/retellAuth.js";

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

    const now = new Date();
    const windowDays = Number(days) > 0 ? Number(days) : 7;
    const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const { openHour, closeHour, workingDays } = await getBusinessHours(clientId);
    const openDays = workingDaySet(workingDays);

    const todayStr = now.toISOString().slice(0, 10);
    const endStr = windowEnd.toISOString().slice(0, 10);

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

    // Build available slots, one per hour, within business hours, skipping
    // any day not in the client's configured working days.
    const slots = [];
    const cursor = new Date(now);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(cursor.getHours() + 1);

    while (cursor <= windowEnd && slots.length < 12) {
      const day = cursor.getDay();
      const hour = cursor.getHours();

      if (openDays.has(day) && hour >= openHour && hour < closeHour) {
        const dateStr = cursor.toISOString().slice(0, 10);
        const timeStr = `${String(hour).padStart(2, "0")}:00`;
        const key = `${dateStr}T${timeStr}`;

        if (!bookedKeys.has(key)) {
          slots.push({
            date: cursor.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric"
            }),
            time: cursor.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit"
            }),
            raw_date: dateStr,
            raw_time: timeStr,
            iso: cursor.toISOString()
          });
        }
      }
      cursor.setHours(cursor.getHours() + 1);
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
