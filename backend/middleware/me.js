import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";
// import {
//   getLiveCalls
// } from "../service/liveCalls.js";

const router = express.Router();

const getClientByUserId = async (userId, select = "*") => {
  const { data, error } = await supabase
    .from("clients")
    .select(select)
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return data;
};

const getTodayTrend = (calls = []) => {
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);

  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);

  const todayCalls = calls.filter((c) => {
    if (!c.created_at) return false;
    return new Date(c.created_at) >= startToday;
  }).length;

  const yesterdayCalls = calls.filter((c) => {
    if (!c.created_at) return false;
    const d = new Date(c.created_at);
    return d >= startYesterday && d < startToday;
  }).length;

  let callsChangePercent = 0;
  let callsTrend = "neutral";

  if (yesterdayCalls === 0 && todayCalls > 0) {
    callsChangePercent = 100;
    callsTrend = "up";
  } else if (yesterdayCalls > 0) {
    callsChangePercent = Math.round(
      ((todayCalls - yesterdayCalls) / yesterdayCalls) * 100
    );

    if (callsChangePercent > 0) callsTrend = "up";
    else if (callsChangePercent < 0) callsTrend = "down";
  }

  return { todayCalls, yesterdayCalls, callsChangePercent, callsTrend };
};

router.get("/me/client", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id);

    const { data: settings, error: settingsError } = await supabase
      .from("client_settings")
      .select("*")
      .eq("client_id", client.id)
      .maybeSingle();

    if (settingsError) throw settingsError;

    const { data: numbers, error: numbersError } = await supabase
      .from("client_numbers")
      .select("*")
      .eq("client_id", client.id);

    if (numbersError) throw numbersError;

    return res.json({
      success: true,
      client: {
        ...client,
        client_settings: settings || null,
        client_numbers: numbers || []
      }
    });
  } catch (err) {
    console.error("❌ Fetch client error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/me/dashboard-stats", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id);

    const { data: calls = [], error: callsError } = await supabase
      .from("retell_call_logs")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    if (callsError) throw callsError;

    const { todayCalls, yesterdayCalls, callsChangePercent, callsTrend } =
      getTodayTrend(calls);

    const completedCalls = calls.filter((call) =>
      ["completed", "ended", "call_ended"].includes(
        String(call.call_status || "").toLowerCase()
      )
    );

    const missedCalls = calls.filter((call) =>
      [
        "missed",
        "not_connected",
        "dial_no_answer",
        "dial_busy",
        "dial_failed"
      ].includes(
        String(call.call_status || call.disconnection_reason || "").toLowerCase()
      )
    );

    const transferredCalls = calls.filter(
      (call) =>
        String(call.call_status || "").toLowerCase() === "transferred" ||
        String(call.disconnection_reason || "").toLowerCase() ===
          "call_transfer"
    );

    const totalDurationMs = calls.reduce(
      (sum, call) => sum + Number(call.duration_ms || 0),
      0
    );

    const avgDurationSeconds =
      calls.length > 0 ? Math.round(totalDurationMs / calls.length / 1000) : 0;

    const avgDuration =
      avgDurationSeconds >= 60
        ? `${Math.floor(avgDurationSeconds / 60)}:${String(
            avgDurationSeconds % 60
          ).padStart(2, "0")}`
        : `${avgDurationSeconds}s`;

    const transferRate =
      calls.length > 0
        ? `${Math.round((transferredCalls.length / calls.length) * 100)}%`
        : "0%";

    const positiveCalls = calls.filter(
      (call) =>
        String(
          call.sentiment ||
            call.raw_payload?.data?.call_analysis?.user_sentiment ||
            call.raw_payload?.call?.call_analysis?.user_sentiment ||
            ""
        ).toLowerCase() === "positive"
    );

    const satisfactionScore =
      calls.length > 0
        ? Number(((positiveCalls.length / calls.length) * 5).toFixed(1))
        : 0;

    const totalCreditsUsed = calls.reduce(
      (sum, call) => sum + Number(call.credits_deducted || 0),
      0
    );

    const totalCost = calls.reduce(
      (sum, call) => sum + Number(call.call_cost || 0),
      0
    );

    const { data: activeCalls = [], error: activeCallsError } = await supabase
      .from("active_calls")
      .select("*")
      .eq("client_id", client.id)
      .eq("status", "active");

    if (activeCallsError) throw activeCallsError;

    const weeklyData = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
      (day) => ({ day, calls: 0 })
    );

    calls.forEach((call) => {
      if (!call.created_at) return;

      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
        new Date(call.created_at).getDay()
      ];

      const row = weeklyData.find((x) => x.day === day);
      if (row) row.calls += 1;
    });

    return res.json({
      success: true,
      stats: {
        callsToday: todayCalls,
        callsYesterday: yesterdayCalls,
        callsChangePercent,
        callsTrend,

        appointmentsBooked: 0,
        leadsQualified: completedCalls.length,
        missedCalls: missedCalls.length,

        liveCalls: activeCalls.length,
        activeCallers: activeCalls.map((c) => ({
          id: c.id,
          callerPhone: c.caller_phone || "Unknown caller",
          businessNumber: c.business_number || null,
          startedAt: c.started_at
        })),

        totalCalls: calls.length,
        satisfactionScore,
        avgDuration,
        transferRate,

        creditsRemaining: Number(client.credits_remaining || 0),
        creditsUsed: totalCreditsUsed,
        totalCost: Number(totalCost.toFixed(2)),
        status: client.status,
        receptionistMode: client.receptionist_mode
      },
      weeklyData,
      recentCalls: calls.slice(0, 5)
    });
  } catch (err) {
    console.error("❌ Dashboard stats error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/me/calls", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id, "id");

    const { data: calls = [], error } = await supabase
      .from("retell_call_logs")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({
      success: true,
      totalCalls: calls.length,
      calls
    });
  } catch (err) {
    console.error("❌ Calls error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// router.get("/me/analytics", requireAuth, async (req, res) => {
//   try {
//     const period = req.query.period || "week";
//     const now = new Date();
//     const startDate = new Date();

//     // const now = new Date();

// const currentWeekStart = new Date(now);
// currentWeekStart.setDate(now.getDate() - 7);

// const previousWeekStart = new Date(now);
// previousWeekStart.setDate(now.getDate() - 14);

// const previousWeekEnd = new Date(now);
// previousWeekEnd.setDate(now.getDate() - 7);

// const currentWeekCalls = allCalls.filter(call => {
//   const d = new Date(call.created_at);
//   return d >= currentWeekStart;
// }).length;

// const previousWeekCalls = allCalls.filter(call => {
//   const d = new Date(call.created_at);
//   return d >= previousWeekStart && d < previousWeekEnd;
// }).length;


// let periodChangePercent = 0;

// const currentDayCalls = todayCalls;
// const previousDayCalls = yesterdayCalls;

// // let periodChangePercent = 0;

// if (previousDayCalls > 0) {
//   periodChangePercent = Math.round(
//     ((currentDayCalls - previousDayCalls) / previousDayCalls) * 100
//   );
// }

// if (previousWeekCalls > 0) {
//   periodChangePercent = Math.round(
//     ((currentWeekCalls - previousWeekCalls) / previousWeekCalls) * 100
//   );
// }

// const currentMonthCalls = currentMonth.length;
// const previousMonthCalls = previousMonth.length;

// // let periodChangePercent = 0;

// if (previousMonthCalls > 0) {
//   periodChangePercent = Math.round(
//     ((currentMonthCalls - previousMonthCalls) / previousMonthCalls) * 100
//   );
// }

//     if (period === "day") startDate.setHours(0, 0, 0, 0);
//     else if (period === "week") startDate.setDate(now.getDate() - 7);
//     else if (period === "month") startDate.setMonth(now.getMonth() - 1);

//     const client = await getClientByUserId(req.user.id, "id");

//     const { data: calls = [], error } = await supabase
//       .from("retell_call_logs")
//       .select("*")
//       .eq("client_id", client.id)
//       .gte("created_at", startDate.toISOString())
//       .order("created_at", { ascending: false });

//     if (error) throw error;

//     const { todayCalls, yesterdayCalls, callsChangePercent, callsTrend } =
//       getTodayTrend(calls);

//     const totalCalls = calls.length;

//     const completed = calls.filter((c) =>
//       ["completed", "ended", "call_ended"].includes(
//         String(c.call_status || "").toLowerCase()
//       )
//     ).length;

//     const missed = calls.filter((c) =>
//       ["missed", "dial_no_answer", "dial_busy", "dial_failed"].includes(
//         String(c.disconnection_reason || c.call_status || "").toLowerCase()
//       )
//     ).length;

//     const transferred = calls.filter(
//       (c) =>
//         String(c.disconnection_reason || "").toLowerCase() === "call_transfer"
//     ).length;

//     const sentimentCounts = {
//       positive: 0,
//       neutral: 0,
//       negative: 0,
//       unknown: 0
//     };

//     calls.forEach((call) => {
//       const s = String(
//         call.sentiment ||
//           call.raw_payload?.call?.call_analysis?.user_sentiment ||
//           call.raw_payload?.data?.call_analysis?.user_sentiment ||
//           ""
//       )
//         .trim()
//         .toLowerCase();

//       if (s === "positive") sentimentCounts.positive += 1;
//       else if (s === "negative") sentimentCounts.negative += 1;
//       else if (s === "neutral") sentimentCounts.neutral += 1;
//       else sentimentCounts.unknown += 1;
//     });

//     const totalDurationMs = calls.reduce(
//       (sum, c) => sum + Number(c.duration_ms || 0),
//       0
//     );

//     const avgSec =
//       totalCalls > 0 ? Math.round(totalDurationMs / totalCalls / 1000) : 0;

//     const avgDuration =
//       avgSec >= 60
//         ? `${Math.floor(avgSec / 60)}:${String(avgSec % 60).padStart(2, "0")}`
//         : `${avgSec}s`;

//     const answeredRate =
//       totalCalls > 0 ? Math.round((completed / totalCalls) * 100) : 0;

//     const transferRate =
//       totalCalls > 0 ? Math.round((transferred / totalCalls) * 100) : 0;

//     const successfulCalls = calls.filter(
//       (c) => c.raw_payload?.call?.call_analysis?.call_successful === true
//     ).length;

//     const firstCallResolution =
//       totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 100) : 0;

//     const normalizePhone = (phone) =>
//       String(phone || "")
//         .replace(/\s+/g, "")
//         .replace(/[^\d+]/g, "");

//     const callerCounts = {};

//     calls.forEach((call) => {
//       const phone = normalizePhone(call.caller_phone);
//       if (!phone) return;
//       callerCounts[phone] = (callerCounts[phone] || 0) + 1;
//     });

//     const uniqueCallerCount = Object.keys(callerCounts).length;

//     const repeatCallerCount = Object.values(callerCounts).filter(
//       (count) => count > 1
//     ).length;

//     const repeatCallerRate =
//       uniqueCallerCount > 0
//         ? Math.round((repeatCallerCount / uniqueCallerCount) * 100)
//         : 0;

//     const repeatCallerCalls = Object.values(callerCounts).reduce(
//       (sum, count) => sum + (count > 1 ? count : 0),
//       0
//     );
    

//     const npsScore =
//       totalCalls > 0
//         ? Math.round(
//             ((sentimentCounts.positive - sentimentCounts.negative) /
//               totalCalls) *
//               100
//           )
//         : 0;

//     const weeklyData = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
//       (day) => ({ day, calls: 0 })
//     );

//     calls.forEach((call) => {
//       if (!call.created_at) return;

//       const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
//         new Date(call.created_at).getDay()
//       ];

//       const row = weeklyData.find((x) => x.day === day);
//       if (row) row.calls += 1;
//     });

//     const hourlyData = [
//       "8am",
//       "9am",
//       "10am",
//       "11am",
//       "12pm",
//       "1pm",
//       "2pm",
//       "3pm",
//       "4pm",
//       "5pm"
//     ].map((hour) => ({ hour, calls: 0 }));

//     calls.forEach((call) => {
//       if (!call.created_at) return;

//       const h = new Date(call.created_at).getHours();

//       const label =
//         h === 0
//           ? "12am"
//           : h === 12
//           ? "12pm"
//           : h > 12
//           ? `${h - 12}pm`
//           : `${h}am`;

//       const row = hourlyData.find((x) => x.hour === label);
//       if (row) row.calls += 1;
//     });

//     return res.json({
//       success: true,
//       period,
//       analytics: {
//         totalCalls,
//         callsToday: todayCalls,
//         callsYesterday: yesterdayCalls,
//         callsChangePercent,
//         callsTrend,
//         periodChangePercent,


//         answeredRate,
//         avgDuration,
//         satisfaction: totalCalls > 0 ? "4.8/5" : "0/5",

//         callStatus: {
//           completed,
//           transferred,
//           missed
//         },

//         sentiment: sentimentCounts,
//         weeklyData,
//         hourlyData,

//         keyMetrics: {
//           answerRate: `${answeredRate}%`,
//           firstCallResolution: `${firstCallResolution}%`,
//           avgWaitTime: "0s",
//           transferRate: `${transferRate}%`,
//           bookingConversion: "0%",
//           repeatCallers: `${repeatCallerRate}%`,
//           repeatCallerCount,
//           repeatCallerCalls,
//           uniqueCallerCount,
//           npsScore
//         }
//       }
//     });
//   } catch (err) {
//     console.error("❌ Analytics error:", err);
//     return res.status(500).json({ error: err.message });
//   }
// });

router.get("/me/analytics", requireAuth, async (req, res) => {
  try {
    const period = req.query.period || "week";
    const now = new Date();

    const client = await getClientByUserId(req.user.id, "id");

    const { data: allCalls = [], error: allCallsError } = await supabase
      .from("retell_call_logs")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    if (allCallsError) throw allCallsError;

    let currentStart = new Date();
    let previousStart = new Date();
    let previousEnd = new Date();
    let compareLabel = "last week";

    if (period === "day") {
      currentStart.setHours(0, 0, 0, 0);

      previousStart = new Date(currentStart);
      previousStart.setDate(previousStart.getDate() - 1);

      previousEnd = new Date(currentStart);
      compareLabel = "yesterday";
    }

    if (period === "week") {
      currentStart = new Date(now);
      currentStart.setDate(now.getDate() - 7);

      previousStart = new Date(now);
      previousStart.setDate(now.getDate() - 14);

      previousEnd = new Date(now);
      previousEnd.setDate(now.getDate() - 7);

      compareLabel = "last week";
    }

    if (period === "month") {
      currentStart = new Date(now);
      currentStart.setMonth(now.getMonth() - 1);

      previousStart = new Date(now);
      previousStart.setMonth(now.getMonth() - 2);

      previousEnd = new Date(now);
      previousEnd.setMonth(now.getMonth() - 1);

      compareLabel = "last month";
    }

    const calls = allCalls.filter((call) => {
      if (!call.created_at) return false;
      return new Date(call.created_at) >= currentStart;
    });

    const previousCalls = allCalls.filter((call) => {
      if (!call.created_at) return false;
      const d = new Date(call.created_at);
      return d >= previousStart && d < previousEnd;
    });

    const currentCount = calls.length;
    const previousCount = previousCalls.length;

    let periodChangePercent = 0;
    let periodTrend = "neutral";

    if (previousCount === 0 && currentCount > 0) {
      periodChangePercent = 100;
      periodTrend = "up";
    } else if (previousCount > 0) {
      periodChangePercent = Math.round(
        ((currentCount - previousCount) / previousCount) * 100
      );

      if (periodChangePercent > 0) periodTrend = "up";
      if (periodChangePercent < 0) periodTrend = "down";
    }

    const totalCalls = calls.length;

    const completed = calls.filter((c) =>
      ["completed", "ended", "call_ended"].includes(
        String(c.call_status || "").toLowerCase()
      )
    ).length;

    const missed = calls.filter((c) =>
      ["missed", "dial_no_answer", "dial_busy", "dial_failed"].includes(
        String(c.disconnection_reason || c.call_status || "").toLowerCase()
      )
    ).length;

    const transferred = calls.filter(
      (c) =>
        String(c.disconnection_reason || "").toLowerCase() === "call_transfer"
    ).length;

    const sentimentCounts = {
      positive: 0,
      neutral: 0,
      negative: 0,
      unknown: 0
    };

    calls.forEach((call) => {
      const s = String(
        call.sentiment ||
          call.raw_payload?.call?.call_analysis?.user_sentiment ||
          call.raw_payload?.data?.call_analysis?.user_sentiment ||
          ""
      )
        .trim()
        .toLowerCase();

      if (s === "positive") sentimentCounts.positive += 1;
      else if (s === "negative") sentimentCounts.negative += 1;
      else if (s === "neutral") sentimentCounts.neutral += 1;
      else sentimentCounts.unknown += 1;
    });

    const totalDurationMs = calls.reduce(
      (sum, c) => sum + Number(c.duration_ms || 0),
      0
    );

    const avgSec =
      totalCalls > 0 ? Math.round(totalDurationMs / totalCalls / 1000) : 0;

    const avgDuration =
      avgSec >= 60
        ? `${Math.floor(avgSec / 60)}:${String(avgSec % 60).padStart(2, "0")}`
        : `${avgSec}s`;

    const answeredRate =
      totalCalls > 0 ? Math.round((completed / totalCalls) * 100) : 0;

    const transferRate =
      totalCalls > 0 ? Math.round((transferred / totalCalls) * 100) : 0;

    const weeklyData = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
      (day) => ({ day, calls: 0 })
    );

    calls.forEach((call) => {
      if (!call.created_at) return;

      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
        new Date(call.created_at).getDay()
      ];

      const row = weeklyData.find((x) => x.day === day);
      if (row) row.calls += 1;
    });

    const hourlyData = [
      "8am",
      "9am",
      "10am",
      "11am",
      "12pm",
      "1pm",
      "2pm",
      "3pm",
      "4pm",
      "5pm"
    ].map((hour) => ({ hour, calls: 0 }));

    calls.forEach((call) => {
      if (!call.created_at) return;

      const h = new Date(call.created_at).getHours();
      const label =
        h === 0
          ? "12am"
          : h === 12
          ? "12pm"
          : h > 12
          ? `${h - 12}pm`
          : `${h}am`;

      const row = hourlyData.find((x) => x.hour === label);
      if (row) row.calls += 1;
    });

    return res.json({
      success: true,
      period,
      analytics: {
        totalCalls,

        periodChangePercent,
        periodTrend,
        compareLabel,

        answeredRate,
        avgDuration,
        satisfaction: totalCalls > 0 ? "4.8/5" : "0/5",

        callStatus: {
          completed,
          transferred,
          missed
        },

        sentiment: sentimentCounts,
        weeklyData,
        hourlyData,

        keyMetrics: {
          answerRate: `${answeredRate}%`,
          firstCallResolution: "0%",
          avgWaitTime: "0s",
          transferRate: `${transferRate}%`,
          bookingConversion: "0%",
          repeatCallers: "0%",
          npsScore: 0
        }
      }
    });
  } catch (err) {
    console.error("❌ Analytics error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/me/settings", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id);

    const { data: settings, error: settingsError } = await supabase
      .from("client_settings")
      .select("*")
      .eq("client_id", client.id)
      .maybeSingle();

    if (settingsError) throw settingsError;

    const planSlug = client.plan_slug || client.plan || "starter";

    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("*")
      .eq("slug", planSlug)
      .maybeSingle();

    if (planError) throw planError;

    return res.json({
      success: true,
      settings: {
        businessName: client.business_name || "",
        businessAddress: settings?.businessAddress || "",
        adminName: client.ownerName || "",
        adminEmail: client.ownerEmail || client.email || "",
        timezone: settings?.timezone || "Africa/Lagos",
        calendarSync: settings?.calendar_sync ?? false,
        crmSync: settings?.crm_sync ?? false,
        webhookUrl: settings?.webhook_url || "",
        zapierKey: settings?.zapier_key || "",
        emailNotif: settings?.email_notif ?? true,
        smsNotif: settings?.sms_notif ?? true,
        missedAlerts: settings?.missed_alerts ?? true,
        reportFreq: settings?.report_freq || "daily",
        reportEmail: settings?.report_email || client.email || "",
        subscription: {
          plan: plan?.name || "Starter",
          slug: plan?.slug || "starter",
          monthlyPrice: Number(plan?.price_usd || 0),
          includedMinutes: Number(plan?.monthly_credits || 0),
          usedMinutes: Number(client.used_minutes || 0),
          renewalDate: client.renewal_date || null,
          minStartCredits: Number(plan?.min_start_credits || 0)
        }
      }
    });
  } catch (err) {
    console.error("❌ Get settings error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.put("/me/settings", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id, "id");

    const {
      businessName,
      businessAddress,
      adminName,
      adminEmail,
      timezone,
      calendarSync,
      crmSync,
      webhookUrl,
      zapierKey,
      emailNotif,
      smsNotif,
      missedAlerts,
      reportFreq,
      reportEmail
    } = req.body;

    const { error: clientUpdateError } = await supabase
      .from("clients")
      .update({
        business_name: businessName,
        ownerName: adminName,
        ownerEmail: adminEmail,
        email: adminEmail
      })
      .eq("id", client.id);

    if (clientUpdateError) throw clientUpdateError;

    const { data: existingSettings, error: existingError } = await supabase
      .from("client_settings")
      .select("id")
      .eq("client_id", client.id)
      .maybeSingle();

    if (existingError) throw existingError;

    

    const settingsPayload = {
      client_id: client.id,
      business_name: businessName,
      businessAddress,
      timezone,
      calendar_sync: calendarSync,
      crm_sync: crmSync,
      webhook_url: webhookUrl,
      zapier_key: zapierKey,
      email_notif: emailNotif,
      sms_notif: smsNotif,
      missed_alerts: missedAlerts,
      report_freq: reportFreq,
      report_email: reportEmail
    };

    let settingsError;

    if (existingSettings) {
      const { error } = await supabase
        .from("client_settings")
        .update(settingsPayload)
        .eq("client_id", client.id);

      settingsError = error;
    } else {
      const { error } = await supabase
        .from("client_settings")
        .insert(settingsPayload);

      settingsError = error;
    }

    if (settingsError) throw settingsError;

    return res.json({
      success: true,
      message: "Settings updated successfully"
    });
  } catch (err) {
    console.error("❌ Update settings error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/me/billing/transactions", requireAuth, async (req, res) => {
  try {
    const type = req.query.type || "all";
    const client = await getClientByUserId(req.user.id, "id");

    let query = supabase
      .from("billing_transactions")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    if (type !== "all") {
      query = query.eq("type", type);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json({
      success: true,
      transactions: data || []
    });
  } catch (err) {
    console.error("❌ Billing transactions error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/me/billing/summary", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id);

    const planSlug = client.plan_slug || client.plan || "starter";

    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("*")
      .eq("slug", planSlug)
      .maybeSingle();

    if (planError) throw planError;

    const { data: calls = [], error: callsError } = await supabase
      .from("retell_call_logs")
      .select("duration_minutes, call_cost, created_at")
      .eq("client_id", client.id);

    if (callsError) throw callsError;

    const now = new Date();

    const thisMonth = calls.filter((c) => {
      if (!c.created_at) return false;
      const d = new Date(c.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const minutesUsed = thisMonth.reduce(
      (sum, c) => sum + Number(c.duration_minutes || 0),
      0
    );

    const monthlySpend = thisMonth.reduce(
      (sum, c) => sum + Number(c.call_cost || 0),
      0
    );

    const minutesTotal = Number(plan?.monthly_credits || 0);
    const minutesRemaining = Math.max(minutesTotal - minutesUsed, 0);

    return res.json({
      success: true,
      balance: {
        dollarBalance: Number(client.credits_remaining || 0),
        creditsRemaining: Number(client.credits_remaining || 0),
        monthlySpend: Number(monthlySpend.toFixed(2)),

        minutesRemaining,
        minutesUsed,
        minutesTotal,

        planName: plan?.name || "Starter",
        planSlug: plan?.slug || "starter",
        planPrice: Number(plan?.price_usd || 0),
        nextBillingDate: client.renewal_date || null,

        autoTopUp: client.auto_topup ?? false,
        autoTopUpThreshold: Number(client.auto_topup_threshold || 100),
        autoTopUpAmount: Number(client.auto_topup_amount || 50)
      }
    });
  } catch (err) {
    console.error("❌ Billing summary error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/me/payment-methods", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id, "id");

    const { data = [], error } = await supabase
      .from("payment_methods")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const methods = data.map((pm) => ({
      id: pm.id,
      type: pm.card_brand || "card",
      last4: pm.last4,
      expiry: `${String(pm.expiry_month).padStart(2, "0")}/${String(
        pm.expiry_year
      ).slice(-2)}`,
      default: pm.is_default
    }));

    return res.json({
      success: true,
      methods
    });
  } catch (err) {
    console.error("❌ Payment methods error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/plans", async (req, res) => {
  try {
    const { data: plans = [], error } = await supabase
      .from("plans")
      .select("*")
      .order("price_usd", { ascending: true });

    if (error) throw error;

    return res.json({
      success: true,
      plans: plans.map((p) => ({
        name: p.name,
        slug: p.slug,
        price: Number(p.price_usd || 0),
        minutes: Number(p.monthly_credits || 0),
        perMin: Number(p.extra_minute_price || 0.22),
        features: p.features || []
      }))
    });
  } catch (err) {
    console.error("❌ Plans error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/me/todays-performance", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id, "id");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: calls = [], error } = await supabase
      .from("retell_call_logs")
      .select("*")
      .eq("client_id", client.id)
      .gte("created_at", today.toISOString());

    if (error) throw error;

    const totalCalls = calls.length;

    const answeredCalls = calls.filter((c) =>
      ["completed", "ended", "call_ended"].includes(
        String(c.call_status || "").toLowerCase()
      )
    ).length;

    const callAnswerRate =
      totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

    const totalDurationMs = calls.reduce(
      (sum, c) => sum + Number(c.duration_ms || 0),
      0
    );

    const avgSec =
      totalCalls > 0 ? Math.round(totalDurationMs / totalCalls / 1000) : 0;

    const avgHandleTime =
      avgSec >= 60
        ? `${Math.floor(avgSec / 60)}:${String(avgSec % 60).padStart(2, "0")}`
        : `${avgSec}s`;

    const positiveCalls = calls.filter(
      (c) => String(c.sentiment || "").toLowerCase() === "positive"
    ).length;

    const customerScore =
      totalCalls > 0 ? Number(((positiveCalls / totalCalls) * 5).toFixed(1)) : 0;

    return res.json({
      success: true,
      performance: {
        callAnswerRate,
        avgHandleTime,
        customerScore: `${customerScore}/5`
      }
    });
  } catch (err) {
    console.error("❌ Today's performance error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/me/alerts", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id);

    const { data: numbers = [], error: numbersError } = await supabase
      .from("client_numbers")
      .select("*")
      .eq("client_id", client.id);

    if (numbersError) throw numbersError;

    const creditsRemaining = Number(client.credits_remaining || 0);
    const lowCreditThreshold = 100;

    return res.json({
      success: true,
      alerts: {
        lowCredit: creditsRemaining <= lowCreditThreshold,
        creditsRemaining,
        lowCreditMessage:
          creditsRemaining <= lowCreditThreshold
            ? `Your credit is low. You have ${creditsRemaining} credits left. Please top up to avoid service interruption.`
            : null,

        hasNumber: numbers.length > 0,
        numberAdded: numbers.length > 0,
        numbers,
        numberMessage:
          numbers.length > 0
            ? `Your phone number ${numbers[0].telnyx_number} has been added successfully.`
            : null
      }
    });
  } catch (err) {
    console.error("❌ Alerts error:", err);
    return res.status(500).json({ error: err.message });
  }
});
// router.get("/me/live-calls", requireAuth, async (req, res) => {
//   try {
//     const client = await getClientByUserId(req.user.id, "id");

//     const { data: activeCalls = [], error } = await supabase
//       .from("active_calls")
//       .select("*")
//       .eq("client_id", client.id)
//       .eq("status", "active")
//       .order("started_at", { ascending: false });

//     if (error) throw error;

//     return res.json({
//       success: true,
//       queueCount: 0,
//       liveCalls: activeCalls.map((c) => ({
//         id: c.id,
//         callId: c.call_id,
//         caller: c.caller_phone || "Unknown caller",
//         number: c.caller_phone || "-",
//         businessNumber: c.business_number || "-",
//         duration: Math.floor(
//           (Date.now() - new Date(c.started_at).getTime()) / 1000
//         ),
//         status: c.status || "active",
//         intent: c.intent || "Live call",
//         sentiment: c.sentiment || "neutral",
//         transcript: Array.isArray(c.transcript) ? c.transcript : []
//       }))
//     });
//   } catch (err) {
//     console.error("❌ Live calls error:", err);
//     return res.status(500).json({ error: err.message });
//   }
// });


router.get("/me/live-calls", requireAuth, async (req, res) => {
  const client = await getClientByUserId(req.user.id, "id");

  const calls = [...liveCalls.values()].filter(
    c => c.clientId === client.id
  );

  res.json({
    success: true,
    activeCount: calls.length,
    liveCalls: calls
  });
});

router.get("/me/phone-setup", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id, "id");

    const { data: setup, error: setupError } = await supabase
      .from("client_phone_setup")
      .select("*")
      .eq("client_id", client.id)
      .maybeSingle();

    if (setupError) throw setupError;

    const { data: linkedNumber, error: linkedNumberError } = await supabase
      .from("client_numbers")
      .select("telnyx_number")
      .eq("client_id", client.id)
      .maybeSingle();

    if (linkedNumberError) throw linkedNumberError;

    return res.json({
      success: true,
      setup: {
        business_number: setup?.business_number || "",
        letconvo_number: linkedNumber?.telnyx_number || null,
        forwarding_enabled: setup?.forwarding_enabled || false,
        forwarding_verified: setup?.forwarding_verified || false,
        verified_at: setup?.verified_at || null,
        number_assigned: Boolean(linkedNumber?.telnyx_number)
      }
    });
  } catch (err) {
    console.error("❌ Get phone setup error:", err);
    return res.status(500).json({ error: err.message });
  }
});
router.post("/me/phone-setup/verify", requireAuth, async (req, res) => {
  try {
    const client = await getClientByUserId(req.user.id, "id");

    const { data: assignedNumber, error: numberError } = await supabase
      .from("client_numbers")
      .select("*")
      .eq("client_id", client.id)
      .maybeSingle();

    if (numberError) throw numberError;

    if (!assignedNumber?.telnyx_number) {
      return res.status(400).json({
        verified: false,
        message: "No LetConvo number assigned yet. Please contact admin."
      });
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: activeCall, error: activeError } = await supabase
      .from("active_calls")
      .select("*")
      .eq("client_id", client.id)
      .gte("started_at", tenMinutesAgo)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeError) throw activeError;

    const { data: recentLog, error: logError } = await supabase
      .from("retell_call_logs")
      .select("*")
      .eq("client_id", client.id)
      .gte("created_at", tenMinutesAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (logError) throw logError;

    if (!activeCall && !recentLog) {
      return res.status(400).json({
        verified: false,
        message:
          "No test call detected yet. Call your business number first, then click Verify."
      });
    }

    const { data: existingSetup, error: setupCheckError } = await supabase
      .from("client_phone_setup")
      .select("id")
      .eq("client_id", client.id)
      .maybeSingle();

    if (setupCheckError) throw setupCheckError;

    let setup;
    let setupError;

    if (existingSetup) {
      const result = await supabase
        .from("client_phone_setup")
        .update({
          letconvo_number: assignedNumber.telnyx_number,
          forwarding_verified: true,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("client_id", client.id)
        .select()
        .single();

      setup = result.data;
      setupError = result.error;
    } else {
      const result = await supabase
        .from("client_phone_setup")
        .insert({
          client_id: client.id,
          business_number: "",
          letconvo_number: assignedNumber.telnyx_number,
          forwarding_enabled: true,
          forwarding_verified: true,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      setup = result.data;
      setupError = result.error;
    }

    if (setupError) throw setupError;

    return res.json({
      verified: true,
      message: "Phone forwarding verified successfully",
      setup
    });
  } catch (err) {
    console.error("❌ Verify phone setup error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get(
  "/me/live-calls",
  requireAuth,
  async (req, res) => {
    try {
      const client =
        await getClientByUserId(
          req.user.id,
          "id"
        );

      // const calls =
      //   await getLiveCalls(
      //     client.id
      //   );

      return res.json({
        success: true,
        activeCount:
          calls.length,

        liveCalls: calls.map(
          (call) => ({
            ...call,

            duration:
              Math.floor(
                (Date.now() -
                  call.startedAt) /
                  1000
              )
          })
        )
      });
    } catch (err) {
      console.error(err);

      return res
        .status(500)
        .json({
          error:
            err.message
        });
    }
  }
);

import { liveCalls } from "../utils/liveCallsStore.js";

router.get("/me/live-calls", requireAuth, async (req, res) => {
  const client = await getClientByUserId(req.user.id, "id");

  const calls = [...liveCalls.values()].filter(
    c => c.clientId === client.id
  );

  res.json({
    success: true,
    activeCount: calls.length,
    liveCalls: calls
  });
});

router.get("/me/notifications", requireAuth, async (req, res) => {
  const client = await getClientByUserId(req.user.id, "id");

  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(50);

  res.json(data);
});

router.patch(
  "/me/notifications/:id/read",
  requireAuth,
  async (req, res) => {
    const { id } = req.params;

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);

    res.json({ success: true });
  }
);

router.get(
  "/me/notifications/unread-count",
  requireAuth,
  async (req, res) => {
    const client = await getClientByUserId(req.user.id, "id");

    const { count } = await supabase
      .from("notifications")
      .select("*", {
        count: "exact",
        head: true
      })
      .eq("client_id", client.id)
      .eq("is_read", false);

    res.json({ count });
  }
);

export default router;