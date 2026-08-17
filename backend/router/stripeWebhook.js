import express from "express";
import { getStripe } from "../config/stripe.js";
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaid,
  handleSubscriptionDeleted
} from "../service/billing.js";

const router = express.Router();

// Stripe signature verification requires the exact raw request bytes, so
// this route must be mounted in server.js with express.raw() BEFORE the
// global express.json() middleware runs — do not move this behind it.
router.post("/webhooks/stripe", async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).send("Billing not configured");

  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Stripe webhook handling error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
