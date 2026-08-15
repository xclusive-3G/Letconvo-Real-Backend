import dotenv from "dotenv";
dotenv.config();
import { Queue } from "bullmq";
import Redis from "ioredis";


const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

export const callQueue = new Queue("call-queue", {
  connection,
});

export const addCallJob = async (booking) => {
  await callQueue.add("call-user", booking, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  });
};

