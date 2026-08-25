import express from "express";
import { setOptOut } from "../db.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

router.post("/telnyx/messaging", async (req, res) => {
  res.sendStatus(200);

  try {
    const eventType = req.body?.data?.event_type;
    const payload = req.body?.data?.payload;

    logger.info("Telnyx messaging webhook", { eventType, payload });

    const text = payload?.text?.toString()?.trim()?.toUpperCase();
    const from = payload?.from?.phone_number || payload?.from;

    if (text === "STOP" && from) {
     await setOptOut(from);
      logger.warn(`Opt-out received from ${from}`);
    }
  } catch (error) {
    logger.error("Error handling Telnyx messaging webhook", error);
  }
});

export default router;