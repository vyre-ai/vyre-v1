// The host side of Vault fill for an agent computer (ARCH 6.11, P-L2_21). agentd (images/agent-computer/agentd/vault.ts) never stores a secret: when a tool is given `#Handle.field` it asks the
// host for that one field at that moment, POST <fillUrl> with `Authorization: Bearer <fillToken>` and {handle, field, computerId}. This is the other end.
//   configure   issueFill() makes a token for one computer, the agent that lives on it and the person it acts for. The host passes {fillUrl, fillToken} to agentd with `configure`; the token
//               is 48 hex characters (agentd needs at least 16), held here as a hash, and ends with revokeFill() when the computer is removed.
//   endpoint    serveFill() checks the token (401), checks the body names that same computer (403), asks the Vault source whether the agent acting for the person may use the item (the
//               vault.use capability through the invoke pipeline, which also writes the Vault audit row), logs the use here (ids only, never the value), and answers
//               200 {value, itemId}, 403 {code:"forbidden"} or 404 {code:"not_found"}.
// The Vault source is the engine session host's (host/src/seams/engine-session.ts): the same lookup the CLI engines use, so the label-vs-provider rule and the access check are the one
// implementation. This file mounts nothing: the daemon routes POST <fillUrl> to fillHttp().
import type { IncomingMessage, ServerResponse } from "node:http";

/** The result of asking the Vault for one handle, as host/src/seams/engine-session.ts answers it (structural, so the module imports nothing from the host). */
export type FillLookup =
  | { kind: "value"; itemId: string; value: string }
  | { kind: "unknown" }
  | { kind: "denied"; reason: string };

export interface FillSource {
  lookup(handle: string, who: { agentId: string; asker: string; where: "host" | "device" | "computer" }): Promise<FillLookup>;
}

/** What the host remembers about one use: who, what, where. Never the value. */
export interface FillUse { computerId: string; agentId: string; asker: string; handle: string; itemId: string; outcome: "filled" | "refused" | "missing"; at: number }

export interface FillServiceDeps {
  source: FillSource;
  /** Every use, filled or not. A failure to log never blocks a refusal, and never turns a refusal into a fill: a fill whose log cannot be written is not delivered. */
  log(use: FillUse): void | Promise<void>;
  now?: () => number;
}

export interface FillGrant { fillToken: string; revoke(): void }
export interface FillResponse { status: 200 | 400 | 401 | 403 | 404 | 503; body: Record<string, unknown> }

interface Holder { computerId: string; agentId: string; asker: string }

const HANDLE = /^[A-Za-z][A-Za-z0-9_]*$/;
const FIELD = /^[A-Za-z0-9_]+$/;

const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(text: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FillService {
  /** A token for one computer, held as a hash. Issuing again for the same computer ends the earlier token. */
  issue(h: Holder): Promise<FillGrant>;
  /** The endpoint, without the transport: header and parsed body in, status and body out. */
  serve(req: { authorization: string | undefined; body: unknown }): Promise<FillResponse>;
  /** How many computers hold a live token (tests). */
  live(): number;
}

export function createFillService(d: FillServiceDeps): FillService {
  const now = d.now ?? Date.now;
  const byHash = new Map<string, Holder>();
  const hashOf = new Map<string, string>();   // computerId -> hash

  return {
    async issue(h) {
      const token = hex(24);
      const hash = await sha256(token);
      const old = hashOf.get(h.computerId);
      if (old) byHash.delete(old);
      byHash.set(hash, h);
      hashOf.set(h.computerId, hash);
      return {
        fillToken: token,
        revoke() {
          if (hashOf.get(h.computerId) === hash) hashOf.delete(h.computerId);
          byHash.delete(hash);
        },
      };
    },

    async serve(req) {
      const m = /^Bearer (\S+)$/.exec(req.authorization ?? "");
      const holder = m ? byHash.get(await sha256(m[1]!)) : undefined;
      if (!holder) return { status: 401, body: { code: "unauthorized" } };
      const b = req.body as { handle?: unknown; field?: unknown; computerId?: unknown } | null;
      if (!b || typeof b.handle !== "string" || typeof b.field !== "string" || !HANDLE.test(b.handle) || !FIELD.test(b.field)) return { status: 400, body: { code: "bad_input" } };
      // A token is for one computer. A body that names another is a computer asking for what it was not given.
      if (typeof b.computerId !== "string" || b.computerId !== holder.computerId) return { status: 403, body: { code: "forbidden" } };

      const handle = `#${b.handle}.${b.field}`;
      const use = (outcome: FillUse["outcome"], itemId: string): FillUse => ({ computerId: holder.computerId, agentId: holder.agentId, asker: holder.asker, handle, itemId, outcome, at: now() });
      let found: FillLookup;
      try {
        found = await d.source.lookup(handle, { agentId: holder.agentId, asker: holder.asker, where: "computer" });
      } catch {
        return { status: 503, body: { code: "unavailable" } };   // never the original error: it may carry request text
      }
      if (found.kind === "denied") {
        await Promise.resolve(d.log(use("refused", handle))).catch(() => undefined);
        return { status: 403, body: { code: "forbidden" } };
      }
      if (found.kind === "unknown") {
        await Promise.resolve(d.log(use("missing", handle))).catch(() => undefined);
        return { status: 404, body: { code: "not_found" } };
      }
      try {
        await d.log(use("filled", found.itemId));
      } catch {
        return { status: 503, body: { code: "unavailable" } };   // the use could not be recorded, so the value is not handed out
      }
      return { status: 200, body: { value: found.value, itemId: found.itemId } };
    },

    live: () => byHash.size,
  };
}

/** Node transport for the daemon's route: POST with a small JSON body. Anything else is a 400 or 404 and nothing is read from the Vault. */
export function fillHttp(service: FillService): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const send = (r: FillResponse): void => {
      res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(r.body));
    };
    if (req.method !== "POST") { send({ status: 404, body: { code: "not_found" } }); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 4096) { send({ status: 400, body: { code: "bad_input" } }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      let body: unknown = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* a body that is not JSON is a 400 below */ }
      const auth = req.headers["authorization"];
      void service.serve({ authorization: typeof auth === "string" ? auth : undefined, body }).then(send, () => send({ status: 503, body: { code: "unavailable" } }));
    });
  };
}
