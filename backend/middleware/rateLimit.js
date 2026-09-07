import rateLimit from "express-rate-limit";

// Baseline guard against automated abuse across the whole API. Generous
// enough to not interfere with normal Retell/Telnyx traffic (which is now
// also gated by requireRetellSecret) or a busy dashboard session — this is
// a circuit breaker, not the primary control.
export const generalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public, unauthenticated, human-facing forms (signup, contact) — a real
// visitor submits these once, not repeatedly, so this can be tight without
// risking false positives.
export const strictLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
