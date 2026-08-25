import dns from "node:dns";
import axios from "axios";

const FETCH_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_STORED_CHARS = 2000;

const PRIVATE_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // covers the 169.254.169.254 cloud-metadata endpoint
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
];

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(ip) {
  const target = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (target & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateAddress(address, family) {
  if (family === 4) return isPrivateIpv4(address);
  const lower = address.toLowerCase();
  // IPv6 loopback, unique-local (fc00::/7), and link-local (fe80::/10).
  return lower === "::1" || lower === "::" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

// Resolves the hostname and rejects anything pointing at a private/internal
// address (loopback, RFC1918 ranges, and the 169.254.169.254 cloud-metadata
// endpoint AWS/GCP/Azure all use) before any fetch happens — this is the
// classic SSRF vector for a server-side "fetch this URL" feature, and this
// backend runs on EC2 where that metadata endpoint returns real credentials.
// Note: this checks-then-fetches by hostname rather than pinning the exact
// resolved IP for the actual request, so it doesn't fully close a
// DNS-rebinding race — acceptable here since the URL comes from an
// authenticated signup, not an anonymous public endpoint, but worth
// hardening further (IP-pinned fetch with Host header) if this ever accepts
// untrusted input.
async function assertPublicHostname(hostname) {
  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length) {
    throw new Error(`Could not resolve ${hostname}`);
  }

  for (const { address, family } of addresses) {
    if (isPrivateAddress(address, family)) {
      throw new Error(`${hostname} resolves to a private address (${address}) — refusing to fetch`);
    }
  }
}

const ENTITY_MAP = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(str) {
  return str.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? match;
  });
}

function htmlToText(html) {
  const withoutNoise = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const withoutTags = withoutNoise.replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

// Fetches a client's business website and extracts plain-text content as
// reference material for hand-building their Retell agent prompt (see
// client_settings.website_info) — best-effort. Callers should treat any
// rejection as "couldn't get it this time" and move on; a slow/broken
// website should never block signup or corrupt existing data.
export async function fetchWebsiteInfo(url) {
  const parsed = new URL(url);

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  await assertPublicHostname(parsed.hostname);

  const response = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_RESPONSE_BYTES,
    maxRedirects: 3,
    responseType: "text",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LetconvoBot/1.0; +https://letconvo.live)" },
    validateStatus: (status) => status >= 200 && status < 400
  });

  const contentType = String(response.headers?.["content-type"] || "");
  if (contentType && !contentType.includes("html") && !contentType.includes("text")) {
    return null;
  }

  const text = htmlToText(response.data);
  return text ? text.slice(0, MAX_STORED_CHARS) : null;
}

// Fire-and-forget wrapper for call sites that shouldn't wait on (or fail
// because of) a slow/broken website — fetches, saves to client_settings,
// and swallows any error after logging it.
export async function populateWebsiteInfo(supabase, clientId, url) {
  try {
    const info = await fetchWebsiteInfo(url);

    if (!info) return;

    const { error } = await supabase
      .from("client_settings")
      .update({ website_info: info })
      .eq("client_id", clientId);

    if (error) throw error;

    console.log("✅ Website info populated for client", clientId, `(${info.length} chars)`);
  } catch (err) {
    console.warn("⚠️ Could not populate website info for client", clientId, ":", err.message);
  }
}
