import { Queue } from "bullmq";
import { connection } from "./connection.js";

export const webhookQueue = new Queue("client-webhooks", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 30_000 },
    // Redis is a small free-tier DB: keep finished jobs only briefly. They
    // stay for up to a day so a repeated call event isn't queued twice.
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600, count: 200 }
  }
});
