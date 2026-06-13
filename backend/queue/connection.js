import IORedis from "ioredis";
import { env } from "../config/config.js";

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

console.log("🔴 Redis URL (connection.js):", env.REDIS_URL);