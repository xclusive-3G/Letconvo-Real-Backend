import express from "express";
import { listRecoveries } from "../db.js";

const router = express.Router();

/**
 * Health check route
 */
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "Server is running"
  });
});

/**
 * Get all missed call recoveries
 */
router.get("/recoveries", async (req, res) => {
  try {
    const recoveries = await listRecoveries();

    res.json({
      success: true,
      count: recoveries.length,
      data: recoveries
    });
  } catch (error) {
    console.error("❌ Recoveries error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to load recoveries"
    });
  }
});

export default router;