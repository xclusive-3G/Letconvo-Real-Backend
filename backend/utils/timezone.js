// Timezone helpers. Bookings store wall-clock date/time strings in the
// business's own timezone (client_settings.timezone, an IANA name such as
// "America/New_York"), while the server itself runs in UTC — so anything
// that reasons about "now", "today" or an appointment's real moment must
// go through these instead of the server's local Date methods.

// Local copy of utils/bookings.js's toHHMM ("14:05:00" -> "14:05") so this
// module stays dependency-free (bookings.js pulls in the Redis queue).
const toHHMM = (time) => String(time || "").slice(0, 5);

// Target market is US/Canada; used when a business hasn't set a timezone.
export const DEFAULT_TIMEZONE = "America/New_York";

export function isValidTimeZone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(tz) {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}

/**
 * The wall-clock parts of an instant in a timezone:
 * { date: "YYYY-MM-DD", hour, minute, weekday } (weekday 0 = Sunday).
 */
export function zonedParts(instantMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(instantMs));
  const get = (t) => parts.find((p) => p.type === t).value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    date,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: weekdayOf(date)
  };
}

function tzOffsetMs(instantMs, timeZone) {
  const p = zonedParts(instantMs, timeZone);
  const [y, mo, d] = p.date.split("-").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, p.hour, p.minute, p.second);
  return asUtc - instantMs;
}

// "2026-11-20", "14:00", "America/New_York" -> UTC epoch ms of that local moment.
export function wallTimeToUtcMs(dateStr, hhmm, timeZone) {
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  const [h, mi] = toHHMM(hhmm || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi || 0, 0);
  let result = guess - tzOffsetMs(guess, timeZone);
  // Second pass corrects the rare case where the first guess straddles a DST change.
  result = guess - tzOffsetMs(result, timeZone);
  return result;
}

// Day of week (0 = Sunday) of a calendar date, independent of any timezone.
export function weekdayOf(dateStr) {
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

// "2026-11-30" + 2 -> "2026-12-02" (pure calendar arithmetic).
export function addDays(dateStr, n) {
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}
