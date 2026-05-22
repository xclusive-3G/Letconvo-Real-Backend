import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../.env")
});

console.log("ENV CHECK:", process.env.TELNYX_API_KEY);

const envSchema = z.object({
  PORT: z.string().default("5000"),
  NODE_ENV: z.string().default("development"),
  BASE_URL: z.string().default("http://localhost:5000"),

  TELNYX_API_KEY: z.string().min(1, "TELNYX_API_KEY is required"),
  TELNYX_SMS_FROM: z.string().min(1, "TELNYX_SMS_FROM is required"),
  TELNYX_FALLBACK_NUMBER: z.string().min(1, "TELNYX_FALLBACK_NUMBER is required"),

  RETELL_API_KEY: z.string().min(1, "RETELL_API_KEY is required"),
  RETELL_FROM_NUMBER: z.string().min(1, "RETELL_FROM_NUMBER is required"),

  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  CALLBACK_DELAY_MS: z.string().default("120000"),
  MAX_CALLBACK_ATTEMPTS: z.string().default("3"),
  CALLBACK_ALLOWED_START_HOUR: z.string().default("8"),
  CALLBACK_ALLOWED_END_HOUR: z.string().default("20"),
  DEFAULT_TIMEZONE: z.string().default("Africa/Lagos")
});

export const env = envSchema.parse(process.env);