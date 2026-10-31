// Which brand a web address or a name belongs to. Same table as the prototype's vault (TPLDOM, DOMKEY, BRANDKEY).

import { BRANDS } from "./brands.ts";
import { TOOL_FILES } from "./toolfiles.ts";

/** Brand keys whose mark lives under another name in BRANDS (the prototype's BRANDKEY). ghl has no mark and draws a letter. */
const MARK_KEY: Record<string, string | null> = { db: "postgresql", postgres: "postgresql", aws: "amazonwebservices" };

/** Brand keys the vault and the prototype use for a file in public/tools under another name. */
const TOOL_ALIAS: Record<string, string> = { ghl: "gohighlevel", highlevel: "gohighlevel" };

/** The file key in public/tools for a brand key, or null. A brand with an inline mark in BRANDS uses that instead. */
export function toolKey(brand: string): string | null {
  const k = TOOL_ALIAS[brand] ?? brand;
  return k in TOOL_FILES ? k : null;
}

/** Words that are also tool names but read as ordinary words in an item's name; they match only when they are the whole name. */
const COMMON_WORDS = new Set(["box", "close", "canvas", "circle", "bear", "buffer", "coda", "linear", "apple", "amazon", "front", "loom", "monday", "gusto", "ramp", "drata", "plaid", "gong", "rippling", "retool"]);

/** The key into BRANDS for a brand key, or null when the brand has no mark. */
export function markKey(brand: string): string | null {
  const k = brand in MARK_KEY ? MARK_KEY[brand] : brand;
  return k && k in BRANDS ? k : null;
}

const TPLDOM: Record<string, string> = {
  ghl: "gohighlevel.com", twilio: "twilio.com", stripe: "stripe.com", openai: "openai.com", anthropic: "anthropic.com", opencode: "opencode.ai", openrouter: "openrouter.ai", xai: "x.ai", grok: "grok.com", resend: "resend.com",
  slack: "slack.com", github: "github.com", supabase: "supabase.com", zoom: "zoom.us", meta: "facebook.com", airtable: "airtable.com", notion: "notion.so",
  calendly: "calendly.com", quickbooks: "quickbooks.intuit.com", lawmatics: "lawmatics.com", aws: "aws.amazon.com", cloudflare: "cloudflare.com", google: "google.com",
  postgres: "postgresql.org", claude: "claude.ai", clio: "clio.com", namecheap: "namecheap.com", sentry: "sentry.io",
};
const DOMKEY: Record<string, string> = { "googleapis.com": "google", "accounts.google.com": "google", "meta.com": "meta", "intuit.com": "quickbooks", "amazonaws.com": "aws", "postgresql.org": "db" };

const lastTwo = (d: string): string => d.split(".").slice(-2).join(".");

/** The brand key for a host name (www. ignored, subdomains match), or null. */
export function brandForDomain(host: string): string | null {
  const h = (host || "").toLowerCase().replace(/^www\./, "");
  if (!h) return null;
  for (const [k, d] of Object.entries(TPLDOM)) {
    if (h === d || h.endsWith("." + d) || h.endsWith("." + lastTwo(d)) || h === lastTwo(d)) return k === "postgres" ? "db" : k;
  }
  for (const [d, k] of Object.entries(DOMKEY)) if (h === d || h.endsWith("." + d)) return k;
  return null;
}

/** The brand key for a web address (with or without a scheme), or null. */
export function brandForUrl(url: string): string | null {
  try {
    return brandForDomain(new URL(/^https?:/i.test(url) ? url : "https://" + url).hostname);
  } catch {
    return null;
  }
}

/** The brand key for a display name like "Stripe webhooks" or "GoHighLevel": the first word that is a brand key or a brand's name, or null. */
export function brandForName(name: string): string | null {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const alias: Record<string, string> = { gohighlevel: "ghl", postgres: "db", postgresql: "db", google: "google", gmail: "gmail", codex: "openai", chatgpt: "openai", gemini: "googlegemini", local: "localmodel", ollama: "localmodel" };
  // a product named inside a bigger brand ("Google Gemini") takes the product's own mark
  if (words.includes("gemini")) return "googlegemini";
  for (const w of words) {
    const k = alias[w] ?? w;
    if (markKey(k) || k in MARK_KEY || k in TPLDOM) return k;
  }
  // an app that ships only as a file in public/tools: any word of the name, unless it is an ordinary word that is not the whole name
  for (const w of words) {
    const k = alias[w] ?? w;
    if (toolKey(k) && (!COMMON_WORDS.has(k) || words.length === 1)) return k;
  }
  return null;
}
