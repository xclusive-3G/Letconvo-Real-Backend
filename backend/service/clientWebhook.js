import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import axios from "axios";
import { UnrecoverableError } from "bullmq";
import { supabase } from "../config/supabase.js";
import { webhookQueue } from "../queue/webhookQueue.js";

// Outgoing webhooks: POSTs call and booking events to the URL a business
// saved in Settings (a Zapier "Catch Hook", a Make webhook, or their own
// server). Delivered by worker.js so a slow receiver never holds up a call
// or booking, and failed deliveries are retried.

const TIMEOUT_MS = 10_000;
// Retell's summary/sentiment arrive after call_ended, so wait before sending.
const CALL_DELAY_MS = 90_000;
// Reconciliation backfills old calls; don't flood a newly added URL with them.
const MAX_CALL_AGE_MS = 24 * 3600 * 1000;

// The URL is customer-supplied and this runs on EC2, so anything that isn't
// the public internet (including the 169.254.169.254 metadata service) is
// refused.
const blockedV4 = new net.BlockList();
for (const [base, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
]) {
  blockedV4.addSubnet(base, bits, "ipv4");
}

// IPv6: allow only global unicast, minus ranges that can embed an IPv4 address.
const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new net.BlockList();
blockedV6.addSubnet("2001::", 32, "ipv6");
blockedV6.addSubnet("2002::", 16, "ipv6");

export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
  return false;
}

// Checks the same addresses the socket then connects to, so a hostname can't
// pass validation and afterwards resolve to something internal.
function publicOnlyLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(new Error("Webhook host is not a public address"));
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

const agent = new https.Agent({ lookup: publicOnlyLookup });

/** Returns a normalized URL ("" when blank); throws a user-readable error. */
export function validateWebhookUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Webhook URL isn't a valid web address.");
  }

  if (url.protocol !== "https:") throw new Error("Webhook URL must start with https://");
  if (url.username || url.password) {
    throw new Error("Webhook URL can't contain a username or password.");
  }

  // Literal IPs skip the DNS lookup above, so they have to be checked here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) {
    throw new Error("Webhook URL must be a public address.");
  }
  return url.toString();
}

async function post(url, payload) {
  const { status } = await axios.post(validateWebhookUrl(url), payload, {
    timeout: TIMEOUT_MS,
    signal: AbortSignal.timeout(TIMEOUT_MS + 2000),
    httpsAgent: agent,
    proxy: false,
    maxRedirects: 0,
    maxContentLength: 256 * 1024,
    responseType: "text",
    headers: { "Content-Type": "application/json", "User-Agent": "Letconvo-Webhooks/1.0" },
    validateStatus: () => true
  });
  return status;
}

async function getWebhookUrl(clientId) {
  const { data, error } = await supabase
    .from("client_settings")
    .select("webhook_url")
    .eq("client_id", clientId)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.webhook_url || "";
}

function envelope(id, event, data, occurredAt) {
  return { id, event, occurred_at: occurredAt || new Date().toISOString(), data };
}

function bookingData(b) {
  return {
    booking_id: b.id,
    status: b.status,
    customer_name: b.customer_name || null,
    customer_phone: b.customer_phone || null,
    customer_email: b.customer_email || null,
    service: b.service || null,
    appointment_date: b.appointment_date || null,
    appointment_time: b.appointment_time || null,
    notes: b.notes || null
  };
}

function callData(row) {
  return {
    call_id: row.retell_call_id,
    direction: row.direction || null,
    caller_name: row.caller_name || null,
    caller_phone: row.caller_phone || null,
    duration_seconds: Math.round(Number(row.duration_ms || 0) / 1000),
    summary: row.call_summary || null,
    sentiment: row.sentiment || null,
    transcript: row.transcript || null,
    recording_url: row.recording_url || null,
    disconnection_reason: row.disconnection_reason || null
  };
}

// Never throws and is never awaited by callers: Redis being down must not
// break a call or a booking.
function enqueue(name, data, options) {
  getWebhookUrl(data.clientId)
    .then((url) => (url ? webhookQueue.add(name, data, options) : null))
    .catch((err) => console.error("⚠️ Could not queue webhook:", err.message));
}

export function queueCallWebhook({ clientId, retellCallId, endedAt }) {
  if (endedAt && Date.now() - Number(endedAt) > MAX_CALL_AGE_MS) return;
  enqueue(
    "call.completed",
    { clientId, retellCallId },
    { jobId: `call-${retellCallId}`, delay: CALL_DELAY_MS }
  );
}

/** event: "booking.created" | "booking.updated" */
export function queueBookingWebhook(event, booking) {
  if (!booking?.id || !booking.client_id) return;
  enqueue(event, {
    clientId: booking.client_id,
    occurredAt: new Date().toISOString(),
    booking: bookingData(booking)
  });
}

/** Worker entry point. Throws to make BullMQ retry. */
export async function processWebhookJob(job) {
  const { clientId, retellCallId, booking, occurredAt } = job.data;

  // Read now, not when queued, so clearing the URL stops pending deliveries.
  const url = await getWebhookUrl(clientId);
  if (!url) return { skipped: "no_webhook_url" };

  // Namespaced: BullMQ's automatic ids are plain counters ("17").
  const id = retellCallId ? job.id : `booking-event-${job.id}`;

  let payload;
  if (job.name === "call.completed") {
    const { data: rows, error } = await supabase
      .from("retell_call_logs")
      .select("*")
      .eq("client_id", clientId)
      .eq("retell_call_id", retellCallId)
      .limit(1);
    if (error) throw error;
    if (!rows?.length) return { skipped: "call_not_found" };
    payload = envelope(id, job.name, callData(rows[0]), rows[0].created_at);
  } else {
    payload = envelope(id, job.name, booking, occurredAt);
  }

  const status = await post(url, payload);
  if (status >= 200 && status < 300) return { delivered: true, status };

  // A rejected request won't succeed on retry unless it's a timeout/throttle.
  if (status < 500 && status !== 408 && status !== 429) {
    throw new UnrecoverableError(`Webhook receiver returned ${status}`);
  }
  throw new Error(`Webhook receiver returned ${status}`);
}

/** Sends a made-up event straight away for the Settings "Send test" button. */
export async function sendTestWebhook(url) {
  return post(
    url,
    envelope(`test-${Date.now()}`, "call.completed", {
      ...callData({
        retell_call_id: "test_call",
        direction: "inbound",
        caller_name: "Test Caller",
        caller_phone: "+15555550100",
        duration_ms: 95_000,
        call_summary: "This is a test event from Letconvo. No real call was made.",
        sentiment: "Positive",
        transcript: "Agent: Thanks for calling. How can I help?\nUser: This is a test.",
        disconnection_reason: "user_hangup"
      }),
      test: true
    })
  );
}
