import { supabase } from "../config/supabase.js";
import { getPaystack } from "../config/paystack.js";
import { createBillingTransaction } from "./billingTransaction.js";
import { createNotification } from "../utils/createNotification.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://letconvo.live";

// mode: "subscription" (pay for the plan picked at signup / upgrade) or
// "topup" (one-time balance top-up). Returns the hosted Paystack checkout
// URL to redirect the browser to — we never touch raw card data ourselves.
export async function createCheckoutSession({ client, mode, planSlug, amount }) {
  const paystack = getPaystack();

  if (!paystack) {
    const err = new Error("Billing is not configured yet. Please contact support.");
    err.code = "BILLING_NOT_CONFIGURED";
    throw err;
  }

  // Paystack has a single callback_url (no separate success/cancel URLs
  // like Stripe) and appends its own reference/trxref query params onto
  // it, so our own "checkout=verify" marker survives the round trip. The
  // frontend reads that and calls GET /billing/verify with the reference
  // instead of trusting a pre-set success/cancel flag — Paystack doesn't
  // tell us the outcome until we ask.
  const callbackUrl = `${FRONTEND_URL}/?checkout=verify#dashboard`;
  const email = client.email || client.ownerEmail;

  if (mode === "subscription") {
    const { data: plan, error } = await supabase
      .from("plans")
      .select("*")
      .eq("slug", planSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;

    if (!plan) {
      const err = new Error("Invalid plan selected");
      err.code = "INVALID_PLAN";
      throw err;
    }

    if (!plan.paystack_plan_code) {
      const err = new Error(`The ${plan.name} plan isn't available for checkout yet.`);
      err.code = "PLAN_NOT_CHECKOUT_READY";
      throw err;
    }

    const reference = `sub_${client.id}_${Date.now()}`;

    // USD, matching price_usd — this account is waiting on Paystack to
    // enable USD (targeting US customers), so paystack_plan_code should
    // be set to a USD-denominated Plan once that's approved. The NGN
    // workaround (charging in Naira, letting the card network convert)
    // was tried and deliberately reverted: it doesn't guarantee the
    // advertised USD price and shows an unfamiliar currency at checkout.
    const { data } = await paystack.post("/transaction/initialize", {
      email,
      amount: Math.round(Number(plan.price_usd) * 100),
      currency: "USD",
      plan: plan.paystack_plan_code,
      reference,
      callback_url: callbackUrl,
      metadata: { clientId: client.id, planSlug: plan.slug }
    });

    return data.data.authorization_url;
  }

  if (mode === "topup") {
    const amt = Number(amount);

    if (!(amt > 0)) {
      const err = new Error("A positive top-up amount is required");
      err.code = "INVALID_AMOUNT";
      throw err;
    }

    const reference = `topup_${client.id}_${Date.now()}`;

    const { data } = await paystack.post("/transaction/initialize", {
      email,
      amount: Math.round(amt * 100),
      currency: "USD",
      reference,
      callback_url: callbackUrl,
      metadata: { clientId: client.id, type: "topup", amount: String(amt) }
    });

    return data.data.authorization_url;
  }

  const err = new Error(`Unsupported checkout mode: ${mode}`);
  err.code = "INVALID_MODE";
  throw err;
}

// Shared, idempotent processor for a successful Paystack charge that we
// initiated (subscribe or top-up click) — called both from the
// charge.success webhook and from the /billing/verify fallback the
// frontend hits on redirect back, since webhook delivery isn't guaranteed
// to beat the browser back to the dashboard. Dedup key is the Paystack
// transaction reference, stored as billing_transactions.reference. A
// renewal charge (no clientId in metadata, since Paystack triggers those
// itself) is left for handleRenewalCharge below.
export async function processPaystackTransaction(data) {
  const reference = data?.reference;
  if (!reference || data.status !== "success") return { handled: false };

  const clientId = data.metadata?.clientId;
  if (!clientId) return { handled: false };

  const { data: existing, error: existingError } = await supabase
    .from("billing_transactions")
    .select("id")
    .eq("reference", reference)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return { handled: true, alreadyProcessed: true };

  const customerCode = data.customer?.customer_code;

  const authorizationCode = data.authorization?.reusable
    ? data.authorization.authorization_code
    : null;

  if (data.metadata?.type === "topup") {
    const amount = Number(data.metadata.amount || data.amount / 100);
    const isAuto = data.metadata?.auto === true || data.metadata?.auto === "true";

    const { data: clientRow, error: fetchError } = await supabase
      .from("clients")
      .select("credits_remaining")
      .eq("id", clientId)
      .single();

    if (fetchError) throw fetchError;

    const newBalance = Number(clientRow.credits_remaining || 0) + amount;

    const { error: updateError } = await supabase
      .from("clients")
      .update({
        credits_remaining: newBalance,
        status: "active",
        ...(customerCode ? { paystack_customer_code: customerCode } : {}),
        ...(authorizationCode ? { paystack_authorization_code: authorizationCode } : {})
      })
      .eq("id", clientId);

    if (updateError) throw updateError;

    await createBillingTransaction({
      clientId,
      type: "topup",
      description: isAuto ? "Auto top-up" : "Balance top-up",
      amount,
      balanceAfter: newBalance,
      reference
    });

    await createNotification({
      clientId,
      title: isAuto ? "Auto top-up successful" : "Top-up successful",
      message: `$${amount.toFixed(2)} ${isAuto ? "was automatically added to" : "added to"} your balance.`,
      type: "alert",
      email: true
    });

    return { handled: true };
  }

  // Subscription first-charge. The subscription_code itself isn't reliably
  // present on this event, so it's filled in separately by
  // handleSubscriptionCreate once Paystack's subscription.create webhook
  // lands (matched via paystack_customer_code set here).
  const planSlug = data.metadata?.planSlug;

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("*")
    .eq("slug", planSlug)
    .maybeSingle();

  if (planError) throw planError;

  const newBalance = Number(plan?.monthly_credits || 0);

  const { error } = await supabase
    .from("clients")
    .update({
      subscription_status: "active",
      status: "active",
      paystack_customer_code: customerCode || null,
      ...(authorizationCode ? { paystack_authorization_code: authorizationCode } : {}),
      plan_id: plan?.id,
      plan_slug: plan?.slug,
      credits_remaining: newBalance
    })
    .eq("id", clientId);

  if (error) throw error;

  await createBillingTransaction({
    clientId,
    type: "payment",
    description: `Subscribed to ${plan?.name || planSlug} plan`,
    amount: Number(plan?.price_usd || 0),
    balanceAfter: newBalance,
    minutes: newBalance,
    reference
  });

  await createNotification({
    clientId,
    title: "Subscription active",
    message: `You're now subscribed to the ${plan?.name || planSlug} plan.`,
    type: "alert",
    email: true
  });

  return { handled: true };
}

// Fills in paystack_subscription_code once Paystack creates the
// subscription behind a plan-based charge (fired shortly after the first
// successful charge.success for that transaction).
export async function handleSubscriptionCreate(data) {
  const subscriptionCode = data?.subscription_code;
  const customerCode = data?.customer?.customer_code;
  if (!subscriptionCode || !customerCode) return;

  const { error } = await supabase
    .from("clients")
    .update({ paystack_subscription_code: subscriptionCode })
    .eq("paystack_customer_code", customerCode);

  if (error) throw error;
}

// Recurring renewal charges: Paystack auto-charges the customer's saved
// authorization on each billing cycle. These are system-initiated, not
// triggered through our /transaction/initialize call, so they carry no
// metadata — resolve the client via paystack_customer_code instead.
export async function handleRenewalCharge(data) {
  if (!data || data.status !== "success" || data.metadata?.clientId) return;

  const customerCode = data.customer?.customer_code;
  if (!customerCode) return;

  const reference = data.reference;
  if (!reference) return;

  const { data: existing, error: existingError } = await supabase
    .from("billing_transactions")
    .select("id")
    .eq("reference", reference)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return;

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, plan_id")
    .eq("paystack_customer_code", customerCode)
    .maybeSingle();

  if (error) throw error;
  if (!client) return;

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("*")
    .eq("id", client.plan_id)
    .maybeSingle();

  if (planError) throw planError;

  const newBalance = Number(plan?.monthly_credits || 0);

  await supabase
    .from("clients")
    .update({ credits_remaining: newBalance, status: "active", subscription_status: "active" })
    .eq("id", client.id);

  await createBillingTransaction({
    clientId: client.id,
    type: "payment",
    description: `${plan?.name || "Subscription"} renewal`,
    amount: Number(plan?.price_usd || 0),
    balanceAfter: newBalance,
    minutes: newBalance,
    reference
  });

  await createNotification({
    clientId: client.id,
    title: "Subscription renewed",
    message: `Your ${plan?.name || "plan"} renewed — credits refreshed.`,
    type: "alert",
    email: true
  });
}

// Charges a client's saved card off-session via Paystack's charge_authorization
// endpoint, using the reusable authorization_code captured from their last
// successful checkout (see processPaystackTransaction above). Called from
// pauseClientIfLowCredits whenever a client has auto top-up enabled and their
// balance drops to/below their configured threshold. Returns true if the
// charge succeeded and credits were added, false otherwise (no card on file,
// billing not configured, or the charge itself failed) — callers fall back
// to normal low-credit handling in that case.
export async function runAutoTopUp(client) {
  if (!client.auto_topup || !client.paystack_authorization_code) return false;

  const amount = Number(client.auto_topup_amount || 0);
  if (!(amount > 0)) return false;

  const paystack = getPaystack();
  if (!paystack) return false;

  const reference = `autotopup_${client.id}_${Date.now()}`;
  const email = client.email || client.ownerEmail;

  let chargeData;
  try {
    const response = await paystack.post("/transaction/charge_authorization", {
      authorization_code: client.paystack_authorization_code,
      email,
      amount: Math.round(amount * 100),
      currency: "USD",
      reference,
      metadata: { clientId: client.id, type: "topup", amount: String(amount), auto: true }
    });
    chargeData = response.data.data;
  } catch (err) {
    console.error("❌ Auto top-up charge failed:", err?.response?.data || err.message);
    return false;
  }

  if (chargeData?.status !== "success") {
    console.error("❌ Auto top-up not successful:", chargeData?.status);
    return false;
  }

  const result = await processPaystackTransaction(chargeData);
  return !!result.handled;
}

export async function handleSubscriptionDisable(data) {
  const subscriptionCode = data?.subscription_code;
  if (!subscriptionCode) return;

  const { error } = await supabase
    .from("clients")
    .update({ subscription_status: "canceled" })
    .eq("paystack_subscription_code", subscriptionCode);

  if (error) throw error;
}
