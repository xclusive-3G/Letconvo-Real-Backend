// import dotenv from "dotenv";
// import { Worker } from "bullmq";
// import Redis from "ioredis";
// import axios from "axios";
// import { supabase } from "../config/supabase.js";

// // dotenv.config({ path: "../.env" });

// // Redis connection
// const connection = new Redis({
//   host: process.env.REDIS_HOST ||'redis-18739.crce262.us-east-1-1.ec2.cloud.redislabs.com',
//   port: Number(process.env.REDIS_PORT || 18739),
//   password: process.env.REDIS_PASSWORD || 'B5Lwmliy1PHVCZvIHfXBMd1KTMPo5zVd',
//   maxRetriesPerRequest: null,
// });

// function formatToE164(phone) {
//   if (!phone) return "";
//   const cleaned = String(phone).replace(/[^\d+]/g, "");
//   if (cleaned.startsWith("+")) return cleaned;
//   return `+${cleaned}`;
// }

// // function to start outbound call with Telnyx
// async function callUser(phone, bookingId) {
//   const toPhone = formatToE164(phone);


//   try {
//   const response = await axios.post(
//     "https://api.telnyx.com/v2/calls",
//     {
//       connection_id: process.env.TELNYX_CONNECTION_ID || '2937974294367437881',
//       to: toPhone,
//       from: process.env.TELNYX_FROM || '+12014621533',
//       webhook_url: process.env.TELNYX_WEBHOOK_URL || "https://acroterial-diacidic-connie.ngrok-free.dev/retell-webhook",
//       client_state: Buffer.from(
//         JSON.stringify({ bookingId, phone })
//       ).toString("base64"),
//     },
//     {
//       headers: {
//         Authorization: `Bearer ${process.env.TELNYX_API_KEY || 'KEY019D8CF9BCE27F557BBBB5EFA5FF8771_I5MVDI8XZKnEa1t1pVCsCZ'}`,
//         "Content-Type": "application/json",
//       },
//     }
//   );

//   return response.data;
// }
// catch (error) {
//     console.error("Telnyx status:", error.response?.status);
//     console.error("Telnyx error data:", error.response?.data);
//     throw error;
//   }
// }


// console.log("🚀 Worker started...");

// const worker = new Worker(
//   "call-queue",
//   async (job) => {
//     const { id, phone } = job.data;

//     console.log("📞 Processing booking:", id, phone);

//     // mark as calling before starting call
//     const { error: updateError } = await supabase
//       .from("BarberShop")
//       .update({ status: "called" })
//       .eq("id", id);

//     if (updateError) {
//       throw new Error(`Supabase update error: ${updateError.message}`);
//     }

//     // start Telnyx call
//     const telnyxRes = await callUser(phone, id);

//     console.log("✅ Call initiated:", telnyxRes);

//     // optional: store telnyx call id
//     const callControlId =
//       telnyxRes?.data?.call_control_id || telnyxRes?.data?.call_leg_id || null;

//     if (callControlId) {
//       const { error: callIdError } = await supabase
//         .from("BarberShop")
//         .update({
//           telnyx_call_id: callControlId,
//         })
//         .eq("id", id);

//       if (callIdError) {
//         console.log("⚠ Could not save Telnyx call id:", callIdError.message);
//       }
//     }

//     return telnyxRes;
//   },
//   {
//     connection,
//     limiter: {
//       max: 5,
//       duration: 1000,
//     },
//   }
// );

// worker.on("completed", (job) => {
//   console.log(`✅ Job completed: ${job.id}`);
// });

// worker.on("failed", async (job, err) => {
//   console.log(`❌ Job failed: ${job?.id}`, err.message);

//   if (job?.data?.id) {
//     await supabase
//       .from("BarberShop")
//       .update({ status: "call_failed" })
//       .eq("id", job.data.id);
//   }
// });

// worker.on("error", (err) => {
//   console.error("❌ Worker error:", err.message);
// });

// import dotenv from "dotenv";



// import { Worker } from "bullmq";
// import Redis from "ioredis";
// import axios from "axios";
// import { supabase } from "../config/supabase.js";

// const connection = new Redis({
//   host: process.env.REDIS_HOST || 'redis-18739.crce262.us-east-1-1.ec2.cloud.redislabs.com',
//   port: Number(process.env.REDIS_PORT || 18739),
//   password: process.env.REDIS_PASSWORD || 'B5Lwmliy1PHVCZvIHfXBMd1KTMPo5zVd',
//   maxRetriesPerRequest: null,
// });

// function formatToE164(phone) {
//   if (!phone) return "";
//   const cleaned = String(phone).replace(/[^\d+]/g, "");
//   return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
// }

// // ─────────────────────────────────────────────
// // Let Telnyx dial out, then webhook handles Retell
// // ─────────────────────────────────────────────
// async function makeOutboundCall(toNumber, bookingId) {
//   const response = await axios.post(
//     "https://api.telnyx.com/v2/calls",
//     {
//       connection_id: process.env.TELNYX_CONNECTION_ID || '2937974294367437881',
//       to: toNumber,
//       from: process.env.TELNYX_FROM || "+12014621533",
//       webhook_url: process.env.TELNYX_WEBHOOK_URL || "https://acroterial-diacidic-connie.ngrok-free.dev/webhooks/telnyx",
//       client_state: Buffer.from(
//         JSON.stringify({ bookingId, phone: toNumber })
//       ).toString("base64"),
//     },
//     {
//       headers: {
//         Authorization: `Bearer ${process.env.TELNYX_API_KEY || 'KEY019D8CF9BCE27F557BBBB5EFA5FF8771'}`,
//         "Content-Type": "application/json",
//       },
//     }
//   );

//   return response.data;
// }

// console.log("🚀 Worker started...");

// const worker = new Worker(
//   "call-queue",
//   async (job) => {
//     const { id, phone } = job.data;
//     const toNumber = formatToE164(phone);

//     console.log("📞 Processing booking:", id, toNumber);

//     // 1) Mark as calling
//     const { error: updateError } = await supabase
//       .from("BarberShop")
//       .update({ status: "calling" })
//       .eq("id", id);

//     if (updateError) {
//       throw new Error(`Supabase update error: ${updateError.message}`);
//     }

//     // 2) Telnyx dials the customer
//     // When customer answers → /webhooks/telnyx fires → transfers to Retell SIP
//     const telnyxRes = await makeOutboundCall(toNumber, id);
//     console.log("✅ Telnyx call initiated:", telnyxRes);

//     const callControlId = telnyxRes?.data?.call_control_id || null;

//     // 3) Save call control id
//     const { error: saveError } = await supabase
//       .from("BarberShop")
//       .update({
//         telnyx_call_id: callControlId,
//         status: "call_started",
//       })
//       .eq("id", id);

//     if (saveError) {
//       console.log("⚠ Could not save call id:", saveError.message);
//     }

//     return { callControlId };
//   },
//   {
//     connection,
//     limiter: { max: 5, duration: 1000 },
//   }
// );

// worker.on("completed", (job) => {
//   console.log(`✅ Job completed: ${job.id}`);
// });

// worker.on("failed", async (job, err) => {
//   console.log(`❌ Job failed: ${job?.id}`, err.message);
//   if (job?.data?.id) {
//     await supabase
//       .from("BarberShop")
//       .update({ status: "call_failed" })
//       .eq("id", job.data.id);
//   }
// });

// worker.on("error", (err) => {
//   console.error("❌ Worker error:", err.message);
// });





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

    const callControlId = telnyxRes?.data?.call_control_id || null;

    // 3) Save call control ID to Supabase
    const { error: saveError } = await supabase
      .from("BarberShop")
      .update({
        telnyx_call_id: callControlId,
        status: "call_started",
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