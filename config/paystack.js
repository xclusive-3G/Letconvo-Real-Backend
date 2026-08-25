import axios from "axios";

// Lazily-initialized: returns null instead of throwing when
// PAYSTACK_SECRET_KEY isn't set, so the server keeps running (and every
// other unrelated route keeps working) before billing is actually
// configured. Callers must check for null and respond with a clear
// "not configured" error rather than crashing.
let paystackClient = null;
let attempted = false;

export function getPaystack() {
  if (!attempted) {
    attempted = true;
    if (process.env.PAYSTACK_SECRET_KEY) {
      paystackClient = axios.create({
        baseURL: "https://api.paystack.co",
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      });
    }
  }
  return paystackClient;
}
