import express from "express";
import cors from "cors";
import getSlotsRouter from "./router/retellGetSlot.js";
import webhookTelnyxRouter from "./router/webhookTelnyx.js";
import webhookRetellRouter from "./router/webhookRetell.js";
import retellBookingRouter from "./router/retellBooking.js";
import retellUpdateBookingRouter from "./router/retellUpdateBooking.js";
import telnyxVoiceWebhook from "./router/telnyxVoiceWebhook2.js";
import telnyxMessagingWebhook from "./router/telnyxMessagingWebhook2.js";
import healthRouter from "./router/health.js";
import onboardingRoutes from "./router/onboarding.js"
import retellWebhookRoutes from "./router/retellWebhook.js";
import retellBookAppointmentRouter from "./router/retellBookAppointment.js";
import callsRoutes from "./router/calls.js";
import registerBusinessRouter from "./router/register_business.js";
import dashboardRoute from "./router/dashboardRoute.js";
import meRoutes from "./middleware/me.js";
import bookingRouter from "./router/booking.js";
import googleAuthBooking from "./router/googleAuth.js";


import callHistory from "./router/callHistory.js";
import { supabase } from "./config/supabase.js";
import { addCallJob } from "./queue/queue.js";



const app = express();
app.use(cors());
cors({
    origin: "letconvo.live",
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

// ==================================
app.use("/webhooks", telnyxVoiceWebhook);
app.use("/webhooks", telnyxMessagingWebhook);
app.use('/', healthRouter);
app.use("/api", onboardingRoutes);
app.use("/api", retellWebhookRoutes);
app.use("/api", retellBookAppointmentRouter);
app.use("/api", callsRoutes);
app.use("/api",registerBusinessRouter);
app.use("/api", dashboardRoute);
app.use("/api", meRoutes);
app.use("/api", googleAuthBooking);
// app.use("/api", callsRoutes);
// app.use("/api", callHistory);


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