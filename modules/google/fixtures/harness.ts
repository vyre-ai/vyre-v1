// Test harness for the google handlers: an in-memory database, a recording ctx, a scripted Google (recorded responses matched by method
// and address) and a fake host seam. No socket is opened and no token or key is real.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../../host/src/routes/errors.ts";
import { registry } from "../../../generated/registry.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { ensure, setGoogleHost } from "../projections.ts";
import type { GoogleCtx, GoogleHost, Row } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const CONN = "con_google1";

export const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8")) as unknown;

export interface Reply { status?: number; body?: unknown; throws?: boolean }
export interface Req { method: string; url: string; headers: Record<string, string>; body: unknown }
export interface Called { cap: string; input: Record<string, unknown> }

export interface HarnessOptions {
  principal?: GoogleCtx["principal"];
  actingFor?: string;
  /** the caller holds connectors.manage at manage level */
  admin?: boolean;
  /** the google.auto_connect policy */
  autoConnect?: boolean;
  /** members the host reports, userId to email */
  members?: { userId: string; email: string }[];
}

export function harness(opts: HarnessOptions = {}) {
  const emitted: { name: string; subject: string; payload: Record<string, unknown> }[] = [];
  const called: Called[] = [];
  const scheduled: { at: number; cap: string; input: Record<string, unknown> }[] = [];
  const requests: Req[] = [];
  const routes: { method: string; match: string | RegExp; reply: Reply | ((r: Req) => Reply) }[] = [];
  const minted: { sub: string; scopes: string[] }[] = [];
  const refusedScopes = new Set<string>();
  const ingests: Record<string, unknown>[] = [];
  const ingestState = { fail: false, deduped: new Set<string>() };
  let clock = NOW;
  let tokenSeq = 0;
  let linkSeq = 0;

  const ctx: GoogleCtx = {
    space: "spc_googletest",
    principal: opts.principal ?? { kind: "person", id: "usr_maya01" },
    ...(opts.actingFor ? { actingFor: opts.actingFor } : {}),
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown> });
      return null;
    },
    async call(cap, input) {
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      if (cap === "settings.get") return { row: { key: body.key, value: opts.autoConnect ?? true } };
      if (cap === "connections.create") return { connection: { connectionId: CONN } };
      if (cap === "mail.auto_connect_members") {
        const n = (body.members as unknown[]).length;
        return { created: n, notified: n, skipped: 0 };
      }
      if (cap === "mail.ingest") {
        if (ingestState.fail) throw fail("validation.not_found", ctx.trace.traceId, { message: "Mailbox does not exist." });
        ingests.push(body);
        const id = String(body.providerId);
        return { messageId: `eml_${id}${++linkSeq}`, deduped: ingestState.deduped.has(id), linked: "none" };
      }
      throw new Error(`unexpected capability ${cap}`);
    },
    authorize(action) {
      if (action.perm === "connectors.manage" && opts.admin !== true) return { effect: "deny", reason: "no_grant", decisionId: "dec_googletest01" };
      return { effect: "allow", reason: "ok", decisionId: "dec_googletest01" };
    },
    async http(url, init) {
      const req: Req = { method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined };
      requests.push(req);
      for (let i = routes.length - 1; i >= 0; i--) {
        const r = routes[i]!;
        if (r.method !== req.method) continue;
        if (typeof r.match === "string" ? !url.startsWith(r.match) : !r.match.test(url)) continue;
        const reply = typeof r.reply === "function" ? r.reply(req) : r.reply;
        if (reply.throws) throw new TypeError("fetch failed");
        const status = reply.status ?? 200;
        const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
        return { status, text: async () => text };
      }
      return { status: 404, text: async () => JSON.stringify({ error: { code: 404, errors: [{ reason: "notFound" }] } }) };
    },
    log: { info() {}, warn() {} },
    async schedule(at, cap, input) {
      scheduled.push({ at: Number(at), cap, input: input as Record<string, unknown> });
      return `sch_${scheduled.length}`;
    },
  };

  const host: GoogleHost = {
    async mintToken(_c, a) {
      minted.push({ sub: a.sub, scopes: a.scopes });
      if (a.scopes.some((s) => refusedScopes.has(s))) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "unauthorized_client" });
      return { token: `tok-${a.sub}-${++tokenSeq}`, expiresAt: clock + 3_600_000 };
    },
    async memberEmails() { return opts.members ?? []; },
    async serviceAccount(_c, handle) {
      if (handle === "#NotAKey") throw fail("provider.auth_failed", ctx.trace.traceId, { message: "That Vault item is not a service account." });
      return { clientId: "1234567890", clientEmail: "vyre@project.iam.gserviceaccount.com" };
    },
    async fileBytes(_c, fileId) { return { name: `${fileId}.txt`, mime: "text/plain", bytes: new TextEncoder().encode("file body") }; },
    async putBlob(_c, bytes) { return `blb_${bytes.byteLength}b`; },
    async download(_c, a) { return { blobId: "blb_download", size: 42, mime: a.mime ?? "application/pdf" }; },
    async upload(_c, a) { return { id: "up1", name: String(a.metadata.name), mimeType: "text/plain" }; },
  };
  setGoogleHost(host);

  return {
    ctx, emitted, called, scheduled, requests, minted, ingests, refuseScope: (s: string) => refusedScopes.add(s), ingestState,
    on(method: string, match: string | RegExp, reply: Reply | ((r: Req) => Reply) = {}) { routes.push({ method, match, reply }); },
    advance(ms: number) { clock += ms; },
    rows(sql: string, ...args: unknown[]): Row[] { return ctx.db.all(sql, ...args) as Row[]; },
    named(name: string) { return emitted.filter((e) => e.name === name); },
    calls(cap: string) { return called.filter((c) => c.cap === cap); },
    hits(match: string | RegExp, method?: string) {
      return requests.filter((r) => (!method || r.method === method) && (typeof match === "string" ? r.url.startsWith(match) : match.test(r.url)));
    },
  };
}

export type Harness = ReturnType<typeof harness>;

/** The delegation as dwd.setup leaves it, without running setup: config, members and (optionally) the mapped caller. */
export function seedDelegation(h: Harness, o: { members?: { email: string; userId: string; excluded?: boolean }[]; configured?: boolean } = {}): void {
  ensure(h.ctx);
  h.ctx.db.run(
    `INSERT INTO google_config (id, "connectionId", "vaultItem", "adminEmail", domain, "clientId", "clientEmail", configured, "autoConnect", "lastProbeAt", "lastProbeOk", updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "google", CONN, "#Google_DWD", "admin@vyre.test", "vyre.test", "1234567890", "vyre@project.iam.gserviceaccount.com", o.configured === false ? 0 : 1, 1, null, null, NOW,
  );
  for (const m of o.members ?? [{ email: "maya@vyre.test", userId: "usr_maya01" }]) {
    h.ctx.db.run(`INSERT INTO google_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, m.email, m.userId, 1, m.excluded ? 1 : 0, null, NOW);
  }
}

/** Errors of a value against the frozen contract of a capability (its input or output schema); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");
export const act = { connectionId: CONN };
