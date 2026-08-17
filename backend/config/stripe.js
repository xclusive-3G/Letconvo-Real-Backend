import Stripe from "stripe";

// Lazily-initialized: returns null instead of throwing when
// STRIPE_SECRET_KEY isn't set, so the server keeps running (and every other
// unrelated route keeps working) before billing is actually configured.
// Callers must check for null and respond with a clear "not configured"
// error rather than crashing.
let stripeClient = null;
let attempted = false;

export function getStripe() {
  if (!attempted) {
    attempted = true;
    if (process.env.STRIPE_SECRET_KEY) {
      stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
    }
  }
  return stripeClient;
}
