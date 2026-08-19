import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { activateClientIfEnoughCredits } from "../service/credit.js";

const router = express.Router();

const FULL_WIPE_TABLES = [
  "client_settings",
  "billing_transactions",
  "credit_transactions",
  "retell_call_logs",
  "active_calls",
  "bookings",
  "client_numbers",
  "missed_call_recoveries",
  "notifications"
];

router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const { data: clients, error } = await supabase
      .from("clients")
      .select("id, status, credits_remaining, created_at");

    if (error) throw error;

    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    return res.json({
      success: true,
      stats: {
        totalCompanies: clients.length,
        activeCompanies: clients.filter((c) => c.status === "active").length,
        pausedCompanies: clients.filter((c) => c.status === "paused").length,
        totalCreditsOutstanding: clients.reduce((sum, c) => sum + Number(c.credits_remaining || 0), 0),
        newSignups48h: clients.filter((c) => c.created_at >= fortyEightHoursAgo).length
      }
    });
  } catch (err) {
    console.error("❌ Admin stats error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/companies", requireAdmin, async (req, res) => {
  try {
    const { q, status } = req.query;

    let query = supabase
      .from("clients")
      .select("id, business_name, ownerName, ownerEmail, status, credits_remaining, plan_id, subscription_status, created_at")
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);

    if (q) {
      const term = `%${q}%`;
      query = query.or(`business_name.ilike.${term},ownerEmail.ilike.${term},ownerName.ilike.${term}`);
    }

    const { data: clients, error } = await query;
    if (error) throw error;

    const { data: plans, error: plansError } = await supabase.from("plans").select("id, name");
    if (plansError) throw plansError;

    const planNameById = new Map(plans.map((p) => [p.id, p.name]));

    return res.json({
      success: true,
      companies: clients.map((c) => ({ ...c, planName: planNameById.get(c.plan_id) || null }))
    });
  } catch (err) {
    console.error("❌ Admin companies list error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/companies/recent-signups", requireAdmin, async (req, res) => {
  try {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: companies, error } = await supabase
      .from("clients")
      .select("id, business_name, ownerName, ownerEmail, plan_id, created_at")
      .gte("created_at", fortyEightHoursAgo)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({ success: true, companies });
  } catch (err) {
    console.error("❌ Admin recent signups error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/plans", requireAdmin, async (req, res) => {
  try {
    const { data: plans, error } = await supabase
      .from("plans")
      .select("*")
      .eq("is_active", true)
      .order("price_usd", { ascending: true });

    if (error) throw error;

    return res.json({ success: true, plans });
  } catch (err) {
    console.error("❌ Admin plans list error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/companies/:clientId", requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) throw clientError;
    if (!client) return res.status(404).json({ error: "Company not found" });

    const [settingsRes, numbersRes, callsRes, billingRes, creditTxRes] = await Promise.all([
      supabase.from("client_settings").select("*").eq("client_id", clientId).maybeSingle(),
      supabase.from("client_numbers").select("*").eq("client_id", clientId),
      supabase.from("retell_call_logs").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(20),
      supabase.from("billing_transactions").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(20),
      supabase.from("credit_transactions").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(20)
    ]);

    if (settingsRes.error) throw settingsRes.error;
    if (numbersRes.error) throw numbersRes.error;
    if (callsRes.error) throw callsRes.error;
    if (billingRes.error) throw billingRes.error;
    if (creditTxRes.error) throw creditTxRes.error;

    return res.json({
      success: true,
      client,
      settings: settingsRes.data || null,
      numbers: numbersRes.data || [],
      recentCalls: callsRes.data || [],
      recentBilling: billingRes.data || [],
      recentCreditTransactions: creditTxRes.data || []
    });
  } catch (err) {
    console.error("❌ Admin company detail error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.patch("/companies/:clientId/plan", requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { planId } = req.body;

    if (!planId) return res.status(400).json({ error: "planId is required" });

    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id")
      .eq("id", planId)
      .eq("is_active", true)
      .maybeSingle();

    if (planError) throw planError;
    if (!plan) return res.status(400).json({ error: "Invalid or inactive plan" });

    const { data: client, error } = await supabase
      .from("clients")
      .update({ plan_id: planId })
      .eq("id", clientId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!client) return res.status(404).json({ error: "Company not found" });

    return res.json({ success: true, client });
  } catch (err) {
    console.error("❌ Admin plan update error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.patch("/companies/:clientId/status", requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { status } = req.body;

    if (status !== "active" && status !== "paused") {
      return res.status(400).json({ error: "status must be 'active' or 'paused'" });
    }

    const { data: client, error } = await supabase
      .from("clients")
      .update({ status })
      .eq("id", clientId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!client) return res.status(404).json({ error: "Company not found" });

    return res.json({ success: true, client });
  } catch (err) {
    console.error("❌ Admin status update error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.post("/companies/:clientId/credits/adjust", requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { amount, type, description } = req.body;

    const amountNum = Number(amount);

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    if (type !== "credit" && type !== "debit") {
      return res.status(400).json({ error: "type must be 'credit' or 'debit'" });
    }

    const { data: client, error: fetchError } = await supabase
      .from("clients")
      .select("id, credits_remaining")
      .eq("id", clientId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!client) return res.status(404).json({ error: "Company not found" });

    const current = Number(client.credits_remaining || 0);
    const newBalance = type === "credit" ? current + amountNum : current - amountNum;

    if (newBalance < 0) {
      return res.status(400).json({ error: "This debit would take credits_remaining below 0" });
    }

    const { error: updateError } = await supabase
      .from("clients")
      .update({ credits_remaining: newBalance })
      .eq("id", clientId);

    if (updateError) throw updateError;

    const { data: transaction, error: txError } = await supabase
      .from("credit_transactions")
      .insert({
        client_id: clientId,
        amount: amountNum,
        type,
        description: description || "Admin adjustment"
      })
      .select()
      .single();

    if (txError) throw txError;

    if (type === "credit") {
      await activateClientIfEnoughCredits(clientId);
    }

    return res.json({ success: true, newBalance, transaction });
  } catch (err) {
    console.error("❌ Admin credit adjustment error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.put("/companies/:clientId/phone-number", requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { telnyxNumber } = req.body;

    if (!telnyxNumber) return res.status(400).json({ error: "telnyxNumber is required" });

    const { data: conflict, error: conflictError } = await supabase
      .from("client_numbers")
      .select("client_id")
      .eq("telnyx_number", telnyxNumber)
      .neq("client_id", clientId)
      .maybeSingle();

    if (conflictError) throw conflictError;

    if (conflict) {
      return res.status(409).json({
        error: "This number is already assigned to another company",
        conflictingClientId: conflict.client_id
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("client_numbers")
      .select("id")
      .eq("client_id", clientId)
      .maybeSingle();

    if (existingError) throw existingError;

    let number;

    if (existing) {
      const { data, error } = await supabase
        .from("client_numbers")
        .update({ telnyx_number: telnyxNumber })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) throw error;
      number = data;
    } else {
      const { data, error } = await supabase
        .from("client_numbers")
        .insert({ client_id: clientId, telnyx_number: telnyxNumber })
        .select()
        .single();

      if (error) throw error;
      number = data;
    }

    return res.json({ success: true, number });
  } catch (err) {
    console.error("❌ Admin phone number assignment error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.put("/companies/:clientId/retell-agent", requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { retellAgentId } = req.body;

    if (!retellAgentId) return res.status(400).json({ error: "retellAgentId is required" });

    const { data: existing, error: existingError } = await supabase
      .from("client_settings")
      .select("id")
      .eq("client_id", clientId)
      .maybeSingle();

    if (existingError) throw existingError;

    let settings;

    if (existing) {
      const { data, error } = await supabase
        .from("client_settings")
        .update({ retell_agent_id: retellAgentId })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) throw error;
      settings = data;
    } else {
      const { data, error } = await supabase
        .from("client_settings")
        .insert({ client_id: clientId, retell_agent_id: retellAgentId })
        .select()
        .single();

      if (error) throw error;
      settings = data;
    }

    return res.json({ success: true, settings });
  } catch (err) {
    console.error("❌ Admin Retell agent assignment error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Irreversible full wipe — deletes every dependent row plus the clients row
// and the Supabase auth user. Table order/list matches the proven pattern
// used for QA test-account cleanup during development: dependent tables
// first (each .eq("client_id", clientId)), then the clients row, then the
// auth user. Errors on individual tables are logged and collected rather
// than aborting mid-wipe, since a table with no matching rows (or an
// unexpected FK) shouldn't block the rest of the cleanup.
router.delete("/companies/:clientId", requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;

    const { data: client, error: fetchError } = await supabase
      .from("clients")
      .select("id, business_name, user_id")
      .eq("id", clientId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!client) return res.status(404).json({ error: "Company not found" });

    const warnings = [];

    for (const table of FULL_WIPE_TABLES) {
      const { error } = await supabase.from(table).delete().eq("client_id", clientId);
      if (error) {
        console.error(`❌ Admin delete: failed clearing ${table} for ${clientId}:`, error);
        warnings.push(`${table}: ${error.message}`);
      }
    }

    const { error: deleteClientError } = await supabase.from("clients").delete().eq("id", clientId);
    if (deleteClientError) throw deleteClientError;

    if (client.user_id) {
      const { error: deleteUserError } = await supabase.auth.admin.deleteUser(client.user_id);
      if (deleteUserError) {
        console.error(`❌ Admin delete: failed deleting auth user for ${clientId}:`, deleteUserError);
        warnings.push(`auth user: ${deleteUserError.message}`);
      }
    }

    return res.json({
      success: true,
      deletedClientId: clientId,
      businessName: client.business_name,
      warnings: warnings.length ? warnings : undefined
    });
  } catch (err) {
    console.error("❌ Admin delete company error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
