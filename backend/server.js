import express from "express";
import cors from "cors";
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

app.post("/api/bookings", async (req, res) => {
    const bookingData = req.body;
    console.log("Received booking data:", bookingData);
    if(!bookingData.firstName || !bookingData.lastName || !bookingData.phone || !bookingData.email || !bookingData.service || !bookingData.date || !bookingData.time || !bookingData.barber  || !bookingData.notes || !bookingData.status) {
        return res.status(400).json({ error: "Missing required fields" });
    }

  const { data, error } = await supabase
    .from("BarberShop")
    .insert([{first_name: bookingData.firstName, last_name: bookingData.lastName, phone: bookingData.phone, email: bookingData.email, service: bookingData.service, date: bookingData.date, time: bookingData.time, barber: bookingData.barber, notes: bookingData.notes, status: "pending" }])
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
    console.log("Error inserting appointment:", error);
  }
  else { 
  res.status(201).json(data);
    console.log("Appointment created:", data);  
     await addCallJob(data);
    }
});



// connect to retell and update booking status based on AI outcome

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || 'KEY019D96AA130965E681EE3D54B4204475_BOTw56WQSNjMIZnKxW1EVJ';
const TELNYX_APP_ID  = process.env.TELNYX_APP_ID;
const RETELL_API_KEY = process.env.RETELL_API_KEY || 'key_ae76e0e16a642a77738d4dd28f81';
const AGENT_ID       = process.env.RETELL_AGENT_ID || "agent_bb88bde584ea5625998cb4a8e9";
const FROM_NUMBER    = process.env.FROM_NUMBER || "+12014621533";

// Retell SIP URI — agent_id@sip.retellai.com
const RETELL_SIP_URI = `sip:${AGENT_ID}@sip.retellai.com`;

// ─────────────────────────────────────────────
// 1. TELNYX WEBHOOK — handles call events
// ─────────────────────────────────────────────
app.post("/webhooks/telnyx", async (req, res) => {
  // const eventType    = req.body?.data?.event_type;
  // const payload      = req.body?.data?.payload || {};
  // const callControlId = payload.call_control_id;

  // console.log("=================================");
  // console.log("📡 Telnyx Event:", eventType);
  // console.log("🆔 Call Control ID:", callControlId);
  // console.log("=================================");

  // res.sendStatus(200); // Always respond immediately

  // try {
  //   if (eventType === "call.answered") {
  //     console.log("✅ Call answered — connecting to Retell AI...");

  //     // Small delay to prevent drop
  //     await new Promise(resolve => setTimeout(resolve, 1000));

  //     // Transfer call to Retell via SIP
  //     await transferToRetell(callControlId);
  //   }

  //   if (eventType === "call.hangup") {
  //     console.log("📴 Call ended:", payload.hangup_cause);
  //   }

  // } catch (err) {
  //   console.error("❌ Webhook error:", err.message);
  // }

  const event = req.body;
  const eventType = event?.data?.event_type;
  const payload = event?.data?.payload;

  console.log("Telnyx event received:", eventType);

  switch (eventType) {
    case "call.initiated":
      console.log("Call initiated:", payload.call_control_id);
      break;

    case "call.answered":
      console.log("Call answered:", payload.call_control_id);
      // Example: respond with a speak command
      respondToCall(payload.call_control_id);
      break;

    case "call.hangup":
      console.log("Call hung up:", payload.call_control_id);
      break;

    case "call.speak.ended":
      console.log("Speak ended, hanging up...");
      hangUp(payload.call_control_id);
      break;

    default:
      console.log("Unhandled event type:", eventType);
  }

  // Always respond with 200 to acknowledge receipt
  res.sendStatus(200);
});

// ─────────────────────────────────────────────
// 2. RETELL WEBHOOK — handles AI outcomes
// ─────────────────────────────────────────────
app.post("/webhooks/retell", async (req, res) => {
  try {
    console.log("🤖 Retell webhook payload:", req.body);

    const { phone, intent, new_time } = req.body;

    if (!phone || !intent) {
      return res.status(400).json({ error: "phone and intent are required" });
    }

    if (intent === "confirmed") {
      const { error } = await supabase
        .from("BarberShop")
        .update({ status: "confirmed" })
        .eq("phone", phone);

      if (error) {
        console.error("Supabase confirm error:", error);
        return res.status(400).json({ error: error.message });
      }

      console.log("✅ Booking confirmed for:", phone);
    }

    if (intent === "reschedule") {
      const { error } = await supabase
        .from("BarberShop")
        .update({
          status: "reschedule_requested",
          new_time: new_time || null,
        })
        .eq("phone", phone);

      if (error) {
        console.error("Supabase reschedule error:", error);
        return res.status(400).json({ error: error.message });
      }

      console.log("🔄 Reschedule requested for:", phone);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Retell webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

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


// app.post("/retell/get-booking", async (req, res) => {
//   const { phone } = req.body;

//   const { data, error } = await supabase
//     .from("BarberShop")
//     .select("*")
//     .eq("phone", phone)
//     .eq("status", "confirmed")
//     .single();

//   if (error || !data) {
//     return res.json({ error: "No booking found" });
//   }

//   return res.json({
//     found: true,
//     customer_name: data.name,
//     appointment_time: data.appointment_time,
//     service: data.service || "haircut",
//     booking_id: data.id
//   });
// });

// mcp code here
// ─────────────────────────────────────────────
// RETELL CUSTOM FUNCTIONS
// ─────────────────────────────────────────────

// Get booking details by phone
app.post("/retell/get-booking", async (req, res) => {
  const { phone } = req.body;
  const cleanPhone = String(phone).replace("+", "");

  try {
    const { data, error } = await supabase
      .from("BarberShop")
      .select("*")
      .eq("phone", cleanPhone)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return res.json({ found: false });
    }

    // Build appointment datetime from date + time columns
    const apptDate = data.date && data.time
      ? new Date(`${data.date}T${data.time}`)
      : null;

    const formattedDate = apptDate
      ? apptDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        })
      : "date not set";

    const formattedTime = apptDate
      ? apptDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit"
        })
      : "time not set";

    return res.json({
      found: true,
      customer_name:    data.first_name || data.full_name || "there",
      last_name:        data.last_name || "",
      appointment_date: formattedDate,
      appointment_time: formattedTime,
      raw_date:         data.date,
      raw_time:         data.time,
      service:          data.service || data.service_type || "haircut",
      barber:           data.barber || data.barber_name || "your barber",
      booking_id:       data.id,
      status:           data.status,
      phone:            data.phone,
      notes:            data.notes || "",
      address:          data.address || "",
    });

  } catch (err) {
    console.error("❌ get-booking error:", err);
    return res.status(500).json({ found: false });
  }
});


// ─────────────────────────────────────────────
// Update booking status after call
app.post("/retell/update-booking", async (req, res) => {
  const { phone, status, new_time } = req.body;

  // Strip + sign
  const cleanPhone = String(phone).replace("+", "");

  try {
    const updates = { status };
    if (new_time) updates.new_time = new_time;

    const { error } = await supabase
      .from("BarberShop")
      .update(updates)
      .eq("phone", cleanPhone);

    if (error) return res.json({ success: false, error: error.message });
    return res.json({ success: true });

  } catch (err) {
    console.error("❌ update-booking error:", err);
    return res.status(500).json({ success: false });
  }
});

// ─────────────────────────────────────────────
// Check available slots for rescheduling
app.post("/retell/get-slots", async (req, res) => {
  console.log("📅 Fetching available slots...");

  try {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Get already booked slots
    const { data: booked } = await supabase
      .from("BarberShop")
      .select("appointment_time")
      .gte("appointment_time", now.toISOString())
      .lte("appointment_time", nextWeek.toISOString())
      .in("status", ["confirmed", "calling"]);

    // Build available slots (9am - 6pm, Mon-Sat)
    const bookedTimes = (booked || []).map(b => b.appointment_time);
    const slots = [];
    const cursor = new Date(now);
    cursor.setHours(cursor.getHours() + 1, 0, 0, 0);

    while (cursor <= nextWeek && slots.length < 6) {
      const day = cursor.getDay();
      const hour = cursor.getHours();

      if (day !== 0 && hour >= 9 && hour < 18) {
        const iso = cursor.toISOString();
        if (!bookedTimes.includes(iso)) {
          slots.push({
            date: cursor.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric"
            }),
            time: cursor.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit"
            }),
            iso
          });
        }
      }
      cursor.setHours(cursor.getHours() + 1);
    }

    return res.json({ slots });

  } catch (err) {
    console.error("❌ get-slots error:", err);
    return res.status(500).json({ slots: [] });
  }
});


app.listen(5000, () => console.log("Server running on 5000"));