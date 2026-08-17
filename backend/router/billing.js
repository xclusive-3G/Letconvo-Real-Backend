import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { createCheckoutSession } from "../service/billing.js";

const router = express.Router();

const CHECKOUT_ERROR_STATUS = {
  BILLING_NOT_CONFIGURED: 503,
  INVALID_PLAN: 400,
  PLAN_NOT_CHECKOUT_READY: 400,
  INVALID_AMOUNT: 400,
  INVALID_MODE: 400
};

// Same duplicate-row-safe lookup used across middleware/me.js — a business
// signed up before its owner's auth user existed cleanly shouldn't 500 here.
const getClientByUserId = async (userId) => {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0];
};

router.post("/billing/checkout", requireAuth, async (req, res) => {
  try {
    const { mode, planSlug, amount } = req.body;

    const client = await getClientByUserId(req.user.id);
    if (!client) {
      return res.status(404).json({ error: "No business account found for this user" });
    }

    const url = await createCheckoutSession({ client, mode, planSlug, amount });
    return res.json({ url });
  } catch (err) {
    const status = CHECKOUT_ERROR_STATUS[err.code] || 500;
    if (status === 500) console.error("❌ Checkout session error:", err);
    return res.status(status).json({ error: err.message });
  }
});

export default router;
