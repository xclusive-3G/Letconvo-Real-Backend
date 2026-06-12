import crypto from "crypto";
import { oauthClient } from "../config/googleOath.js";
import { supabase } from "../lib/supabase.js";
import { google } from "googleapis";
import express from "express";

const router = express.Router();

router.get("/auth/google/:userId", async (req, res) => {
    try {
        const state = crypto.randomUUID();

        await supabase
            .from("oauth_states")
            .insert({
                id: state,
                user_id: req.params.userId,
            });

        const url = oauthClient.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: [
                "https://www.googleapis.com/auth/calendar",
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

router.get(
    "/auth/google/callback",
    async (req, res) => {
        const { code, state } = req.query;

        const { data: oauthState, error } =
            await supabase
                .from("oauth_states")
                .select("*")
                .eq("id", state)
                .single();

        if (error || !oauthState) {
            return res.status(400).json({
                success: false,
                message: "Invalid OAuth state",
            });
        }

        const userId = oauthState.user_id;

        const { tokens } =
            await oauthClient.getToken(code);

        oauthClient.setCredentials(tokens);

        const oauth2 = google.oauth2({
            auth: oauthClient,
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

        res.redirect(
            "https://letconvo.live/settings?success=true"
        );
    }
);

export async function getUserCalendar(
    userId
) {
    const { data } = await supabase
        .from("calendar_integrations")
        .select("*")
        .eq("user_id", userId)
        .single();

    return data;
}

export async function createGoogleClient(
    userId
) {
    const integration =
        await getUserCalendar(userId);

    oauthClient.setCredentials({
        refresh_token:
            integration.refresh_token,
    });

    return google.calendar({
        version: "v3",
        auth: oauthClient,
    });
}

export async function checkAvailability(
    userId,
    start,
    end
) {
    const calendar =
        await createGoogleClient(userId);

    const response =
        await calendar.freebusy.query({
            requestBody: {
                timeMin: start,
                timeMax: end,

                items: [
                    {
                        id: "primary",
                    },
                ],
            },
        });

    const busy =
        response.data.calendars.primary.busy;

    return busy.length === 0;
}

export async function createAppointment(
    userId,
    appointment
) {
    const calendar =
        await createGoogleClient(userId);

    return calendar.events.insert({
        calendarId: "primary",

        requestBody: {
            summary:
                appointment.customerName,

            description:
                appointment.notes,

            start: {
                dateTime:
                    appointment.startTime,
            },

            end: {
                dateTime:
                    appointment.endTime,
            },
        },
    });
}

router.post(
    "/appointments/book",
    async (req, res) => {
        try {
            const {
                customerName,
                startTime,
                endTime,
            } = req.body;

            const userId = req.user.id;

            const available =
                await checkAvailability(
                    userId,
                    startTime,
                    endTime
                );

            if (!available) {
                return res.status(400).json({
                    success: false,
                    message: "Time slot unavailable",
                });
            }

            const event =
                await createAppointment(
                    userId,
                    {
                        customerName,
                        startTime,
                        endTime,
                    }
                );

            return res.json({
                success: true,
                event,
            });
        } catch (err) {
            console.error(err);

            return res.status(500).json({
                success: false,
            });
        }
    }
);


router.post(
    "/tools/check-availability",
    async (req, res) => {
        try {
            const {
                retell_agent_id,
                start_time,
                end_time,
            } = req.body;

            if (
                !retell_agent_id ||
                !start_time ||
                !end_time
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields",
                });
            }

            const { data: agent, error } =
                await supabase
                    .from("ai_agents")
                    .select("user_id")
                    .eq(
                        "retell_agent_id",
                        retell_agent_id
                    )
                    .single();

            if (error || !agent) {
                return res.status(404).json({
                    success: false,
                    message: "Agent not found",
                });
            }

            const available =
                await checkAvailability(
                    agent.user_id,
                    start_time,
                    end_time
                );

            return res.json({
                success: true,
                available,
            });
        } catch (error) {
            console.error(error);

            return res.status(500).json({
                success: false,
                message:
                    "Failed to check availability",
            });
        }
    }
);


router.post(
    "/tools/book-appointment",
    async (req, res) => {
        try {
            const {
                retell_agent_id,
                customer_name,
                customer_phone,
                start_time,
                end_time,
                notes,
            } = req.body;

            if (
                !retell_agent_id ||
                !customer_name ||
                !start_time ||
                !end_time
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields",
                });
            }

            const { data: agent, error } =
                await supabase
                    .from("ai_agents")
                    .select("user_id")
                    .eq(
                        "retell_agent_id",
                        retell_agent_id
                    )
                    .single();

            if (error || !agent) {
                return res.status(404).json({
                    success: false,
                    message: "Agent not found",
                });
            }

            const available =
                await checkAvailability(
                    agent.user_id,
                    start_time,
                    end_time
                );

            if (!available) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Requested time slot is unavailable",
                });
            }

            const event =
                await createAppointment(
                    agent.user_id,
                    {
                        customerName:
                            customer_name,

                        notes:
                            notes ||
                            `Phone: ${customer_phone || "N/A"}`,

                        startTime:
                            start_time,

                        endTime:
                            end_time,
                    }
                );

            return res.json({
                success: true,
                event_id:
                    event.data.id,

                meeting_link:
                    event.data.hangoutLink || null,
            });
        } catch (error) {
            console.error(error);

            return res.status(500).json({
                success: false,
                message:
                    "Failed to create appointment",
            });
        }
    }
);

export default router;