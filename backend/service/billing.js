import { supabase } from "../config/supabase.js";
import { getStripe } from "../config/stripe.js";
import { createBillingTransaction } from "./billingTransaction.js";
import { createNotification } from "../utils/createNotification.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://letconvo.live";

async function getOrCreateStripeCustomer(client) {
  const stripe = getStripe();

  if (client.stripe_customer_id) return client.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: client.email || client.ownerEmail || undefined,
    name: client.business_name || undefined,
    metadata: { clientId: client.id }
  });

  await supabase
    .from("clients")
    .update({ stripe_customer_id: customer.id })
    .eq("id", client.id);

  return customer.id;
}

// mode: "subscription" (pay for the plan picked at signup / upgrade) or
// "topup" (one-time balance top-up). Returns the hosted Stripe Checkout URL
// to redirect the browser to — we never touch raw card data ourselves.
export async function createCheckoutSession({ client, mode, planSlug, amount }) {
  const stripe = getStripe();

  if (!stripe) {
    const err = new Error("Billing is not configured yet. Please contact support.");
    err.code = "BILLING_NOT_CONFIGURED";
    throw err;
  }

  const customerId = await getOrCreateStripeCustomer(client);
  // The frontend's router matches window.location.hash exactly against a
  // fixed page set (see App.jsx's getInitialPage), so "checkout=..." can't
  // live in the hash or it'd fail to match "dashboard" and bounce to the
  // marketing site. Putting it in the query string instead leaves the hash
  // untouched while still being readable by the dashboard after redirect.
  const successUrl = `${FRONTEND_URL}/?checkout=success#dashboard`;
  const cancelUrl = `${FRONTEND_URL}/?checkout=cancel#dashboard`;

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

    if (!plan.stripe_price_id) {
      const err = new Error(`The ${plan.name} plan isn't available for checkout yet.`);
      err.code = "PLAN_NOT_CHECKOUT_READY";
      throw err;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { clientId: client.id, planSlug: plan.slug },
      subscription_data: { metadata: { clientId: client.id, planSlug: plan.slug } }
    });

    return session.url;
  }

  if (mode === "topup") {
    const amt = Number(amount);

    if (!(amt > 0)) {
      const err = new Error("A positive top-up amount is required");
      err.code = "INVALID_AMOUNT";
      throw err;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "LetConvo AI balance top-up" },
            unit_amount: Math.round(amt * 100)
          },
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { clientId: client.id, type: "topup", amount: String(amt) }
    });

    return session.url;
  }

  const err = new Error(`Unsupported checkout mode: ${mode}`);
  err.code = "INVALID_MODE";
  throw err;
}

export async function handleCheckoutSessionCompleted(session) {
  const clientId = session.metadata?.clientId;
  if (!clientId) return;

  if (session.mode === "subscription") {
    const planSlug = session.metadata?.planSlug;

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
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
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
      reference: session.id
    });

    await createNotification({
      clientId,
      title: "Subscription active",
      message: `You're now subscribed to the ${plan?.name || planSlug} plan.`,
      type: "alert"
    });

    return;
  }

  // One-time top-up.
  const amount = Number(session.metadata?.amount || (session.amount_total || 0) / 100);

  const { data: client, error: fetchError } = await supabase
    .from("clients")
    .select("credits_remaining")
    .eq("id", clientId)
    .single();

  if (fetchError) throw fetchError;

  const newBalance = Number(client.credits_remaining || 0) + amount;

  const { error: updateError } = await supabase
    .from("clients")
    .update({
      credits_remaining: newBalance,
      status: "active",
      stripe_customer_id: session.customer
    })
    .eq("id", clientId);

  if (updateError) throw updateError;

  await createBillingTransaction({
    clientId,
    type: "topup",
    description: "Balance top-up",
    amount,
    balanceAfter: newBalance,
    reference: session.id
  });

  await createNotification({
    clientId,
    title: "Top-up successful",
    message: `$${amount.toFixed(2)} added to your balance.`,
    type: "alert"
  });
}

export async function handleInvoicePaid(invoice) {
  // The first invoice of a subscription is already handled by
  // checkout.session.completed — only monthly renewals should land here.
  if (invoice.billing_reason !== "subscription_cycle") return;

  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, plan_id")
    .eq("stripe_subscription_id", subscriptionId)
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
    reference: invoice.id
  });

  await createNotification({
    clientId: client.id,
    title: "Subscription renewed",
    message: `Your ${plan?.name || "plan"} renewed — credits refreshed.`,
    type: "alert"
  });
}

export async function handleSubscriptionDeleted(subscription) {
  const { error } = await supabase
    .from("clients")
    .update({ subscription_status: "canceled" })
    .eq("stripe_subscription_id", subscription.id);

  if (error) throw error;
}
