// Test harness for the mailgun handlers: an in-memory database, a recording ctx, a scripted Mailgun (recorded responses matched by method and path, no
// socket is opened) and a fake host seam (the key is a made-up string, files and uploads are in memory). Every call the module makes to another capability is
// checked against that capability's frozen input schema, as the invoke pipeline would.
// The recorded bodies follow Mailgun's API documentation as of the recording (messages, events, v4 domains, routes, stored messages). Live-account proof waits
// on the owner's accounts (lead ruling 15); until then these are the contract.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { API, setMailgunHost } from "../projections.ts";
import type { MailgunCtx, MailgunHost } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const KEY = "key-test-not-a-real-key";
export const BASIC = `Basic ${Buffer.from(`api:${KEY}`).toString("base64")}`;
export const PUBLIC_URL = "https://space.example.test";

export const RECORDED = {
  sent: { id: "<20251009085320.1.ABCDEF0123456789@mail.vyre.test>", message: "Queued. Thank you." },
  events: {
    items: [
      { id: "ev-accepted", event: "accepted", timestamp: 1760000000.123, recipient: "pat@acme.test", message: { headers: { "message-id": "20251009085320.1.ABCDEF0123456789@mail.vyre.test" } } },
      { id: "ev-delivered", event: "delivered", timestamp: 1760000001.5, recipient: "Pat@Acme.test", message: { headers: { "message-id": "20251009085320.1.ABCDEF0123456789@mail.vyre.test" } } },
      { id: "ev-stored", event: "stored", timestamp: 1760000002, recipient: "pat@acme.test", message: { headers: { "message-id": "x" } } },
      { id: "ev-failed", event: "failed", timestamp: 1760000003, recipient: "gone@acme.test", severity: "permanent", message: { headers: { "message-id": "y" } } },
    ],
    paging: { next: "https://api.mailgun.net/v3/mail.vyre.test/events/W3siYiI6IjIwMjUifV0=?limit=100", previous: "https://api.mailgun.net/v3/mail.vyre.test/events/prev" },
  },
  eventsLast: { items: [], paging: { next: "https://api.mailgun.net/v3/mail.vyre.test/events/end" } },
  domains: {
    total_count: 3,
    items: [
      { name: "mail.vyre.test", state: "active", created_at: "Tue, 02 Sep 2025 10:00:00 GMT", web_scheme: "https" },
      { name: "send.other.test", state: "unverified", created_at: "Tue, 02 Sep 2025 11:00:00 GMT" },
      { name: "old.other.test", state: "disabled", created_at: "Tue, 02 Sep 2025 12:00:00 GMT" },
    ],
  },
  domain: {
    message: "Domain DNS records have been updated",
    domain: { name: "mail.vyre.test", state: "unverified", created_at: "Tue, 02 Sep 2025 10:00:00 GMT" },
    receiving_dns_records: [{ record_type: "MX", valid: "unknown", priority: "10", value: "mxa.mailgun.org" }, { record_type: "MX", valid: "unknown", priority: "10", value: "mxb.mailgun.org" }],
    sending_dns_records: [
      { record_type: "TXT", valid: "valid", name: "mail.vyre.test", value: "v=spf1 include:mailgun.org ~all" },
      { record_type: "TXT", valid: "unknown", name: "smtp._domainkey.mail.vyre.test", value: "k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCtest" },
      { record_type: "CNAME", valid: "valid", name: "email.mail.vyre.test", value: "mailgun.org" },
    ],
  },
  domainActive: {
    domain: { name: "mail.vyre.test", state: "active" },
    receiving_dns_records: [{ record_type: "MX", valid: "valid", priority: "10", value: "mxa.mailgun.org" }],
    sending_dns_records: [
      { record_type: "TXT", valid: "valid", name: "mail.vyre.test", value: "v=spf1 include:mailgun.org ~all" },
      { record_type: "TXT", valid: "valid", name: "smtp._domainkey.mail.vyre.test", value: "k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCtest" },
      { record_type: "TXT", valid: "invalid", name: "_dmarc.mail.vyre.test", value: "v=DMARC1; p=none" },
    ],
  },
  routes: {
    total_count: 2,
    items: [
      { id: "5f6e8c1a0b2d3e4f5a6b7c8d", expression: 'match_recipient("hello@mail.vyre.test")', actions: ['forward("https://space.example.test/hooks/mail/mailgun")', "store()", "stop()"], priority: 0, description: "hello@" },
      { id: "5f6e8c1a0b2d3e4f5a6b7c8e", expression: 'match_recipient(".*@old.vyre.test")', actions: ['forward("ops@vyre.test")'], priority: 10 },
    ],
  },
  routeCreated: {
    message: "Route has been created",
    route: { id: "6a7b8c9d0e1f2a3b4c5d6e7f", expression: 'match_recipient("support@mail.vyre.test")', actions: ['forward("https://space.example.test/hooks/mail/mailgun")', "store()", "stop()"], priority: 0, description: "Support" },
  },
  storedEvent: {
    items: [{ id: "ev-stored", event: "stored", timestamp: 1759999800, recipient: "hello@mail.vyre.test", storage: { url: "https://storage-us-west1.api.mailgun.net/v3/domains/mail.vyre.test/messages/KEY123", key: "KEY123" } }],
  },
  stored: {
    From: "Pat Lee <pat@acme.test>", To: "Hello <hello@mail.vyre.test>, lee@mail.vyre.test", Subject: "Question about my case", "body-plain": "Can we talk Friday?", "body-html": "<p>Can we talk Friday?</p>",
    "Message-Id": "<CAFx123@mail.acme.test>", "message-headers": [["Received", "from a"], ["Received", "from b"], ["In-Reply-To", "<prev@mail.vyre.test>"]],
    attachments: [{ url: "https://storage-us-west1.api.mailgun.net/v3/domains/mail.vyre.test/messages/KEY123/attachments/0", name: "intake.pdf", "content-type": "application/pdf", size: 2048 }, { name: "lost.bin", size: 1 }],
  },
} as const;

export interface Reply { status: number; body?: unknown; throws?: boolean }
export interface Seen { method: string; base: string; path: string; headers: Record<string, string>; form: [string, string][] | null }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Upload { url: string; fields: [string, string][]; files: { field: string; name: string; fileId: string }[] }

export function harness(o: { region?: "us" | "eu" } = {}) {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const requests: Seen[] = [];
  const uploads: Upload[] = [];
  const downloads: { url: string; mime?: string; auth?: boolean }[] = [];
  const scripted = new Map<string, Reply[]>();
  let clock = NOW;
  let statusFails = false;
  let uploadReply: { status: number; text: string } = { status: 200, text: JSON.stringify(RECORDED.sent) };
  let ingestId: string | undefined = "eml_inbound1";
  const region = o.region ?? "us";

  const host: MailgunHost = {
    async secret(_ctx, handle) {
      if (handle !== "#Mailgun_Key") throw new Error(`unexpected secret ${handle}`);
      return KEY;
    },
    async fileBytes() { throw fail("validation.not_found", "0".repeat(32)); },
    async download(_ctx, a) {
      downloads.push(a);
      return { blobId: `blb_${downloads.length}`, size: 1000 + downloads.length, mime: a.mime ?? "application/octet-stream" };
    },
    async upload(_ctx, a) {
      uploads.push(a);
      return uploadReply;
    },
    async publicUrl() { return `${PUBLIC_URL}/`; },
  };
  setMailgunHost(host);

  const ctx: MailgunCtx = {
    space: "spc_mailgun",
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
      if (cap === "settings.get") return { row: { key: body.key, value: region } };
      if (cap === "mail.status_update") {
        if (statusFails) throw fail("internal.unavailable", ctx.trace.traceId);
        return { suppressed: body.status === "bounced" };
      }
      if (cap === "contacts.apply_optout") return { suppressionId: "sup_1" };
      if (cap === "mail.ingest") return { messageId: ingestId, deduped: false, linked: "none" };
      throw new Error(`unexpected capability ${cap}`);
    },
    async http(url, init) {
      const method = init?.method ?? "GET";
      const base = url.startsWith(API.eu) ? API.eu : API.us;
      const path = url.slice(base.length);
      const headers = init?.headers ?? {};
      const form = init?.body !== undefined ? [...new URLSearchParams(init.body).entries()] : null;
      requests.push({ method, base, path, headers, form });
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
    ctx, emitted, called, requests, uploads, downloads, host,
    /** Script what Mailgun answers to `METHOD /path?query`; several replies for the same request are answered in order, the last one repeatedly. */
    on(request: string, ...replies: Reply[]): void { scripted.set(request, replies); },
    advance(ms: number) { clock += ms; },
    failStatusUpdates(on: boolean) { statusFails = on; },
    uploadAnswers(r: { status: number; text: string }) { uploadReply = r; },
    ingestAnswers(id: string | undefined) { ingestId = id; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
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
