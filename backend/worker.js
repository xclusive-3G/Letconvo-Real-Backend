import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import Redis from "ioredis";
import axios from "axios";
import { supabase } from "../config/supabase.js";

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const TELNYX_API_KEY     = process.env.TELNYX_API_KEY || 'KEY019D96AA130965E681EE3D54B4204475_BOTw56WQSNjMIZnKxW1EVJ';
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID || '2937974294367437881';
const TELNYX_FROM        = process.env.TELNYX_FROM || "+12014621533";
const TELNYX_WEBHOOK_URL = process.env.TELNYX_WEBHOOK_URL || "https://acroterial-diacidic-connie.ngrok-free.dev/webhooks/telnyx";

// ─────────────────────────────────────────────
// REDIS CONNECTION
// ─────────────────────────────────────────────
const connection = new Redis({
  host:     process.env.REDIS_HOST || "redis-18739.crce262.us-east-1-1.ec2.cloud.redislabs.com",
  port:     Number(process.env.REDIS_PORT || 18739),
  password: process.env.REDIS_PASSWORD || "B5Lwmliy1PHVCZvIHfXBMd1KTMPo5zVd",
  maxRetriesPerRequest: null,
});

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function formatToE164(phone) {
  if (!phone) return "";
  const cleaned = String(phone).replace(/[^\d+]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

async function makeOutboundCall(toNumber, bookingId) {
  console.log("📡 Making call to:", toNumber);

  const response = await axios.post(
    "https://api.retellai.com/v2/create-phone-call",
    {
      from_number: process.env.RETELL_FROM_NUMBER || "+12014621533",
      to_number: toNumber,
      agent_id: process.env.RETELL_AGENT_ID || "agent_bb88bde584ea5625998cb4a8e9",
      metadata: { booking_id: String(bookingId) }
    
    },
    {
      headers: {
        method: "POST",
        Authorization: `Bearer ${process.env.RETELL_API_KEY || 'key_ae76e0e16a642a77738d4dd28f81'}`,
        "Content-Type": "application/json",
        
      },
    }
  );

  return response.data;
// }
//   } catch (err) {
//     // ← ADD THIS to see exact Telnyx error
//     console.error("❌ Telnyx error details:", JSON.stringify(err.response?.data, null, 2));
//     throw err;
//   }
}


// ─────────────────────────────────────────────
// STARTUP CHECKS
// ─────────────────────────────────────────────
console.log("🚀 Worker started...");
console.log("🔑 TELNYX_API_KEY:      ", TELNYX_API_KEY      ? "✅ loaded" : "❌ MISSING");
console.log("🔑 TELNYX_CONNECTION_ID:", TELNYX_CONNECTION_ID ? "✅ loaded" : "❌ MISSING");
console.log("🔑 TELNYX_FROM:         ", TELNYX_FROM);
console.log("🔑 TELNYX_WEBHOOK_URL:  ", TELNYX_WEBHOOK_URL);
console.log("🔑 REDIS_HOST:          ", process.env.REDIS_HOST ? "✅ loaded" : "❌ MISSING");

// ─────────────────────────────────────────────
// WORKER
// ─────────────────────────────────────────────
const worker = new Worker(
  "call-queue",
  async (job) => {
    const { id, phone } = job.data;
    const toNumber = formatToE164(phone);

    console.log("📞 Processing booking:", id, toNumber);

    // 1) Mark as calling in Supabase
    const { error: updateError } = await supabase
      .from("BarberShop")
      .update({ status: "calling" })
      .eq("id", id);

    if (updateError) {
      throw new Error(`Supabase update error: ${updateError.message}`);
    }

    // 2) Telnyx dials the customer
    const telnyxRes = await makeOutboundCall(toNumber, id);
    console.log("✅ Telnyx call initiated:", JSON.stringify(telnyxRes, null, 2));

    const telnyxJson = JSON.stringify(telnyxRes) || null;

    const callControlId = telnyxRes.call_id || null;
    console.log("📞 Call Control ID:", telnyxRes.call_id);

    // 3) Save call control ID to Supabase
    const { error: saveError } = await supabase
      .from("BarberShop")
      .update({
        telnyx_call_id: callControlId,
        status: "call_started",
        follow_up_sent: "true",
      })
      .eq("id", id);

    if (saveError) {
      console.log("⚠ Could not save call id:", saveError.message);
    }

    return { callControlId };
  },
  {
    connection,
    limiter: { max: 5, duration: 1000 },
  }
);

// ─────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────
worker.on("completed", (job) => {
  console.log(`✅ Job completed: ${job.id}`);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Job failed: ${job?.id}`, err.message);

  if (job?.data?.id) {
    await supabase
      .from("BarberShop")
      .update({ status: "call_failed" })
      .eq("id", job.data.id);
  }
});

worker.on("error", (err) => {
  console.error("❌ Worker error:", err.message);
});