import express from "express";
import axios from "axios";

const router = express.Router();

router.get("/calls/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;

    const response = await axios.get(
      "https://api.retellai.com/v2/list-calls",
      {
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY}`
        }
      }
    );

    // 🔥 THIS IS WHERE YOUR CODE GOES
    const callsForBusiness = response.data.calls.filter(call => {
      return call.metadata?.clientId === clientId;
    });

    res.json(callsForBusiness);

  } catch (err) {
    console.error("❌ Failed to fetch calls:", err);
    res.status(500).json({ error: "Failed to fetch calls" });
  }
});

export default router;