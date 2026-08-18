import { Resend } from "resend";

// Lazily-initialized, same pattern as config/paystack.js — returns null
// instead of throwing when RESEND_API_KEY isn't set, so the server keeps
// running (and every unrelated route keeps working) before email is
// actually configured. Callers must check for null and skip sending
// rather than crashing.
let resendClient = null;
let attempted = false;

export function getResend() {
  if (!attempted) {
    attempted = true;
    if (process.env.RESEND_API_KEY) {
      resendClient = new Resend(process.env.RESEND_API_KEY);
    }
  }
  return resendClient;
}
