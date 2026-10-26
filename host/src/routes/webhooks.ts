// Provider webhooks (P-L5_17): POST /hooks/<connector>[/<kind>] is the one way a provider's event enters a Space. There is no session: the provider's signature is the credential, and the
// connector module checks it (a host call `<connector>.accept_webhook`, which verifies, applies the five minute window where the provider signs a time, and records the event once).
// This route adds what only the edge can: it reads the raw body (the signature covers its exact bytes), refuses what is too large, and answers every refusal the same way so a caller learns
// nothing about which check failed.
//   401  not signed by the provider (no signature, wrong signature, stale time, no secret set up to check it with)
//   400  signed, but not an event of that provider
//   404  no such connector   405  not a POST   413  body over the limit
//   429  too many requests from one source (the same source rule as the signed-out forms: sourceOf), before the verifier or the Vault is touched: a flood costs the sender, not the Space.
//        Two budgets a minute: all requests, and requests that failed verification (a guesser burns the second one quickly, a provider retrying a real event never does).
import type http from "node:http";
import { makeError } from "./errors.ts";
import { sourceOf } from "../daemon/preauth.ts";

export const MAX_WEBHOOK_BYTES = 1024 * 1024;
const PATH = /^\/hooks\/([a-z][a-z0-9_-]*)(?:\/([a-z]+))?$/;
const TRACE = "0".repeat(32);

export interface WebhookAccept {
  headers: Readonly<Record<string, string | undefined>>;
  /** the raw body, exactly as it arrived */
  body: string;
  /** the address the provider called, as the Space told it (Twilio signs the URL) */
  url: string;
  kind?: string;
}

export interface WebhookBudget { perMinute: number; failuresPerMinute: number }
/** 600 a minute covers a busy Space's Twilio status callbacks from a handful of provider addresses; 20 failures a minute is more than any provider retry policy produces. */
export const DEFAULT_WEBHOOK_BUDGET: WebhookBudget = { perMinute: 600, failuresPerMinute: 20 };

export interface WebhookRouteDeps {
  budget?: WebhookBudget;
  now?: () => number;
  /** True when a connector of this name takes webhooks (a live module with a `<connector>.accept_webhook` host call). */
  has(connector: string): boolean;
  /** Runs the connector's host call; throws what the module throws. */
  accept(connector: string, a: WebhookAccept): Promise<unknown>;
  /** The address this Space is reached at, https://host, no trailing slash. */
  publicBase(): string | Promise<string>;
}

function send(res: http.ServerResponse, status: number, body: string, type = "application/json; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
}
const refuse = (res: http.ServerResponse, status: number, code: string, message: string): void =>
  send(res, status, JSON.stringify({ error: makeError(code as never, TRACE, { message }) }));

const codeOf = (e: unknown): string => String((e as { error?: { code?: unknown } } | null)?.error?.code ?? "");

async function readRaw(req: http.IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_WEBHOOK_BYTES) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** What the connector's output says to answer: Twilio's TwiML as XML, Zoom's URL check as its token pair, anything else a plain acknowledgement. */
function answer(out: unknown, a: WebhookAccept): { type: string; body: string } {
  const o = (out !== null && typeof out === "object" ? out : {}) as Record<string, unknown>;
  if (typeof o["twiml"] === "string") return { type: "text/xml; charset=utf-8", body: o["twiml"] };
  if (typeof o["encryptedToken"] === "string") {
    let plainToken = "";
    try { plainToken = String((JSON.parse(a.body) as { payload?: { plainToken?: unknown } }).payload?.plainToken ?? ""); } catch { /* the module already refused a body it could not read */ }
    return { type: "application/json; charset=utf-8", body: JSON.stringify({ plainToken, encryptedToken: o["encryptedToken"] }) };
  }
  return { type: "application/json; charset=utf-8", body: JSON.stringify({ accepted: true }) };
}

const WINDOW_MS = 60_000;
const MAX_SOURCES = 10_000;

/** Counts events per source over the last minute. Old sources are forgotten oldest first, so the table cannot grow without limit. */
function createWindow(now: () => number) {
  const hits = new Map<string, number[]>();
  const recent = (key: string): number[] => {
    const at = now();
    const list = (hits.get(key) ?? []).filter((t) => at - t < WINDOW_MS);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  return {
    count: (key: string): number => recent(key).length,
    add(key: string): void {
      const list = recent(key);
      list.push(now());
      hits.delete(key);
      hits.set(key, list);
      if (hits.size > MAX_SOURCES) hits.delete(hits.keys().next().value as string);
    },
  };
}

export function createWebhookRoute(deps: WebhookRouteDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  const budget = deps.budget ?? DEFAULT_WEBHOOK_BUDGET;
  const all = createWindow(deps.now ?? Date.now);
  const failed = createWindow(deps.now ?? Date.now);
  const tooMany = (res: http.ServerResponse): void => {
    res.setHeader("retry-after", "60");
    refuse(res, 429, "rate_limit.exceeded", "Too many requests from this address. Try again in a minute.");
  };

  async function serve(req: http.IncomingMessage, res: http.ServerResponse, connector: string, kind: string | undefined, search: string): Promise<void> {
    const source = sourceOf({ "x-vyre-remote": req.socket.remoteAddress ?? "", ...(typeof req.headers["x-forwarded-for"] === "string" ? { "x-forwarded-for": req.headers["x-forwarded-for"] } : {}) });
    if (all.count(source) >= budget.perMinute || failed.count(source) >= budget.failuresPerMinute) return tooMany(res);
    all.add(source);
    const body = await readRaw(req);
    if (body === null) return refuse(res, 413, "validation.too_large", "That request is too large.");
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;
    const url = `${(await deps.publicBase()).replace(/\/+$/, "")}/hooks/${connector}${kind ? `/${kind}` : ""}${search}`;
    const a: WebhookAccept = { headers, body, url, ...(kind ? { kind } : {}) };
    try {
      const out = await deps.accept(connector, a);
      const r = answer(out, a);
      send(res, 200, r.body, r.type);
    } catch (e) {
      const code = codeOf(e);
      if (code === "auth.bad_credentials" || code === "provider.auth_failed" || code.startsWith("validation.")) failed.add(source);
      if (code === "auth.bad_credentials" || code === "provider.auth_failed") return refuse(res, 401, "auth.bad_credentials", "That request was not signed by the provider.");
      if (code.startsWith("validation.")) return refuse(res, 400, "validation.bad_input", "That is not an event this connector takes.");
      refuse(res, 500, "internal.unexpected", "Something went wrong on our side.");
    }
  }

  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      const m = PATH.exec(url.pathname);
      if (!m || !deps.has(m[1] as string)) return false;
      if ((req.method ?? "GET").toUpperCase() !== "POST") { res.setHeader("allow", "POST"); refuse(res, 405, "validation.bad_input", "Webhooks are posted."); return true; }
      void serve(req, res, m[1] as string, m[2], url.search).catch(() => { if (!res.headersSent) refuse(res, 500, "internal.unexpected", "Something went wrong on our side."); else res.end(); });
      return true;
    },
  };
}
