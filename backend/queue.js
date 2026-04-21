import { Queue } from "bullmq";
import Redis from "ioredis";

const connection = new Redis({
  host: "redis-18739.crce262.us-east-1-1.ec2.cloud.redislabs.com",
  port: 18739,
  password: "B5Lwmliy1PHVCZvIHfXBMd1KTMPo5zVd",
  maxRetriesPerRequest: null,
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