// Test harness for the resend handlers: an in-memory database, a recording ctx, a scripted Resend (recorded responses matched by method and path,
// no socket is opened) and a fake host seam (the key is a made-up string, files are in memory). Every call the module makes to another capability is
// checked against that capability's frozen input schema, as the invoke pipeline would.
// The recorded bodies follow Resend's API documentation as of the recording (emails, domains, receiving). Live-account proof waits on the owner's
// accounts (lead ruling 15); until then these are the contract.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { API, setResendHost } from "../projections.ts";
import type { Json, ResendCtx, ResendHost } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const KEY = "re_test_key_not_a_real_key";

export const RECORDED = {
  sent: { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" },
  email: {
    object: "email", id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794", to: ["pat@acme.test"], from: "Hello <hello@mail.vyre.test>", created_at: "2025-10-09T08:53:20.000Z",
    subject: "Hello", html: "<p>Hi</p>", text: "Hi", bcc: [], cc: [], reply_to: [], last_event: "delivered",
  },
  domains: {
    object: "list",
    data: [
      { id: "d91cd9bd-1176-453e-8fc1-35364d380206", name: "mail.vyre.test", status: "verified", created_at: "2025-09-01T10:00:00.000Z", region: "us-east-1" },
      { id: "0f2a31c7-5c06-4a4a-8f0d-7d1b1b7f2f10", name: "send.other.test", status: "temporary_failure", created_at: "2025-09-02T10:00:00.000Z", region: "eu-west-1" },
      { id: "6c3b8e2e-9a4f-4c58-9b0e-0e8a1f5d9a77", name: "new.other.test", status: "not_started", created_at: "2025-09-03T10:00:00.000Z", region: "us-east-1" },
    ],
  },
  domain: {
    object: "domain", id: "d91cd9bd-1176-453e-8fc1-35364d380206", name: "mail.vyre.test", status: "pending", created_at: "2025-09-01T10:00:00.000Z", region: "us-east-1",
    records: [
      { record: "SPF", name: "send", type: "MX", ttl: "Auto", status: "verified", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
      { record: "SPF", name: "send", type: "TXT", ttl: "Auto", status: "verified", value: "v=spf1 include:amazonses.com ~all" },
      { record: "DKIM", name: "resend._domainkey", type: "TXT", ttl: "Auto", status: "pending", value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDsc0kTest" },
      { record: "Receiving", name: "inbound", type: "MX", ttl: "Auto", status: "not_started", value: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 },
    ],
  },
  domainVerified: {
    object: "domain", id: "d91cd9bd-1176-453e-8fc1-35364d380206", name: "mail.vyre.test", status: "verified", region: "us-east-1",
    records: [
      { record: "SPF", name: "send", type: "TXT", ttl: "Auto", status: "verified", value: "v=spf1 include:amazonses.com ~all" },
      { record: "DKIM", name: "resend._domainkey", type: "TXT", ttl: "Auto", status: "verified", value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDsc0kTest" },
      { record: "DMARC", name: "_dmarc", type: "TXT", ttl: "Auto", status: "failed", value: "v=DMARC1; p=none;" },
    ],
  },
  inbound: {
    object: "email", id: "e1b2c3d4-0000-4000-8000-000000000001", from: "Pat Lee <pat@acme.test>", to: ["Hello <hello@mail.vyre.test>"], subject: "Question about my case",
    text: "Can we talk Friday?", html: "<p>Can we talk Friday?</p>", message_id: "<CAFx123@mail.acme.test>", created_at: "2025-10-09T08:50:00.000Z",
    headers: { "In-Reply-To": "<prev@mail.vyre.test>", "X-Mailer": "Test" },
    attachments: [
      { id: "att-1", filename: "intake.pdf", content_type: "application/pdf", size: 2048, download_url: "https://inbound-cdn.resend.test/att-1?sig=abc" },
      { id: "att-2", filename: "photo.jpg", content_type: "image/jpeg", size: 4096 },
    ],
  },
  attachment: { id: "att-2", download_url: "https://inbound-cdn.resend.test/att-2?sig=def" },
} as const;

export interface Reply { status: number; body?: unknown; throws?: boolean }
export interface Seen { method: string; path: string; headers: Record<string, string>; body: Json | null }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }

export function harness() {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const requests: Seen[] = [];
  const downloads: { url: string; mime?: string }[] = [];
  const scripted = new Map<string, Reply[]>();
  const files = new Map<string, { name: string; mime: string; bytes: Uint8Array }>();
  let clock = NOW;
  let statusFails = false;
  let ingestId: string | undefined = "eml_inbound1";

  const host: ResendHost = {
    async secret(_ctx, handle) {
      if (handle !== "#Resend_Key") throw new Error(`unexpected secret ${handle}`);
      return KEY;
    },
    async fileBytes(_ctx, fileId) {
      const f = files.get(fileId);
      if (!f) throw fail("validation.not_found", "0".repeat(32));
      return f;
    },
    async download(_ctx, a) {
      downloads.push(a);
      return { blobId: `blb_${downloads.length}`, size: 1000 + downloads.length, mime: a.mime ?? "application/octet-stream" };
    },
  };
  setResendHost(host);

  const ctx: ResendCtx = {
    space: "spc_resend",
    principal: { kind: "service", id: "svc_engine01" },
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
      const misfit = contractErrors(cap, "in", body);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      if (cap === "mail.status_update") {
        if (statusFails) throw fail("internal.unavailable", ctx.trace.traceId);
        return { suppressed: body.status === "bounced" };
      }
      if (cap === "mail.ingest") return { messageId: ingestId, deduped: false, linked: "none" };
      throw new Error(`unexpected capability ${cap}`);
    },
    async http(url, init) {
      const method = init?.method ?? "GET";
      const path = url.startsWith(API) ? url.slice(API.length) : url;
      let body: Json | null = null;
      try { body = init?.body ? (JSON.parse(init.body) as Json) : null; } catch { body = null; }
      requests.push({ method, path, headers: init?.headers ?? {}, body });
      const queue = scripted.get(`${method} ${path}`);
      if (!queue || queue.length === 0) throw new Error(`unscripted request ${method} ${path}`);
      const reply = queue.length > 1 ? (queue.shift() as Reply) : (queue[0] as Reply);
      if (reply.throws) throw new Error("socket hang up");
      const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return { status: reply.status, text: async () => text };
    },
    log: { info() {}, warn() {} },
  };

  return {
    ctx, emitted, called, requests, downloads, files, host,
    /** Script what Resend answers to `METHOD /path`; several replies for the same request are answered in order, the last one repeatedly. */
    on(request: string, ...replies: Reply[]): void { scripted.set(request, replies); },
    advance(ms: number) { clock += ms; },
    failStatusUpdates(on: boolean) { statusFails = on; },
    ingestAnswers(id: string | undefined) { ingestId = id; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    sent(): Seen[] { return requests; },
  };
}

export type Harness = ReturnType<typeof harness>;

/** Errors of a value against the frozen contract of a capability (its input or output schema); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

/** The error code of a thrown HostError, or "" for anything else. */
export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}
