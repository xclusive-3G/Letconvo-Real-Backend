import dotenv from "dotenv";
import { google } from "googleapis";
dotenv.config({ path: ".env" });

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Shared client — only for generateAuthUrl(), which doesn't touch
// credentials. Anything that calls setCredentials() must use its own
// createOAuthClient() so businesses never share each other's tokens.
export const oauthClient = createOAuthClient();
