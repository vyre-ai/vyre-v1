// /p/sign/<token>/...: what a person with no account reaches to sign a document (built-in signing, contract SIGN-CONTRACT-R33 section 3). The token in the path is the only credential.
//   GET  /p/sign/<token>/               the page shell: the same bytes for every token, so a mail scanner opening the link reads and changes nothing
//   GET  /p/sign/<token>/assets/<name>  the page's files
//   POST /p/sign/<token>/view           records the open, returns the session (JSON)
//   GET  /p/sign/<token>/doc            the PDF, for a live token only
//   POST /p/sign/<token>/sign|decline|copy
// A state change is only ever a POST with a JSON body the page built; there is no cookie to ride on. Every bad token (shape, unknown, used, expired, revoked) gets one byte-identical 404.
// The module decides what a token may do; this file shapes HTTP, limits tries per token and per address, and never lets an internal word or id leave.
import type http from "node:http";

export const REFUSAL = "This link is not valid. Ask the person who sent it for a new one.";
const REFUSAL_BODY = JSON.stringify({ error: { code: "link.invalid", message: REFUSAL } });
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ASSET = /^[A-Za-z0-9._-]{1,64}$/;
const BODY_MAX = 1024 * 1024;
const WINDOW_MS = 60_000;
const LIMITS = { token: 60, address: 150, tries: 20, acts: 12 };
const MAX_KEYS = 20_000;
const SHELL_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src blob: 'self'; font-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const DATA_CSP = "default-src 'none'; frame-ancestors 'none'";

export interface SignDeps {
  /** Runs one of the three public capabilities as the host. Rejects with the capability's error. */
  call(
    cap: "esign.signer_view" | "esign.signer_doc" | "esign.signer_act",
    input: Record<string, unknown>,
  ): Promise<unknown>;
  shell(): string;
  asset(name: string): { mime: string; bytes: Uint8Array } | null;
  now?: () => number;
}

/** Counts events per key in a sliding minute; memory is bounded. */
export class Window {
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;
  constructor(now: () => number) {
    this.now = now;
  }
  /** Records one event and says whether the key is still within `limit` for the window. */
  allow(key: string, limit: number): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < WINDOW_MS);
    list.push(t);
    this.hits.delete(key);
    this.hits.set(key, list);
    if (this.hits.size > MAX_KEYS) this.hits.delete(this.hits.keys().next().value as string);
    return list.length <= limit;
  }
  /** Looks without recording. */
  over(key: string, limit: number): boolean {
    const t = this.now();
    return (this.hits.get(key) ?? []).filter((x) => t - x < WINDOW_MS).length >= limit;
  }
}

function common(extra: Record<string, string | number> = {}): Record<string, string | number> {
  return {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    ...extra,
  };
}

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string | number> = {},
): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(
    status,
    common({
      "content-type": "application/json; charset=utf-8",
      "content-security-policy": DATA_CSP,
      "content-length": Buffer.byteLength(text),
      ...extra,
    }),
  );
  res.end(text);
}

function pageNotValid(res: http.ServerResponse): void {
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>This link is not valid</title><style>html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif}main{max-width:26rem;padding:2rem 1.25rem;text-align:center}h1{font-size:1.25rem}</style><body><main><h1>This link is not valid</h1><p>Ask the person who sent it for a new one.</p></main></body></html>`;
  res.writeHead(
    404,
    common({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": SHELL_CSP,
      "content-length": Buffer.byteLength(body),
    }),
  );
  res.end(body);
}

async function readJson(
  req: http.IncomingMessage,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; text: string }> {
  const type = String(req.headers["content-type"] ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (type !== "application/json") {
    req.resume();
    return { ok: false, status: 415, text: "This address takes a JSON request." };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > BODY_MAX) return { ok: false, status: 413, text: "That is too large." };
    chunks.push(c as Buffer);
  }
  if (size === 0) return { ok: true, body: {} };
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not an object");
    return { ok: true, body: v as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, text: "That request could not be read." };
  }
}

const codeOf = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;
const messageOf = (e: unknown): string | undefined => (e as { error?: { message?: string } } | null)?.error?.message;

export function createSignRoute(deps: SignDeps): {
  handle(req: http.IncomingMessage, res: http.ServerResponse, token: string, tail: string): void;
} {
  const now = deps.now ?? Date.now;
  const perToken = new Window(now);
  const perAddress = new Window(now);
  const refusals = new Window(now);
  const acts = new Window(now);
  /** tokens the module accepted, by when; bounded */
  const good = new Map<string, number>();
  const remember = (token: string): void => {
    good.delete(token);
    good.set(token, now());
    if (good.size > MAX_KEYS) good.delete(good.keys().next().value as string);
  };

  function visitorOf(req: http.IncomingMessage): { ip: string; ua: string } {
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    const ip = (first && first !== "" ? first : (req.socket.remoteAddress ?? "")).slice(0, 64);
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 300);
    return { ip, ua };
  }

  /** What a capability's rejection becomes on the wire: the one refusal, a plain sentence the signer can act on, or a calm "try again". Nothing internal. */
  function fromError(res: http.ServerResponse, e: unknown, ip: string): void {
    const code = codeOf(e);
    if (code === "auth.bad_credentials") {
      refusals.allow(ip, LIMITS.tries);
      json(res, 404, REFUSAL_BODY);
      return;
    }
    if (code === "validation.bad_input" || code === "validation.too_large") {
      json(res, 422, {
        error: { code: "validation.bad_input", message: messageOf(e) ?? "That did not work. Check it and try again." },
      });
      return;
    }
    if (code === "rate_limit.exceeded") {
      json(
        res,
        429,
        { error: { code: "rate_limit.exceeded", message: "Too many tries. Wait a minute and try again." } },
        { "retry-after": 60 },
      );
      return;
    }
    json(
      res,
      503,
      { error: { code: "unavailable", message: "This did not work just now. Try again in a minute." } },
      { "retry-after": 30 },
    );
  }

  return {
    handle(req, res, token, tail) {
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "OPTIONS") {
        res.writeHead(
          204,
          common({
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
            "access-control-max-age": 600,
            "content-length": 0,
          }),
        );
        res.end();
        return;
      }
      if (method !== "GET" && method !== "HEAD" && method !== "POST") {
        res.writeHead(405, common({ allow: "GET, HEAD, POST, OPTIONS", "content-length": 0 }));
        res.end();
        return;
      }
      const { ip, ua } = visitorOf(req);
      const rest = tail === "" ? "/" : tail;
      // a token the module has accepted lately is a real signer: their requests are counted against their own link only, never against the address's junk and guess buckets
      const known = (good.get(token) ?? 0) > now() - 3_600_000;
      const limited = (): boolean =>
        known
          ? !perToken.allow(token, LIMITS.token)
          : !perAddress.allow(ip, LIMITS.address) ||
            !perToken.allow(token, LIMITS.token) ||
            refusals.over(ip, LIMITS.tries);
      const tooMany = (): void =>
        json(
          res,
          429,
          { error: { code: "rate_limit.exceeded", message: "Too many tries. Wait a minute and try again." } },
          { "retry-after": 60 },
        );
      const html = rest === "/";
      if (!TOKEN.test(token)) {
        refusals.allow(ip, LIMITS.tries);
        if (!perAddress.allow(ip, LIMITS.address) || refusals.over(ip, LIMITS.tries * 3)) return tooMany();
        if (method === "GET" && html) return pageNotValid(res);
        return json(res, 404, REFUSAL_BODY);
      }
      if (limited()) return tooMany();
      // the page and its files: the same for every token, no state read
      if (method === "GET" || method === "HEAD") {
        if (html) {
          const body = deps.shell();
          res.writeHead(
            200,
            common({
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": SHELL_CSP,
              "content-length": Buffer.byteLength(body),
            }),
          );
          res.end(method === "HEAD" ? undefined : body);
          return;
        }
        // the raw segment against a strict pattern: nothing is decoded, so a malformed escape is just a name nothing has
        const asset = /^\/assets\/([A-Za-z0-9._-]{1,64})$/.exec(rest);
        if (asset) {
          const file = deps.asset(asset[1] as string);
          if (!file) return json(res, 404, REFUSAL_BODY);
          res.writeHead(
            200,
            common({
              "content-type": file.mime,
              "content-security-policy": DATA_CSP,
              "content-length": file.bytes.length,
              "cache-control": "public, max-age=300",
            }),
          );
          res.end(method === "HEAD" ? undefined : Buffer.from(file.bytes));
          return;
        }
        if (rest === "/doc" && method === "GET") {
          void deps.call("esign.signer_doc", { token, visitor: { ip, ua } }).then(
            (out) => {
              remember(token);
              const bytes = Buffer.from(String((out as { base64?: string }).base64 ?? ""), "base64");
              res.writeHead(
                200,
                common({
                  "content-type": "application/pdf",
                  "content-security-policy": DATA_CSP,
                  "content-disposition": 'inline; filename="document.pdf"',
                  "content-length": bytes.length,
                }),
              );
              res.end(bytes);
            },
            (e: unknown) => fromError(res, e, ip),
          );
          return;
        }
        return json(res, 404, REFUSAL_BODY);
      }
      // POST: view, sign, decline, copy
      const op = /^\/(view|sign|decline|copy)$/.exec(rest)?.[1];
      if (!op) return json(res, 404, REFUSAL_BODY);
      if ((op === "sign" || op === "decline") && !acts.allow(ip, LIMITS.acts)) return tooMany();
      void readJson(req).then(async (got) => {
        if (!got.ok) return json(res, got.status, { error: { code: "validation.bad_input", message: got.text } });
        try {
          const visitor = { ip, ua };
          if (op === "view") {
            const out = (await deps.call("esign.signer_view", { token, visitor })) as { session: unknown };
            remember(token);
            return json(res, 200, { data: out.session });
          }
          const out = (await deps.call("esign.signer_act", { token, visitor, op, body: got.body })) as {
            result: Record<string, unknown>;
          };
          if (op === "copy") {
            if (out.result.state === "done") {
              const bytes = Buffer.from(String(out.result.base64 ?? ""), "base64");
              res.writeHead(
                200,
                common({
                  "content-type": "application/pdf",
                  "content-security-policy": DATA_CSP,
                  "content-disposition": 'attachment; filename="signed.pdf"',
                  "content-length": bytes.length,
                }),
              );
              res.end(bytes);
              return;
            }
            return json(res, 202, { data: { state: "waiting" } });
          }
          remember(token);
          return json(res, 200, { data: out.result });
        } catch (e) {
          fromError(res, e, ip);
        }
      });
    },
  };
}
