import express from "express";
import { supabase } from "../../config/supabase.js";
import { addCallJob } from "../queue.js";
const router = express.Router();

router.post("/api/bookings", async (req, res) => {
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

export default router;