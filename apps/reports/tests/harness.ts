// Shared by the reports tests: a Space with its own Ed25519 key, a service on in-memory stores with a fake clock, and an outbound function that
// answers GitHub (the recorded response), the Vyre team's Space and the reporter Space's webhook, recording every call.

import { readFileSync } from "node:fs";
import { base64url, generateSigningKey, hmacHex, registerMessage, reportMessage, sha256hex, sign, utf8 } from "../src/crypto.ts";
import type { SigningKey } from "../src/crypto.ts";
import { createService, DEFAULT_LIMITS } from "../src/service.ts";
import type { Config, Req, Res } from "../src/service.ts";
import { MemoryDb, MemoryObjectStore } from "../src/store.ts";
import type { HttpLike } from "../src/github.ts";

export const NOW = 1_760_000_000_000;
export const ISSUE = JSON.parse(readFileSync(new URL("./fixtures/github-issue-created.json", import.meta.url), "utf8")) as Record<string, unknown>;
export const CLOSED = JSON.parse(readFileSync(new URL("./fixtures/github-issues-closed.json", import.meta.url), "utf8")) as Record<string, unknown>;
export const WEBHOOK_SECRET = "whsec_test";
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
export const TRACE_A = "0123456789abcdef0123456789abcdef";
export const TRACE_B = "fedcba9876543210fedcba9876543210";

export interface Call { url: string; method: string; headers: Record<string, string>; body: string }
export interface Space { spaceId: string; publicKey: string; key: SigningKey; webhook: string; sign(message: string): Promise<string> }

export async function makeSpace(spaceId = "spc_alpha1", webhook = "http://alpha.test/hooks/reports"): Promise<Space> {
  const key = await generateSigningKey();
  return { spaceId, publicKey: base64url(key.publicKey), key, webhook, sign: (m) => sign(key.key, m) };
}

export function bundle(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    context: { place: "Record page", itemId: "rec_abc" },
    traceIds: [TRACE_A, TRACE_B],
    events: [{ type: "record.updated", at: NOW - 5000, traceId: TRACE_A }, { type: "sync.conflict", at: NOW - 1000 }],
    versions: { app: "1.0.0", server: "1.0.0", device: "Mac, Safari 19" },
    errors: [{ code: "validation.version_conflict", message: "The record changed", at: NOW - 900, traceId: TRACE_B }],
    note: "The save button did nothing",
    ...over,
  };
}

export const reportBody = (reportId = "rpt_aaaaaaaa1", over: Record<string, unknown> = {}): Uint8Array => utf8(JSON.stringify({ reportId, bundle: bundle(), ...over }));

export async function world(over: { config?: Partial<Config>; limits?: Partial<Config["limits"]> } = {}) {
  let clock = NOW;
  let seq = 0;
  const state = {
    github: { status: 201, body: JSON.stringify(ISSUE) },
    team: { status: 200, body: JSON.stringify({ data: { record: { id: "rec_team1" } } }) },
    hook: { status: 200 },
  };
  const calls: Call[] = [];
  const outbound: HttpLike = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? "" });
    let r: { status: number; body: string };
    if (url.startsWith("https://api.github.com/")) r = state.github;
    else if (url.startsWith("https://team.vyre.test/")) r = state.team;
    else if (url.includes("/hooks/reports")) r = { status: state.hook.status, body: "{}" };
    else r = { status: 404, body: "" };
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => r.body };
  };
  const key = await generateSigningKey();
  const db = new MemoryDb();
  const objects = new MemoryObjectStore();
  const config: Config = {
    publicUrl: "https://reports.vyre.test",
    github: { repo: "vyre-ai/vyre", token: "ghp_test", webhookSecret: WEBHOOK_SECRET },
    team: { baseUrl: "https://team.vyre.test", token: "svc_team", recordType: "report" },
    limits: { ...DEFAULT_LIMITS, ...over.limits },
    allowInsecureWebhooks: true,
    ...over.config,
  };
  const svc = createService(config, {
    db, objects, outbound, now: () => clock, key,
    random: (n) => Uint8Array.from({ length: n }, () => (seq += 1) & 255),
  });

  const send = (req: Partial<Req> & { method: string; path: string }): Promise<Res> => svc.handle({ headers: {}, body: new Uint8Array(0), ip: "203.0.113.7", ...req });
  const json = (res: Res): { data?: Record<string, unknown>; error?: { code: string; message: string; details?: Record<string, unknown> } } => JSON.parse(typeof res.body === "string" ? res.body : new TextDecoder().decode(res.body));

  async function register(space: Space, o: { ip?: string; ts?: string; body?: Record<string, unknown>; current?: Space; bad?: boolean } = {}): Promise<Res> {
    const body = utf8(JSON.stringify({ spaceId: space.spaceId, publicKey: space.publicKey, webhook: space.webhook, ...o.body }));
    const ts = o.ts ?? String(clock);
    const msg = registerMessage(ts, await sha256hex(body));
    const headers: Record<string, string> = { "x-vyre-ts": ts, "x-vyre-sig": o.bad ? "A".repeat(86) : await space.sign(msg) };
    if (o.current) headers["x-vyre-sig-current"] = await o.current.sign(msg);
    return send({ method: "POST", path: "/v1/spaces", headers, body, ...(o.ip ? { ip: o.ip } : {}) });
  }

  /** A signed POST /v1/reports. `signWith` signs as another Space, `ts` sets the time header, `tamper` changes the body after signing. */
  async function report(space: Space, body: Uint8Array, o: { ip?: string; ts?: string; signWith?: Space; tamper?: boolean; noSig?: boolean; spaceHeader?: string } = {}): Promise<Res> {
    const ts = o.ts ?? String(clock);
    const sig = await (o.signWith ?? space).sign(reportMessage(ts, await sha256hex(body)));
    const headers: Record<string, string> = { "x-vyre-space": o.spaceHeader ?? space.spaceId, "x-vyre-ts": ts };
    if (!o.noSig) headers["x-vyre-sig"] = sig;
    return send({ method: "POST", path: "/v1/reports", headers, body: o.tamper ? utf8(new TextDecoder().decode(body) + " ") : body, ...(o.ip ? { ip: o.ip } : {}) });
  }

  async function githubHook(payload: unknown, o: { event?: string; secret?: string } = {}): Promise<Res> {
    const body = utf8(JSON.stringify(payload));
    return send({ method: "POST", path: "/v1/github/webhook", headers: { "x-github-event": o.event ?? "issues", "x-hub-signature-256": `sha256=${await hmacHex(o.secret ?? WEBHOOK_SECRET, body)}` }, body });
  }

  return {
    svc, db, objects, calls, state, config, key, send, json, register, report, githubHook,
    now: () => clock,
    advance(ms: number) { clock += ms; },
    callsTo(prefix: string): Call[] { return calls.filter((c) => c.url.startsWith(prefix)); },
  };
}

export type World = Awaited<ReturnType<typeof world>>;
