import axios from "axios";
import { env } from "../../config/config.js";

export async function sendMissedCallSms(to) {
  const text =
    "Sorry we missed your call. This is Bella, our assistant. We’ll call you shortly.";

  try {
    const response = await axios.post(
      "https://api.telnyx.com/v2/messages",
      {
        from: env.TELNYX_SMS_FROM,
        to,
        text
      },
      {
        headers: {
          Authorization: `Bearer ${env.TELNYX_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ SMS sent:", response.data);

    return response.data;

  } catch (error) {

    console.error(
      "❌ TELNYX SMS ERROR:",
      JSON.stringify(error.response?.data || error.message, null, 2)
    );

    throw error;
  }
}