// Per-business Retell knowledge base built from the business's website.
//
// At signup we discover the site's most useful pages and hand them to
// Retell's create-knowledge-base, which scrapes, chunks and indexes them
// (and re-scrapes daily via enable_auto_refresh). During a call the shared
// master agent retrieves from that business's knowledge base — attached per
// call by router/retellInboundWebhook.js through
// agent_override.retell_llm.knowledge_base_ids — so the AI can answer
// questions about services, prices, location, policies, etc. from the
// business's own site.
//
// Everything here is best-effort: a slow or broken website, or a Retell
// error, must never block signup or a live call.

import axios from "axios";
import { assertPublicHostname } from "./websiteInfo.js";

const RETELL_API = "https://api.retellai.com";
const MAX_PAGES = 15;
const FETCH_TIMEOUT_MS = 8000;
const MAX_FETCH_BYTES = 3 * 1024 * 1024;
const STATUS_CHECK_TIMEOUT_MS = 1500;

const retellAuth = () => ({ Authorization: `Bearer ${process.env.RETELL_API_KEY}` });

// Pages a caller is most likely to ask about come first when a site has
// more pages than we send.
const PRIORITY_WORDS = [
  "service", "pricing", "price", "rates", "menu", "treatment", "about", "faq",
  "question", "contact", "location", "hours", "book", "appointment", "team",
  "staff", "insurance", "policy", "policies", "product"
];

// Not useful as knowledge (or not scrapeable as a page).
const SKIP_PATH = /\.(jpe?g|png|gif|svg|webp|ico|pdf|zip|mp4|mp3|css|js|xml|json)$|\/(wp-admin|wp-json|wp-content|cart|checkout|account|login|signin|signup|register|feed|tag|author|privacy|terms|cookie)/i;

async function fetchText(url) {
  const parsed = new URL(url);
  await assertPublicHostname(parsed.hostname);
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_FETCH_BYTES,
    maxRedirects: 3,
    responseType: "text",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LetconvoBot/1.0; +https://letconvo.live)" },
    validateStatus: (s) => s >= 200 && s < 300
  });
  return String(res.data || "");
}

const bareHost = (host) => host.toLowerCase().replace(/^www\./, "");

function normalizePageUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (bareHost(u.hostname) !== bareHost(new URL(base).hostname)) return null;
    if (SKIP_PATH.test(u.pathname)) return null;
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "") || null;
  } catch {
    return null;
  }
}

const score = (url) => {
  const path = new URL(url).pathname.toLowerCase();
  const hits = PRIORITY_WORDS.filter((w) => path.includes(w)).length;
  const depth = path.split("/").filter(Boolean).length;
  return hits * 10 - depth;
};

async function urlsFromSitemap(origin) {
  const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
  let xml = await fetchText(`${origin}/sitemap.xml`).catch(() => "");
  if (!xml) {
    const robots = await fetchText(`${origin}/robots.txt`).catch(() => "");
    const declared = robots.match(/^\s*sitemap:\s*(\S+)/im)?.[1];
    if (declared) xml = await fetchText(declared).catch(() => "");
  }
  if (!xml) return [];

  // A sitemap index points at child sitemaps — read a few of them.
  if (/<sitemapindex/i.test(xml)) {
    const children = locs(xml).slice(0, 3);
    const nested = await Promise.all(children.map((c) => fetchText(c).catch(() => "")));
    return nested.flatMap(locs);
  }
  return locs(xml);
}

function urlsFromLinks(html, base) {
  return [...html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]);
}

/**
 * Up to MAX_PAGES same-site page URLs worth putting in the knowledge base,
 * homepage first, then the pages callers are most likely to ask about.
 */
export async function discoverSitePages(websiteUrl) {
  const home = new URL(websiteUrl);
  if (home.protocol !== "https:" && home.protocol !== "http:") {
    throw new Error(`Unsupported protocol: ${home.protocol}`);
  }
  // Refuse up front (the fetches below swallow their own errors, so they
  // can't be relied on to stop an internal URL from being passed along).
  await assertPublicHostname(home.hostname);
  const origin = home.origin;
  const homeUrl = normalizePageUrl(home.toString(), origin) || origin;

  let candidates = await urlsFromSitemap(origin).catch(() => []);
  if (candidates.length < 2) {
    const html = await fetchText(home.toString()).catch(() => "");
    candidates = candidates.concat(urlsFromLinks(html, home.toString()));
  }

  const unique = [...new Set(candidates.map((c) => normalizePageUrl(c, origin)).filter(Boolean))]
    .filter((u) => u !== homeUrl);
  unique.sort((a, b) => score(b) - score(a));

  return [homeUrl, ...unique].slice(0, MAX_PAGES);
}

/**
 * Builds (or rebuilds) the business's Retell knowledge base from its
 * website and stores its id/status on client_settings. Never throws.
 */
export async function buildClientKnowledgeBase(supabase, clientId, websiteUrl, businessName) {
  try {
    if (!websiteUrl) return null;

    const pages = await discoverSitePages(websiteUrl);

    const form = new FormData();
    // Retell requires < 40 chars.
    form.append("knowledge_base_name", `LC ${businessName || clientId}`.slice(0, 39));
    form.append("knowledge_base_urls", JSON.stringify(pages));
    form.append("enable_auto_refresh", "true");

    const res = await fetch(`${RETELL_API}/create-knowledge-base`, {
      method: "POST",
      headers: retellAuth(),
      body: form
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.knowledge_base_id) {
      throw new Error(`Retell create-knowledge-base ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    }

    const { data: previous } = await supabase
      .from("client_settings")
      .select("retell_knowledge_base_id")
      .eq("client_id", clientId)
      .maybeSingle();

    const { error } = await supabase
      .from("client_settings")
      .update({
        retell_knowledge_base_id: body.knowledge_base_id,
        retell_knowledge_base_status: body.status || "in_progress"
      })
      .eq("client_id", clientId);
    if (error) throw error;

    // Rebuilt for a new website — drop the old one so it stops refreshing.
    const oldId = previous?.retell_knowledge_base_id;
    if (oldId && oldId !== body.knowledge_base_id) {
      await fetch(`${RETELL_API}/delete-knowledge-base/${oldId}`, { method: "DELETE", headers: retellAuth() }).catch(() => {});
    }

    console.log(`📚 Retell knowledge base ${body.knowledge_base_id} created for client ${clientId} from ${pages.length} page(s)`);
    return body.knowledge_base_id;
  } catch (err) {
    console.warn("⚠️ Could not build Retell knowledge base for client", clientId, ":", err.message);
    return null;
  }
}

/**
 * The knowledge base id to attach to this business's call, or null.
 * Only returned once Retell reports it ready ("complete", or
 * "refreshing_in_progress" for a ready KB that's re-scraping), so a
 * half-built or failed KB is never sent as a call override (an invalid
 * override can make Retell reject the call). While still indexing, checks
 * Retell (bounded by a short timeout) and records the new status.
 */
const READY = new Set(["complete", "refreshing_in_progress"]);

export async function getReadyKnowledgeBaseId(supabase, clientId, settings) {
  const kbId = settings?.retell_knowledge_base_id;
  if (!kbId) return null;
  if (READY.has(settings.retell_knowledge_base_status)) return kbId;
  if (settings.retell_knowledge_base_status === "error") return null;

  try {
    const res = await fetch(`${RETELL_API}/get-knowledge-base/${kbId}`, {
      headers: retellAuth(),
      signal: AbortSignal.timeout(STATUS_CHECK_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const { status } = await res.json();
    if (status && status !== settings.retell_knowledge_base_status) {
      await supabase
        .from("client_settings")
        .update({ retell_knowledge_base_status: status })
        .eq("client_id", clientId);
    }
    return READY.has(status) ? kbId : null;
  } catch {
    return null;
  }
}
