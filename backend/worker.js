import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import { Worker } from "bullmq";
import { connection } from "./queue/connection.js";
import { processCallbackJob } from "./service/recovery.js";

console.log("✅ Worker running on missed-call-callbacks");

const callbackWorker = new Worker(
  "missed-call-callbacks",
  async (job) => {
    console.log("🚀 Worker picked job:", job.id);
    console.log("📦 Job data:", job.data);

    const result = await processCallbackJob(job.data.recoveryId);

    console.log("✅ Callback job processed:", result);
    return result;
  },
  {
    connection,
    concurrency: 5
  }
);

callbackWorker.on("completed", (job) => {
  console.log("✅ Callback job completed:", job.id);
});

callbackWorker.on("failed", (job, err) => {
  console.error("❌ Callback job failed:", err.message);
});

callbackWorker.on("error", (err) => {
  console.error("❌ Callback worker error:", err.message);
});