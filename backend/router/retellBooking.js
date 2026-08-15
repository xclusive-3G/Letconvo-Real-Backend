import express from "express";
import {
  findLatestBooking,
  formatDateHuman,
  formatTimeHuman
} from "../utils/bookings.js";

const router = express.Router();

// Called by the Retell agent to look up an existing booking by phone number.
router.post("/retell/get-booking", async (req, res) => {
  const { clientId, phone } = req.body;

  if (!clientId || !phone) {
    return res.status(400).json({ found: false, error: "clientId and phone are required" });
  }

  try {
    const data = await findLatestBooking(clientId, phone);

    if (!data) {
      return res.json({ found: false });
    }

    return res.json({
      found: true,
      customer_name: data.customer_name || "there",
      appointment_date: formatDateHuman(data.appointment_date),
      appointment_time: formatTimeHuman(data.appointment_time),
      raw_date: data.appointment_date,
      raw_time: data.appointment_time,
      service: data.service || "your appointment",
      booking_id: data.id,
      status: data.status,
      phone: data.customer_phone,
      notes: data.notes || ""
    });

  } catch (err) {
    console.error("❌ get-booking error:", err);
    return res.status(500).json({ found: false, error: err.message });
  }
});

export default router;
