import express from "express";
import cors from "cors";
import getSlotsRouter from "./router/retellGetSlot.js";
import webhookTelnyxRouter from "./router/webhookTelnyx.js";
import webhookRetellRouter from "./router/webhookRetell.js";
import retellBookingRouter from "./router/retellBooking.js";
import retellUpdateBookingRouter from "./router/retellUpdateBooking.js";



import bookingRouter from "./router/booking.js";
import { supabase } from "../config/supabase.js";
import { addCallJob } from "./queue.js";
// import { createClient } from "redis";
// import  dotenv  from "dotenv";
// dotenv.config();


const app = express();
app.use(cors());
cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: true
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use("/",bookingRouter);
app.use("/",webhookTelnyxRouter);
app.use("/",webhookRetellRouter);
app.use("/",retellBookingRouter);
app.use("/",retellUpdateBookingRouter);
app.use("/",getSlotsRouter);





// connect to retell and update booking status based on AI outcome

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || 'KEY019D96AA130965E681EE3D54B4204475_BOTw56WQSNjMIZnKxW1EVJ';
const TELNYX_APP_ID  = process.env.TELNYX_APP_ID;
const RETELL_API_KEY = process.env.RETELL_API_KEY || 'key_ae76e0e16a642a77738d4dd28f81';
const AGENT_ID       = process.env.RETELL_AGENT_ID || "agent_bb88bde584ea5625998cb4a8e9";
const FROM_NUMBER    = process.env.FROM_NUMBER || "+12014621533";

// Retell SIP URI — agent_id@sip.retellai.com
const RETELL_SIP_URI = `sip:${AGENT_ID}@sip.retellai.com`;


// ─────────────────────────────────────────────
// 3. TRANSFER CALL TO RETELL VIA SIP
// ─────────────────────────────────────────────
async function transferToRetell(callControlId) {
  console.log("🔁 Transferring to Retell SIP:", RETELL_SIP_URI);
  console.log("🔁 Attempting transfer to Retell...");
  console.log("📞 Call Control ID:", callControlId);
  // console.log("🔗 SIP URI:", RETELL_SIP_URI);
  console.log("🔑 Telnyx Key:", TELNYX_API_KEY ? "✅ loaded" : "❌ MISSING");
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || 'KEY019D96AA130965E681EE3D54B4204475_BOTw56WQSNjMIZnKxW1EVJ';

  await fetch(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify({
        payload: "Hello! You have reached Aura Telnyx. How can I help you?",
        voice: "female",
        language: "en-US",
      }),
    }
  );
}

// hang up call after speak ends (for demo purposes)
async function hangUp(callControlId) {
  const TELNYX_API_KEY = process.env.TELNYX_API_KEY;

  await fetch(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TELNYX_API_KEY}`,
      },
    }
  );
}


app.listen(5000, () => console.log("Server running on 5000"));