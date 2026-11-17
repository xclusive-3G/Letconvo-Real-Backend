import crypto from "crypto";
import { oauthClient, createOAuthClient } from "../config/googleOath.js";
import { supabase } from "../config/supabase.js";
import { google } from "googleapis";
import express from "express";
import { backfillUpcomingBookings } from "../service/googleCalendar.js";


const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || "https://letconvo.live";

// Connecting a calendar is an explicit "yes, use my calendar", so switch
// "Google Calendar Sync" on for the business. Without this, sync stays at
// its default (off) and nothing would reach the calendar until the owner
// also found and saved the toggle.
async function enableCalendarSync(userId) {
    const { data: client } = await supabase
        .from("clients")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (!client) return null;

    const { data: settings } = await supabase
        .from("client_settings")
        .select("id")
        .eq("client_id", client.id)
        .maybeSingle();

    const { error } = settings
        ? await supabase
            .from("client_settings")
            .update({ calendar_sync: true })
            .eq("client_id", client.id)
        : await supabase
            .from("client_settings")
            .insert({ client_id: client.id, calendar_sync: true });

    if (error) {
        console.error("⚠️ Could not enable calendar_sync after connecting:", error.message);
    }
    return client.id;
}

router.get(
    "/auth/google/callback",
    async (req, res) => {
        const { code, state } = req.query;

        try {
            const { data: oauthState, error } =
                await supabase
                    .from("oauth_states")
                    .select("*")
                    .eq("id", state)
                    .single();

            if (error || !oauthState) {
                return res.redirect(
                    `${FRONTEND_URL}/dashboard?settings=error`
                );
            }

            const userId = oauthState.user_id;

            // Per-request client: setCredentials() on a shared client would
            // let two businesses connecting at once see each other's tokens.
            const authClient = createOAuthClient();

            const { tokens } =
                await authClient.getToken(code);

            authClient.setCredentials(tokens);

            const oauth2 = google.oauth2({
                auth: authClient,
                version: "v2",
            });

            const existing = await supabase
                .from("calendar_integrations")
                .select("refresh_token")
                .eq("user_id", userId)
                .single();

            const userInfo =
                await oauth2.userinfo.get();

            await supabase
                .from("calendar_integrations")
                .upsert(
                    {
                        user_id: userId,
                        provider: "google",
                        email: userInfo.data.email,
                        access_token: tokens.access_token,
                        refresh_token:
                            tokens.refresh_token ||
                            existing?.data?.refresh_token,
                        calendar_id: "primary",
                        connected: true,
                    },
                    {
                        onConflict: "user_id"
                    }
                );

            await supabase
                .from("oauth_states")
                .delete()
                .eq("id", state);

            const clientId = await enableCalendarSync(userId);

            // Put the business's already-booked upcoming appointments on the
            // calendar too. Fire-and-forget so the redirect isn't held up.
            if (clientId) {
                backfillUpcomingBookings(clientId).catch(() => {});
            }

            res.redirect(
                `${FRONTEND_URL}/dashboard?settings=success`
            );
        } catch (err) {
            console.error("Google Calendar OAuth callback failed:", err);
            res.redirect(
                `${FRONTEND_URL}/dashboard?settings=error`
            );
        }
    }
);

router.get("/auth/google/:userId", async (req, res) => {
    try {
        const { data: client, error: clientError } = await supabase
            .from("clients")
            .select("user_id")
            .eq("id", req.params.userId)
            .single();

        if (clientError || !client) {
            return res.status(404).json({
                success: false,
                message: "Client not found",
            });
        }

        const state = crypto.randomUUID();

        const { error: insertError } = await supabase
            .from("oauth_states")
            .insert({
                id: state,
                user_id: client.user_id,
            });

        if (insertError) {
            console.error("Failed to create oauth_states row:", insertError);
            return res.status(500).json({
                success: false,
                message: "Failed to start Google OAuth",
            });
        }

        const url = oauthClient.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: [
                "https://www.googleapis.com/auth/calendar.events",
                "https://www.googleapis.com/auth/calendar.freebusy",
                "https://www.googleapis.com/auth/userinfo.email",
            ],
            state,
        });

        res.redirect(url);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Failed to start Google OAuth",
        });
    }
});

// Booking <-> Google Calendar sync lives in service/googleCalendar.js and
// is wired into the real booking routes (book-appointment, /api/bookings,
// get-slots, update-booking, the dashboard appointment PATCH). The earlier
// /appointments/book and /tools/* endpoints that used to live here were
// never called by the Retell agent, depended on a non-existent ai_agents
// table, and never wrote to the bookings table, so they've been removed.

export default router;
