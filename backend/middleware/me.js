import express from "express";
import { supabase } from "../../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";

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

        const { data: calls, error: callsError } = await supabase
            .from("retell_call_logs")
            .select("*")
            .eq("client_id", client.id)
            .order("created_at", { ascending: false });

        if (callsError) throw callsError;

        const today = new Date().toISOString().slice(0, 10);

        const callsToday = calls.filter((call) =>
            call.created_at?.startsWith(today)
        );

        const completedCalls = calls.filter((call) =>
            ["completed", "ended", "call_ended"].includes(
                String(call.call_status || "").toLowerCase()
            )
        );

        const missedCalls = calls.filter((call) =>
            ["missed", "not_connected", "dial_no_answer", "dial_busy", "dial_failed"].includes(
                String(call.call_status || call.disconnection_reason || "").toLowerCase()
            )
        );

        const startToday = new Date();
startToday.setHours(0, 0, 0, 0);

const startYesterday = new Date(startToday);
startYesterday.setDate(startYesterday.getDate() - 1);

const todayCalls = calls.filter((c) => {
  const d = new Date(c.created_at);
  return d >= startToday;
}).length;

const yesterdayCalls = calls.filter((c) => {
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

        const transferredCalls = calls.filter((call) =>
            String(call.call_status || "").toLowerCase() === "transferred" ||
            String(call.disconnection_reason || "").toLowerCase() === "call_transfer"
        );

        const totalDurationMs = calls.reduce(
            (sum, call) => sum + Number(call.duration_ms || 0),
            0
        );

        const avgDurationSeconds =
            calls.length > 0 ? Math.round(totalDurationMs / calls.length / 1000) : 0;

        const avgDuration =
            avgDurationSeconds >= 60
                ? `${Math.floor(avgDurationSeconds / 60)}:${String(avgDurationSeconds % 60).padStart(2, "0")}`
                : `${avgDurationSeconds}s`;

        const transferRate =
            calls.length > 0
                ? `${Math.round((transferredCalls.length / calls.length) * 100)}%`
                : "0%";

        const positiveCalls = calls.filter((call) =>
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

        const liveCalls = calls.filter(
            (c) => String(c.call_status || "").toLowerCase() === "in_progress"
        ).length;

        const weeklyData = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
            (day) => ({ day, calls: 0 })
        );

        calls.forEach((call) => {
            if (!call.created_at) return;
            const d = new Date(call.created_at);
            const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
            const row = weeklyData.find((x) => x.day === day);
            if (row) row.calls += 1;
        });

        return res.json({
            success: true,
            stats: {
                callsToday: callsToday.length,
                appointmentsBooked: 0,
                leadsQualified: completedCalls.length,
                missedCalls: missedCalls.length,
                liveCalls,
                totalCalls: calls.length,
                satisfactionScore,
                callsToday: todayCalls,
callsYesterday: yesterdayCalls,
callsChangePercent,
callsTrend,
                avgDuration,
                transferRate,
                creditsRemaining: client.credits_remaining,
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

        const { data: calls, error } = await supabase
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
        return res.status(500).json({ error: err.message });
    }
});

router.get("/me/analytics", requireAuth, async (req, res) => {
    try {
        const period = req.query.period || "week";
        const now = new Date();
        const startDate = new Date();

        if (period === "day") startDate.setHours(0, 0, 0, 0);
        else if (period === "week") startDate.setDate(now.getDate() - 7);
        else if (period === "month") startDate.setMonth(now.getMonth() - 1);

        const client = await getClientByUserId(req.user.id, "id");

        const { data: calls, error } = await supabase
            .from("retell_call_logs")
            .select("*")
            .eq("client_id", client.id)
            .gte("created_at", startDate.toISOString())
            .order("created_at", { ascending: false });

        if (error) throw error;

        const totalCalls = calls.length;

        const completed = calls.filter((c) =>
            ["completed", "ended", "call_ended"].includes(String(c.call_status || "").toLowerCase())
        ).length;

        const missed = calls.filter((c) =>
            ["missed", "dial_no_answer", "dial_busy", "dial_failed"].includes(
                String(c.disconnection_reason || c.call_status || "").toLowerCase()
            )
        ).length;

        const transferred = calls.filter(
            (c) => String(c.disconnection_reason || "").toLowerCase() === "call_transfer"
        ).length;

        const sentimentCounts = { positive: 0, neutral: 0, negative: 0, unknown: 0 };

        calls.forEach((call) => {
            const s = String(
                call.sentiment ||
                call.raw_payload?.call?.call_analysis?.user_sentiment ||
                call.raw_payload?.data?.call_analysis?.user_sentiment ||
                ""
            ).trim().toLowerCase();

            if (s === "positive") sentimentCounts.positive += 1;
            else if (s === "negative") sentimentCounts.negative += 1;
            else if (s === "neutral") sentimentCounts.neutral += 1;
            else sentimentCounts.unknown += 1;
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const yesterdayEnd = new Date(today);

        const todayCalls = calls.filter(c => {
            const d = new Date(c.created_at);
            return d >= today;
        }).length;

        const yesterdayCalls = calls.filter(c => {
            const d = new Date(c.created_at);
            return d >= yesterday && d < yesterdayEnd;
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



        const totalDurationMs = calls.reduce((sum, c) => sum + Number(c.duration_ms || 0), 0);
        const avgSec = totalCalls > 0 ? Math.round(totalDurationMs / totalCalls / 1000) : 0;

        const avgDuration =
            avgSec >= 60
                ? `${Math.floor(avgSec / 60)}:${String(avgSec % 60).padStart(2, "0")}`
                : `${avgSec}s`;

        const answeredRate = totalCalls > 0 ? Math.round((completed / totalCalls) * 100) : 0;
        const transferRate = totalCalls > 0 ? Math.round((transferred / totalCalls) * 100) : 0;

        const successfulCalls = calls.filter(
            (c) => c.raw_payload?.call?.call_analysis?.call_successful === true
        ).length;

        const firstCallResolution =
            totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 100) : 0;

        const normalizePhone = (phone) =>
            String(phone || "").replace(/\s+/g, "").replace(/[^\d+]/g, "");

        const callerCounts = {};
        calls.forEach((call) => {
            const phone = normalizePhone(call.caller_phone);
            if (!phone) return;
            callerCounts[phone] = (callerCounts[phone] || 0) + 1;
        });

        const uniqueCallerCount = Object.keys(callerCounts).length;
        const repeatCallerCount = Object.values(callerCounts).filter((count) => count > 1).length;
        const repeatCallerRate =
            uniqueCallerCount > 0 ? Math.round((repeatCallerCount / uniqueCallerCount) * 100) : 0;

        const repeatCallerCalls = Object.values(callerCounts).reduce(
            (sum, count) => sum + (count > 1 ? count : 0),
            0
        );

        const npsScore =
            totalCalls > 0
                ? Math.round(((sentimentCounts.positive - sentimentCounts.negative) / totalCalls) * 100)
                : 0;

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

        const hourlyData = ["8am", "9am", "10am", "11am", "12pm", "1pm", "2pm", "3pm", "4pm", "5pm"].map(
            (hour) => ({ hour, calls: 0 })
        );

        calls.forEach((call) => {
            if (!call.created_at) return;
            const h = new Date(call.created_at).getHours();
            const label = h === 0 ? "12am" : h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`;
            const row = hourlyData.find((x) => x.hour === label);
            if (row) row.calls += 1;
        });

        return res.json({
            success: true,
            period,
            analytics: {
                totalCalls,
                totalCalls,
                callsToday,
                callsYesterday,
                callsChangePercent,
                callsTrend,
                // ADD THESE
                callsToday,
                callsYesterday,
                callsChangePercent,

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
                    firstCallResolution: `${firstCallResolution}%`,
                    avgWaitTime: "0s",
                    transferRate: `${transferRate}%`,
                    bookingConversion: "0%",
                    repeatCallers: `${repeatCallerRate}%`,
                    repeatCallerCount,
                    repeatCallerCalls,
                    uniqueCallerCount,
                    npsScore
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

        const { error: settingsError } = await supabase
            .from("client_settings")
            .upsert(
                {
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
                },
                { onConflict: "client_id" }
            );

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

        const { data: calls, error: callsError } = await supabase
            .from("retell_call_logs")
            .select("duration_minutes, call_cost, created_at")
            .eq("client_id", client.id);

        if (callsError) throw callsError;

        const now = new Date();
        const thisMonth = calls.filter((c) => {
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
            //   balance: {
            //     dollarBalance: Number(client.credits_remaining || 0),
            //     monthlySpend: Number(monthlySpend.toFixed(2)),

            //     minutesRemaining,
            //     minutesUsed,
            //     minutesTotal,

            //     planName: plan?.name || "Starter",
            //     planSlug: plan?.slug || "starter",
            //     planPrice: Number(plan?.price_usd || 0),
            //     nextBillingDate: client.renewal_date || null,

            //     autoTopUp: client.auto_topup ?? false,
            //     autoTopUpThreshold: Number(client.auto_topup_threshold || 100),
            //     autoTopUpAmount: Number(client.auto_topup_amount || 50)
            //   }

            balance: {
                dollarBalance: Number(client.credits_remaining || 0),
                creditsRemaining: Number(client.credits_remaining || 0),

                minutesRemaining,
                minutesUsed,
                minutesTotal,

                planName: plan?.name || "Starter",
                planPrice: Number(plan?.price_usd || 0),
                nextBillingDate: client.renewal_date || null
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

        const { data, error } = await supabase
            .from("payment_methods")
            .select("*")
            .eq("client_id", client.id)
            .order("created_at", { ascending: false });

        if (error) throw error;

        const methods = (data || []).map((pm) => ({
            id: pm.id,
            type: pm.card_brand || "card",
            last4: pm.last4,
            expiry: `${String(pm.expiry_month).padStart(2, "0")}/${String(pm.expiry_year).slice(-2)}`,
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
        const { data: plans, error } = await supabase
            .from("plans")
            .select("*")
            .order("price_usd", { ascending: true });

        if (error) throw error;

        return res.json({
            success: true,
            plans: (plans || []).map((p) => ({
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

        const { data: calls, error } = await supabase
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

        const positiveCalls = calls.filter((c) =>
            String(c.sentiment || "").toLowerCase() === "positive"
        ).length;

        const customerScore =
            totalCalls > 0
                ? Number(((positiveCalls / totalCalls) * 5).toFixed(1))
                : 0;

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

        const { data: numbers, error: numbersError } = await supabase
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
                numbers: numbers || [],
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

export default router;