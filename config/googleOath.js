import dotenv from "dotenv";
import { google } from "googleapis";
dotenv.config({ path: ".env" });

export const oauthClient = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);