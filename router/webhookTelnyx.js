import express from "express";
const router = express.Router();

router.post("/webhooks/telnyx", async (req, res) => {
  const event = req.body;
  const eventType = event?.data?.event_type;
  const payload = event?.data?.payload;

  console.log("Telnyx event received:", eventType);

  switch (eventType) {
    case "call.initiated":
      console.log("Call initiated:", payload.call_control_id);
      break;

    case "call.answered":
      console.log("Call answered:", payload.call_control_id);
      // Example: respond with a speak command
      respondToCall(payload.call_control_id);
      break;

    case "call.hangup":
      console.log("Call hung up:", payload.call_control_id);
      break;

    case "call.speak.ended":
      console.log("Speak ended, hanging up...");
      hangUp(payload.call_control_id);
      break;

    default:
      console.log("Unhandled event type:", eventType);
  }

  // Always respond with 200 to acknowledge receipt
  res.sendStatus(200);
});

export default router;