import express from "express";
import { supabase } from "../config/supabase.js";
import { sendEmail } from "../utils/email.js";

const router = express.Router();

// Free trial balance every new signup starts with, regardless of the plan
// they picked — separate from that plan's monthly_credits, which only
// applies once they actually subscribe. Matches the "450 credits free
// trial" promise shown on the signup page (GetStartedPage.jsx).
const TRIAL_CREDITS = 450;

// Letconvo is only staffed/supported for US and Canadian businesses right
// now (Telnyx numbers, business hours, etc. all assume NANP). GetStartedPage
// blocks unsupported countries client-side, but that's UX only — this is
// the actual gate, since /register-business can be hit directly.
const SUPPORTED_COUNTRIES = new Set(["united states", "usa", "us", "canada", "ca"]);

router.post("/register-business", async (req, res) => {
  try {
    const {
      businessName,
      businessType,
      country,
      businessPhone,
      businessEmail,
      businessAddress,
      websiteUrl,
      receptionistMode,
      greetingMessage,
      openTime,
      closeTime,
      workingDays,
      bookingFields,
      servicesOffered,
      bookingPolicies,
      plan,
      ownerName,
      ownerEmail,
      password
    } = req.body;

    if (!SUPPORTED_COUNTRIES.has(String(country || "").trim().toLowerCase())) {
      return res.status(400).json({
        error: "Letconvo is currently only available to businesses in the United States and Canada."
      });
    }

    // GetStartedPage marks these required client-side (so the AI has real
    // schedule data instead of guessing), but that's UX only — /register-business
    // can be hit directly, so enforce it here too.
    if (!openTime || !closeTime) {
      return res.status(400).json({ error: "Working hours are required" });
    }

    if (!Array.isArray(workingDays) || workingDays.length === 0) {
      return res.status(400).json({ error: "At least one working day is required" });
    }

    // Loose "looks like a domain" check (e.g. "apexhealth.com",
    // "https://apexhealth.com") rather than a strict URL parse — signups
    // paste this in all sorts of forms, and this is reference material for
    // hand-building the client's prompt, not something the backend fetches.
    const trimmedWebsiteUrl = String(websiteUrl || "").trim();
    if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(trimmedWebsiteUrl)) {
      return res.status(400).json({ error: "A valid website URL is required" });
    }
    const normalizedWebsiteUrl = /^https?:\/\//i.test(trimmedWebsiteUrl)
      ? trimmedWebsiteUrl
      : `https://${trimmedWebsiteUrl}`;

    // A Google (or other OAuth) sign-in already creates the Supabase auth
    // user before this endpoint is ever called — GetStartedPage sends that
    // session's access token instead of a password in that case.
    const bearerToken = req.headers.authorization?.replace("Bearer ", "");
    let oauthUser = null;

    if (bearerToken) {
      const { data, error } = await supabase.auth.getUser(bearerToken);
      if (!error && data?.user) oauthUser = data.user;
    }

    if (!oauthUser && (!ownerEmail || !password)) {
      return res.status(400).json({ error: "Owner email and password are required" });
    }

    // 1. Check if client already exists
    const { data: existingClient, error: existingError } = await supabase
      .from("clients")
      .select("*")
      .eq(oauthUser ? "user_id" : "ownerEmail", oauthUser ? oauthUser.id : ownerEmail)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingClient) {
      return res.status(409).json({
        error: "Business account already exists. Please login instead."
      });
    }

    // 2. Reuse the OAuth session's user, or create a new Supabase Auth user
    let user;

    if (oauthUser) {
      user = oauthUser;
    } else {
      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email: ownerEmail,
          password,
          email_confirm: true
        });

      if (authError) throw authError;
      user = authData.user;
    }

    if (!user?.id) {
      return res.status(500).json({ error: "Failed to create auth user" });
    }

    const { data: selectedPlan, error: planError } = await supabase
      .from("plans")
      .select("id, monthly_credits, min_start_credits")
      .eq("slug", plan)
      .eq("is_active", true)
      .single();

    if (planError || !selectedPlan) {
      return res.status(400).json({ error: "Invalid plan selected" });
    }

    // 3. Create client row
    // New signups start on a flat trial credit balance, not the chosen
    // plan's full monthly_credits — the plan they picked only becomes their
    // real billing once they subscribe (see service/billing.js), which is
    // triggered automatically when this trial balance runs out.
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .insert({
        user_id: user.id,
        business_name: businessName,
        email: businessEmail,
        phone: businessPhone,
        credits_remaining: TRIAL_CREDITS,
        status: "active",
        subscription_status: "trial",
        ownerName: ownerName || oauthUser?.user_metadata?.full_name || oauthUser?.user_metadata?.name || "",
        ownerEmail: ownerEmail || oauthUser?.email,
        receptionist_mode: receptionistMode,
        plan_id: selectedPlan.id
      })
      .select()
      .single();

    if (clientError) throw clientError;

    // 3b. Guard against the TOCTOU race between the "already exists" check
    // above and this insert (e.g. a double-submitted signup form): if a
    // sibling row for this user_id now exists, only the oldest one wins.
    // Every concurrent request converges on the same decision independently,
    // so the losing row(s) always end up deleted regardless of which
    // request runs this check first.
    const { data: siblings, error: siblingsError } = await supabase
      .from("clients")
      .select("id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (siblingsError) throw siblingsError;

    if (siblings.length > 1) {
      const canonical = siblings[0];
      const losers = siblings.slice(1).map((c) => c.id);

      await supabase.from("client_settings").delete().in("client_id", losers);
      await supabase.from("clients").delete().in("id", losers);

      if (canonical.id !== client.id) {
        return res.status(409).json({
          error: "Business account already exists. Please login instead."
        });
      }
    }

    // 3c. Notify the admin of a new signup — best-effort (sendEmail never
    // throws), sent only once this request has won the TOCTOU race above.
    const adminEmail = (process.env.ADMIN_EMAILS || "").split(",")[0]?.trim();
    if (adminEmail) {
      const resolvedOwnerEmail = ownerEmail || oauthUser?.email || "-";
      await sendEmail({
        to: adminEmail,
        subject: `New signup: ${businessName}`,
        text: `New business signed up: ${businessName}\nOwner: ${ownerName || "-"} <${resolvedOwnerEmail}>\nPlan: ${plan}\nClient ID: ${client.id}`,
        html: `<p>New business signed up: <b>${businessName}</b></p><p>Owner: ${ownerName || "-"} &lt;${resolvedOwnerEmail}&gt;</p><p>Plan: ${plan}</p><p>Client ID: ${client.id}</p>`
      });
    }

    // 4. Create client settings
    const { error: settingsError } = await supabase
      .from("client_settings")
      .insert({
        client_id: client.id,
        receptionist_mode: receptionistMode,
        business_name: businessName,
        greeting: greetingMessage,
        businessAddress,
        open_hour: openTime,
        close_hour: closeTime,
        working_days: Array.isArray(workingDays) && workingDays.length
          ? workingDays
          : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        website_url: normalizedWebsiteUrl,
        businessType,
        email: ownerEmail || oauthUser?.email,
        plan,
        // What the AI should collect from a caller before booking, plus
        // free-text service list/policies — reference material used to
        // hand-build this client's Retell agent prompt (see GetStartedPage's
        // "Booking Details" step).
        booking_info_fields: Array.isArray(bookingFields) ? bookingFields : [],
        services_offered: servicesOffered || null,
        booking_policies: bookingPolicies || null
      });

    if (settingsError) throw settingsError;

    // // 5. Assign demo Telnyx number
    // const telnyxNumber = NULL;

    // const { error: numberError } = await supabase
    //   .from("client_numbers")
    //   .insert({
    //     client_id: client.id,
    //     telnyx_number: telnyxNumber
    //   });

    // if (numberError) throw numberError;

    // 6. Get a fresh session — the OAuth user already has one (reuse its
    // token), otherwise sign in the freshly-created email/password user.
    let accessToken = bearerToken;
    let refreshToken;

    if (!oauthUser) {
      const { data: loginData, error: loginError } =
        await supabase.auth.signInWithPassword({
          email: ownerEmail,
          password
        });

      if (loginError) throw loginError;
      accessToken = loginData.session.access_token;
      refreshToken = loginData.session.refresh_token;
    }

    return res.json({
      success: true,
      clientId: client.id,
      user,
      access_token: accessToken,
      refresh_token: refreshToken
    });
  } catch (error) {
    console.error("❌ FULL ERROR:", error);

    return res.status(500).json({
      error: error.message
    });
  }
});

export default router;