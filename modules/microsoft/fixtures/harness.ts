// Test harness for the microsoft handlers: an in-memory database, a recording ctx, a scripted Graph (recorded responses matched by method and
// address) and a fake host seam. No socket is opened and no token or secret is real.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../../host/src/routes/errors.ts";
import { registry } from "../../../generated/registry.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { ensure, PERMISSIONS, setMsHost } from "../projections.ts";
import type { MsCtx, MsHost, Row } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const CONN = "con_ms1";
export const U = "https://graph.microsoft.com/v1.0/users/maya%40vyre.test";

export const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8")) as unknown;

export interface Reply { status?: number; body?: unknown; throws?: boolean }
export interface Req { method: string; url: string; headers: Record<string, string>; body: unknown }
export interface Called { cap: string; input: Record<string, unknown> }

export interface HarnessOptions {
  principal?: MsCtx["principal"];
  actingFor?: string;
  run?: string;
  /** the caller holds connectors.manage at manage level */
  admin?: boolean;
  /** the microsoft.auto_connect policy */
  autoConnect?: boolean;
  members?: { userId: string; email: string }[];
  /** application permissions the minted token carries */
  roles?: string[];
}

const b64u = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");

export function harness(opts: HarnessOptions = {}) {
  const emitted: { name: string; subject: string; payload: Record<string, unknown> }[] = [];
  const called: Called[] = [];
  const scheduled: { at: number; cap: string; input: Record<string, unknown> }[] = [];
  const requests: Req[] = [];
  const routes: { method: string; match: string | RegExp; reply: Reply | ((r: Req) => Reply) }[] = [];
  const ingests: Record<string, unknown>[] = [];
  const ingestState = { fail: false, deduped: new Set<string>() };
  const state = { mints: 0, mintFails: false, roles: opts.roles ?? PERMISSIONS };
  let clock = NOW;
  let seq = 0;

  const ctx: MsCtx = {
    space: "spc_mstest",
    principal: opts.principal ?? { kind: "person", id: "usr_maya01" },
    ...(opts.actingFor ? { actingFor: opts.actingFor } : {}),
    ...(opts.run ? { run: opts.run } : {}),
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
        return { messageId: `eml_${id}${++seq}`, deduped: ingestState.deduped.has(id), linked: "none" };
      }
      throw new Error(`unexpected capability ${cap}`);
    },
    authorize(action) {
      if (action.perm === "connectors.manage" && opts.admin !== true) return { effect: "deny", reason: "no_grant", decisionId: "dec_mstest01" };
      return { effect: "allow", reason: "ok", decisionId: "dec_mstest01" };
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
      return { status: 404, text: async () => JSON.stringify({ error: { code: "ResourceNotFound" } }) };
    },
    log: { info() {}, warn() {} },
    async schedule(at, cap, input) {
      scheduled.push({ at: Number(at), cap, input: input as Record<string, unknown> });
      return `sch_${scheduled.length}`;
    },
  };

  const host: MsHost = {
    async mintToken() {
      state.mints += 1;
      if (state.mintFails) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "invalid_client" });
      const token = `${b64u({ alg: "RS256" })}.${b64u({ roles: state.roles, n: state.mints })}.sig`;
      return { token, expiresAt: clock + 3_600_000 };
    },
    async memberEmails() { return opts.members ?? []; },
    async appRegistration(_c, handle) {
      if (handle === "#NotAnApp") throw fail("provider.auth_failed", ctx.trace.traceId, { message: "That Vault item is not an app registration." });
      return { clientId: "11111111-2222-3333-4444-555555555555", tenantId: "tenant-guid" };
    },
    async fileBytes(_c, fileId) { return { name: `${fileId}.txt`, mime: "text/plain", bytes: new TextEncoder().encode("file body") }; },
    async putBlob(_c, bytes) { return `blb_${bytes.byteLength}b`; },
    async download(_c, a) { return { blobId: "blb_download", size: 42, mime: a.mime ?? "application/octet-stream" }; },
    async upload(_c, a) { return { id: "up1", name: decodeURIComponent(/:\/([^/]+):\/content$/.exec(a.url)?.[1] ?? ""), size: 9 }; },
  };
  setMsHost(host);

  return {
    ctx, emitted, called, scheduled, requests, ingests, ingestState, state,
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

/** The connection as consent setup leaves it, without running setup. */
export function seedConsent(h: Harness, o: { members?: { email: string; userId: string; excluded?: boolean }[]; configured?: boolean } = {}): void {
  ensure(h.ctx);
  h.ctx.db.run(
    `INSERT INTO ms_config (id, "connectionId", "vaultItem", "tenantId", domain, "clientId", configured, "consentGiven", "policyConfirmed", "autoConnect", "lastVerifyAt", "nextRenewAt", updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "microsoft", CONN, "#Microsoft_App", "tenant-guid", "vyre.test", "11111111-2222-3333-4444-555555555555", o.configured === false ? 0 : 1, 1, 1, 1, null, null, NOW,
  );
  for (const m of o.members ?? [{ email: "maya@vyre.test", userId: "usr_maya01" }]) {
    h.ctx.db.run(`INSERT INTO ms_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, m.email, m.userId, 1, m.excluded ? 1 : 0, null, NOW);
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
