import crypto from "node:crypto";

// Every endpoint here is meant to be reachable only by Retell (tool calls
// during a live call, or Retell's own webhooks) — but nothing before this
// verified that. Any of them could be hit directly by anyone who knew the
// URL and a clientId, which is how the booking-IDOR/billing-forgery
// vulnerabilities were exploitable. This checks a shared secret that only
// our server and Retell's own config (tool custom headers, or the
// webhook URL's query string) know.
//
// Fails OPEN (logs a warning, lets the request through) as long as
// RETELL_SHARED_SECRET isn't set, so deploying this code doesn't break live
// calls before the matching secret has been configured on Retell's side —
// see backend-updated's deploy notes. Once the env var is set in
// production, enforcement becomes real.
let warnedMissingSecret = false;

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Returns true if the request should be let through: either a valid secret
// was provided, or no secret has been configured yet (fail-open, see above).
export function isRetellRequestAuthorized(req) {
  const expected = process.env.RETELL_SHARED_SECRET;

  if (!expected) {
    if (!warnedMissingSecret) {
      console.warn(
        "⚠️ RETELL_SHARED_SECRET is not set — Retell-facing endpoints are running WITHOUT authentication. " +
        "Set RETELL_SHARED_SECRET and configure the same value on Retell's side (tool custom header " +
        "x-retell-secret, or ?secret=... on the webhook URL) to close this off."
      );
      warnedMissingSecret = true;
    }
    return true;
  }

  const provided = req.headers["x-retell-secret"] || req.query?.secret;
  return Boolean(provided) && timingSafeEqual(provided, expected);
}

export function requireRetellSecret(req, res, next) {
  if (!isRetellRequestAuthorized(req)) {
    console.warn("❌ Rejected request with missing/invalid Retell shared secret:", req.originalUrl);
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}
