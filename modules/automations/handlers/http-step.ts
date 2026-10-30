// The HTTP request step's two capabilities (spec 2.12). A GET or HEAD is automations.http_read; anything else is automations.http_send, which the Gate can hold.
// The request goes through the shared public fetcher (scheme, credentials, host and every redirect are checked, the socket is bound to the checked addresses; at most 1 MB and 30 seconds).
// The key is a Vault handle. The host fills it for this one call through vault.fill, so the Vault's own access check decides who may use it. The value is put in one request header, then dropped;
// it is not in the input, the output or the error, and a response that echoes it is scrubbed before the step sees it.
import { lookup } from "node:dns/promises";
import { documentNetwork } from "../document-network.ts";
import { requestPublic } from "../public-fetch.ts";
import type { FetchDeps } from "../public-fetch.ts";
import { raise } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";

/** What the host gives this module to fill a Vault handle for one call. The ctx is the capability's own (the host checks it is the same call that asked). */
export interface HttpStepHost {
  fill(ctx: AutoCtx, handle: string): Promise<string>;
}

let host: HttpStepHost | null = null;
export function setHttpStepHost(next: HttpStepHost | null): void { host = next; }

type Row = Record<string, unknown>;
const READ = new Set(["GET", "HEAD"]);
const SEND = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY = 1_000_000;
const NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
/** Headers the step sets itself or that would change how the request is framed. */
const OWN = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "te", "keep-alive", "proxy-authorization", "proxy-connection", "trailer", "expect"]);
/** Response headers that carry a login or a session, never handed to a step. */
const HIDDEN_RESPONSE = /^(set-cookie|set-cookie2|authorization|proxy-authenticate|www-authenticate|x-api-key|x-auth-token)$/i;

async function lookupHost(h: string): Promise<string[]> {
  const rows = await lookup(h, { all: true, verbatim: true });
  return rows.map((r) => r.address);
}

const isRec = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

function headerValue(ctx: AutoCtx, name: string, value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") raise(ctx, "validation.bad_input", `The header ${name} must be text.`);
  const text = String(value);
  if (/[\r\n\0]/.test(text)) raise(ctx, "validation.bad_input", `The header ${name} has a line break in it.`);
  return text;
}

function buildUrl(ctx: AutoCtx, raw: unknown, query: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") raise(ctx, "validation.bad_input", "An HTTP request needs an address.");
  let url: URL;
  try { url = new URL(raw.trim()); } catch { raise(ctx, "validation.bad_input", "That address cannot be opened."); }
  if (isRec(query)) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) { for (const item of v) url.searchParams.append(k, String(item)); } else url.searchParams.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
  }
  return url.href;
}

/** Fill the key, build the one header it goes in, and report the value so the response can be scrubbed. */
async function authHeader(ctx: AutoCtx, auth: unknown): Promise<{ name: string; value: string; secret: string } | null> {
  if (auth === undefined || auth === null) return null;
  if (!isRec(auth)) raise(ctx, "validation.bad_input", "Auth must name a kind and a Vault handle.");
  const kind = auth["kind"];
  const handle = auth["handle"];
  if (kind !== "bearer" && kind !== "basic" && kind !== "header") raise(ctx, "validation.bad_input", "Auth kind is bearer, basic or header.");
  if (typeof handle !== "string" || !/^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/.test(handle)) raise(ctx, "validation.bad_input", "Auth needs a Vault handle such as #Acme_API.");
  if (!host) raise(ctx, "validation.precondition_failed", "This server cannot fill a Vault key for a request yet.");
  let secret: string;
  try { secret = await host.fill(ctx, handle); } catch (e) {
    if ((e as { error?: unknown } | null)?.error) throw e;   // the Vault's own refusal (no access, no such item) goes through as it is
    raise(ctx, "permission.no_grant", "The Vault did not give this request its key.");
  }
  if (secret === "") raise(ctx, "validation.precondition_failed", "The Vault item behind that handle is empty.");
  if (kind === "bearer") return { name: "authorization", value: `Bearer ${secret}`, secret };
  if (kind === "basic") {
    const user = typeof auth["username"] === "string" ? auth["username"] : "";
    if (user === "") raise(ctx, "validation.bad_input", "Basic auth needs a user name.");
    return { name: "authorization", value: `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`, secret };
  }
  const name = typeof auth["header"] === "string" ? auth["header"].trim() : "";
  if (!NAME.test(name) || OWN.has(name.toLowerCase())) raise(ctx, "validation.bad_input", "Auth header needs a valid header name.");
  return { name: name.toLowerCase(), value: secret, secret };
}

function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join("[hidden]");
  return out;
}

function parseBody(text: string, type: string): unknown {
  if (text === "") return null;
  if (/json/i.test(type) || /^\s*[[{]/.test(text)) {
    try { return JSON.parse(text) as unknown; } catch { /* not JSON after all: keep the text */ }
  }
  return text;
}

async function request(ctx: AutoCtx, input: Row, allowed: ReadonlySet<string>, key: string | undefined): Promise<unknown> {
  const method = typeof input["method"] === "string" ? input["method"].toUpperCase() : "";
  if (!allowed.has(method)) raise(ctx, "validation.bad_input", `This request needs a method from ${[...allowed].join(", ")}.`);
  const url = buildUrl(ctx, input["url"], input["query"]);
  const headers: Record<string, string> = {};
  if (input["headers"] !== undefined) {
    if (!isRec(input["headers"])) raise(ctx, "validation.bad_input", "Headers must be name and value pairs.");
    for (const [name, value] of Object.entries(input["headers"])) {
      if (!NAME.test(name)) raise(ctx, "validation.bad_input", `${name} is not a header name.`);
      if (OWN.has(name.toLowerCase())) raise(ctx, "validation.bad_input", `The header ${name} is set by the step.`);
      headers[name.toLowerCase()] = headerValue(ctx, name, value);
    }
  }
  let body: string | undefined;
  if (input["json"] !== undefined && input["json"] !== null) {
    body = JSON.stringify(input["json"]);
    if (!("content-type" in headers)) headers["content-type"] = "application/json";
  } else if (typeof input["text"] === "string" && input["text"] !== "") {
    body = input["text"];
    if (!("content-type" in headers)) headers["content-type"] = "text/plain; charset=utf-8";
  }
  if (body !== undefined && READ.has(method)) raise(ctx, "validation.bad_input", `${method} cannot carry a body.`);
  if (body !== undefined && Buffer.byteLength(body) > MAX_BODY) raise(ctx, "validation.too_large", "The request body is over 1 MB.");
  if (key && !READ.has(method)) headers["idempotency-key"] = key;
  const secrets: string[] = [];
  const auth = await authHeader(ctx, input["auth"]);
  if (auth) { headers[auth.name] = auth.value; secrets.push(auth.secret, auth.value); }
  const deps: FetchDeps = documentNetwork() ?? { fetch: globalThis.fetch, lookup: lookupHost };
  const result = await requestPublic({ method, url, headers, ...(body !== undefined ? { body } : {}) }, deps);
  if (!result.ok) {
    const code = result.reason === "The document is too large." ? "validation.too_large" : /not a public host|Only an https|cannot be opened|username or password/.test(result.reason) ? "validation.bad_input" : "provider.network";
    raise(ctx, code, scrub(result.reason, secrets));
  }
  const responseHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.headers)) if (!HIDDEN_RESPONSE.test(name)) responseHeaders[name] = scrub(value, secrets);
  const text = scrub(result.text, secrets);
  return { status: result.status, ok: result.status >= 200 && result.status < 300, headers: responseHeaders, body: parseBody(text, result.headers["content-type"] ?? "") };
}

export function httpRead(ctx: AutoCtx, input: Row): Promise<unknown> { return request(ctx, input, new Set(["GET", "HEAD"]), undefined); }

export function httpSend(ctx: AutoCtx, input: Row): Promise<unknown> {
  const key = typeof input["idempotencyKey"] === "string" ? input["idempotencyKey"] : undefined;
  return request(ctx, input, SEND, key);
}
