import express from "express";
import crypto from "crypto";
import {
  processPaystackTransaction,
  handleSubscriptionCreate,
  handleRenewalCharge,
  handleSubscriptionDisable
} from "../service/billing.js";

const router = express.Router();

// Paystack signs the raw request body with HMAC-SHA512 using the secret
// key, so this route must be mounted in server.js with express.raw()
// BEFORE the global express.json() middleware runs — do not move it
// behind that, the signature check needs the exact raw bytes.
router.post("/webhooks/paystack", async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return res.status(503).send("Billing not configured");

  const signature = req.headers["x-paystack-signature"];
  const expected = crypto.createHmac("sha512", secret).update(req.body).digest("hex");

  if (signature !== expected) {
    console.error("❌ Paystack webhook signature verification failed");
    return res.status(400).send("Invalid signature");
  }

  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch (err) {
    return res.status(400).send("Invalid payload");
  }

  try {
    switch (event.event) {
      case "charge.success":
        // processPaystackTransaction handles charges we initiated
        // (metadata.clientId present); handleRenewalCharge picks up
        // system-initiated renewal charges (no metadata) — each no-ops
        // on the case it doesn't own, so calling both is safe.
        await processPaystackTransaction(event.data);
        await handleRenewalCharge(event.data);
        break;
      case "subscription.create":
        await handleSubscriptionCreate(event.data);
        break;
      case "subscription.disable":
      case "subscription.not_renew":
        await handleSubscriptionDisable(event.data);
        break;
      default:
        break;
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ Paystack webhook handling error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
