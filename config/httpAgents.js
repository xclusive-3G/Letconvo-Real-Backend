import https from "https";

// axios defaults to keepAlive: false, meaning every request pays a fresh
// TCP+TLS handshake to the target host. That's fine almost everywhere, but
// on the live-call transfer path (router/telnyxVoiceWebhook2.js ->
// service/telnyx.js) it eats directly into the ~1 second window Telnyx
// allows before it gives up on an unanswered inbound call. Reusing a
// persistent connection to api.telnyx.com across requests removes that
// handshake for every call after the first.
export const telnyxKeepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
