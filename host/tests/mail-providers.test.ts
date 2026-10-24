// P-H_03: the host half of the Resend and Mailgun backends, and the Gate rule that one approval covers one send.
//   seams   key / file / download / upload / public-address handlers against a fake Vault and a fake network: what leaves the host, what is refused, what is never read
//   boot    a vyred boot (seeded core Space, the real module loader) wires both hosts from the hostSeams the module impls export, so resend and mailgun answer real calls
//           (provider HTTP is a recorded fake under ctx.http) instead of "not set up on this server"
//   gate    the real invoke pipeline over the real registry: an agent's mail.send is held once, runs once approved, and its provider call is not held a second time
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { registry } from "../../generated/registry.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CommitBatch, CtxSeed, GateHook, Handler, InvokeResult } from "../src/invoke.ts";
import { HostError } from "../src/routes/errors.ts";
import type { FetchLike } from "../src/ctx/http.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { withGateNesting } from "../src/daemon/gate-nesting.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { createMailgunHost, createResendHost, formData } from "../src/seams/mail-providers.ts";
import type { MailProviderDeps } from "../src/seams/mail-providers.ts";
import { wireSeams } from "../src/seams/index.ts";
import type { SeamCtx, SeamFetch } from "../src/seams/ports.ts";

const TRACE = "d".repeat(32);
const NOW = 1_760_000_000_000;
const dec = new TextDecoder();
const code = (c: string) => (e: unknown): boolean => e instanceof HostError && e.error.code === c;

// ---- seams: a fake Vault and a fake network

interface Sent { url: string; method: string | undefined; headers: Record<string, string>; body: string | Uint8Array | undefined }

function world(o: { keys?: Record<string, string>; replies?: { status: number; body?: string; bytes?: Uint8Array }[]; publicUrl?: boolean } = {}) {
  const sent: Sent[] = [];
  const asked: string[] = [];
  const blobs: { space: string; size: number; mime: string }[] = [];
  const replies = o.replies ?? [];
  const fetch: SeamFetch = async (url, init) => {
    sent.push({ url, method: init?.method, headers: init?.headers ?? {}, body: init?.body });
    const r = replies.shift() ?? { status: 200, body: "{}" };
    return { status: r.status, text: async () => r.body ?? "", arrayBuffer: async () => (r.bytes ?? new TextEncoder().encode(r.body ?? "")).slice().buffer as ArrayBuffer };
  };
  const keys = o.keys ?? { "#Resend_Key": "re_live_key", "#Mailgun_Key": "key-mg-secret", "#Resend_Webhook_Secret": "whsec_abc", "#Mailgun_Signing_Key": "sign-xyz", "#Other_Item": "not-yours" };
  const deps: MailProviderDeps = {
    vault: { secret: async (handle) => { asked.push(handle); const v = keys[handle]; if (v === undefined) throw new Error("no such item"); return v; } },
    fetch,
    files: { read: async (_s, id) => ({ name: `${id}.pdf`, mime: "application/pdf", bytes: new TextEncoder().encode(`bytes of ${id}`) }) },
    blobs: { put: async (space, bytes, mime) => { blobs.push({ space, size: bytes.byteLength, mime }); return `blb_${bytes.byteLength}`; } },
    ...(o.publicUrl === false ? {} : { publicUrl: async () => "https://space.example.com" }),
  };
  const ctx: SeamCtx = { space: "spc_1", trace: { traceId: TRACE }, now: () => NOW, db: { all: () => [] } };
  return { sent, asked, blobs, deps, ctx };
}

test("mail-providers: resend reads only its own two Vault items, one at a time, and a missing key is an auth failure that never echoes a value", async () => {
  const w = world();
  const host = createResendHost(w.deps);
  assert.equal(await host.secret(w.ctx, "#Resend_Key"), "re_live_key");
  assert.equal(await host.secret(w.ctx, "#Resend_Webhook_Secret"), "whsec_abc");
  await assert.rejects(host.secret(w.ctx, "#Other_Item"), code("permission.no_grant"));
  await assert.rejects(host.secret(w.ctx, "#Mailgun_Key"), code("permission.no_grant"));
  assert.deepEqual(w.asked, ["#Resend_Key", "#Resend_Webhook_Secret"], "a refused handle never reaches the Vault");
  const empty = createResendHost(world({ keys: {} }).deps);
  await assert.rejects(empty.secret(w.ctx, "#Resend_Key"), (e: unknown) => e instanceof HostError && e.error.code === "provider.auth_failed" && !JSON.stringify(e.error).includes("re_live_key"));
});

test("mail-providers: resend attaches a Space file and downloads an inbound attachment into a blob without sending any key", async () => {
  const w = world({ replies: [{ status: 200, bytes: new TextEncoder().encode("PDFDATA") }] });
  const host = createResendHost(w.deps);
  const f = await host.fileBytes(w.ctx, "fil_1");
  assert.deepEqual([f.name, f.mime, dec.decode(f.bytes)], ["fil_1.pdf", "application/pdf", "bytes of fil_1"]);
  const blob = await host.download(w.ctx, { url: "https://inbound-cdn.resend.com/a/b.pdf?sig=1", mime: "application/pdf" });
  assert.deepEqual(blob, { blobId: "blb_7", size: 7, mime: "application/pdf" });
  assert.deepEqual(w.blobs, [{ space: "spc_1", size: 7, mime: "application/pdf" }]);
  assert.deepEqual(w.sent[0]!.headers, {}, "a presigned address needs no key and gets none");
  assert.deepEqual(w.asked, [], "the Vault was not asked");
});

test("mail-providers: resend refuses an address that is not https on a listed host, and a bad status maps to a provider error", async () => {
  const w = world({ replies: [{ status: 403 }, { status: 429 }, { status: 502 }] });
  const host = createResendHost(w.deps);
  for (const url of ["http://inbound-cdn.resend.com/a", "https://evil.example.com/a", "https://u:p@resend.com/a", "https://169.254.169.254/latest", "not a url"]) {
    await assert.rejects(host.download(w.ctx, { url }), (e: unknown) => e instanceof HostError && (e.error.code === "permission.no_grant" || e.error.code === "validation.bad_input"), url);
  }
  assert.equal(w.sent.length, 0, "nothing left the host");
  await assert.rejects(host.download(w.ctx, { url: "https://resend.com/x" }), code("provider.auth_failed"));
  await assert.rejects(host.download(w.ctx, { url: "https://resend.com/x" }), code("provider.rate_limited"));
  await assert.rejects(host.download(w.ctx, { url: "https://resend.com/x" }), code("provider.unavailable"));
});

test("mail-providers: mailgun download sends the key as Basic api:<key> to a Mailgun host only, and never to any other address", async () => {
  const w = world({ replies: [{ status: 200, bytes: new Uint8Array([1, 2, 3]) }] });
  const host = createMailgunHost(w.deps);
  const blob = await host.download(w.ctx, { url: "https://storage-us-east4.api.mailgun.net/v3/domains/vyre.test/messages/abc/attachments/0", mime: "image/png", auth: true });
  assert.deepEqual(blob, { blobId: "blb_3", size: 3, mime: "image/png" });
  assert.equal(w.sent[0]!.headers["authorization"], `Basic ${Buffer.from("api:key-mg-secret").toString("base64")}`);
  w.asked.length = 0;
  await assert.rejects(host.download(w.ctx, { url: "https://evil.example.com/x", auth: true }), code("permission.no_grant"));
  await assert.rejects(host.download(w.ctx, { url: "http://api.mailgun.net/x", auth: true }), code("permission.no_grant"));
  assert.deepEqual(w.asked, [], "a refused address never fetches the key");
  assert.equal(w.sent.length, 1);
});

test("mail-providers: mailgun upload posts one multipart form with the fields in order and each file's bytes, authenticated, to the region host", async () => {
  const w = world({ replies: [{ status: 200, body: '{"id":"<20251025.1@vyre.test>","message":"Queued. Thank you."}' }] });
  const host = createMailgunHost(w.deps);
  const out = await host.upload(w.ctx, {
    url: "https://api.eu.mailgun.net/v3/vyre.test/messages",
    fields: [["from", "Maya <maya@vyre.test>"], ["to", "a@x.test"], ["to", "b@x.test"], ["subject", "Hi é"], ["o:tag", "t1"]],
    files: [{ field: "attachment", name: "Q3 \"final\".pdf", fileId: "fil_9" }],
  });
  assert.equal(out.status, 200);
  assert.match(out.text, /Queued/);
  const s = w.sent[0]!;
  assert.equal(s.url, "https://api.eu.mailgun.net/v3/vyre.test/messages");
  assert.equal(s.method, "POST");
  assert.equal(s.headers["authorization"], `Basic ${Buffer.from("api:key-mg-secret").toString("base64")}`);
  const boundary = /^multipart\/form-data; boundary=(vyre-[a-f0-9]{32})$/.exec(s.headers["content-type"] ?? "")?.[1];
  assert.ok(boundary, "multipart content type with a boundary");
  const body = dec.decode(s.body as Uint8Array);
  assert.ok(body.startsWith(`--${boundary}\r\n`) && body.endsWith(`--${boundary}--\r\n`));
  const names = [...body.matchAll(/form-data; name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["from", "to", "to", "subject", "o:tag", "attachment"]);
  assert.ok(body.includes('filename="Q3  final .pdf"'), "quotes cannot break out of the header");
  assert.ok(body.includes("Content-Type: application/pdf\r\n\r\nbytes of fil_9\r\n"));
  assert.ok(body.includes("Hi é"));
  assert.ok(!body.includes("key-mg-secret"), "the key is in the header, not the body");
});

test("mail-providers: mailgun upload refuses a non-Mailgun address before it reads the key or a file", async () => {
  const w = world();
  const host = createMailgunHost(w.deps);
  await assert.rejects(host.upload(w.ctx, { url: "https://evil.example.com/v3/x/messages", fields: [], files: [{ field: "attachment", name: "a", fileId: "fil_1" }] }), code("permission.no_grant"));
  assert.deepEqual(w.asked, []);
  assert.equal(w.sent.length, 0);
});

test("mail-providers: mailgun's public address is the Space's, and without one the call says so instead of pointing Mailgun at nothing", async () => {
  const host = createMailgunHost(world().deps);
  assert.equal(await host.publicUrl(world().ctx), "https://space.example.com");
  await assert.rejects(createMailgunHost(world({ publicUrl: false }).deps).publicUrl(world().ctx), code("internal.unavailable"));
});

test("mail-providers: formData keeps repeated fields and the file parts in order, and is closed by the final boundary", () => {
  const body = dec.decode(formData("B", [["to", "a"], ["to", "b"]], [{ field: "attachment", name: "n.txt", mime: "text/plain", bytes: new TextEncoder().encode("X") }]));
  assert.equal(body, '--B\r\nContent-Disposition: form-data; name="to"\r\n\r\na\r\n--B\r\nContent-Disposition: form-data; name="to"\r\n\r\nb\r\n--B\r\nContent-Disposition: form-data; name="attachment"; filename="n.txt"\r\nContent-Type: text/plain\r\n\r\nX\r\n--B--\r\n');
});

test("mail-providers: wireSeams registers both hosts, reports them, and takes them out again", () => {
  const w = world();
  const got: Record<string, unknown> = {};
  const wired = wireSeams(
    { setResendHost: (h) => { got["resend"] = h; }, setMailgunHost: (h) => { got["mailgun"] = h; } },
    { vault: { secret: w.deps.vault.secret, signRs256: async () => "" }, files: w.deps.files, blobs: w.deps.blobs, members: { emails: async () => [] }, space: "spc_1", fetch: w.deps.fetch },
  );
  assert.deepEqual(wired.state, { google: "absent", microsoft: "absent", imap: "absent", sources: "absent", resend: "wired", mailgun: "wired" });
  assert.ok(got["resend"] && got["mailgun"]);
  wired.unwire();
  assert.equal(got["resend"], null);
  assert.equal(got["mailgun"], null);
});

// ---- boot: a daemon whose provider calls reach a recorded fake

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-mailprov-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}
function machine(dir: string) {
  return fakePlatform({
    os: "linux", hostname: "mailprov-test", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  });
}
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined }
/** The two providers as recorded: what each endpoint answers. Anything else is a 404. */
function providers() {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers: init?.headers ?? {}, body: init?.body });
    const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) });
    if (method === "GET" && url === "https://api.resend.com/domains") {
      return reply(200, { data: [{ id: "dom_1", name: "mail.vyre.test", status: "verified", region: "us-east-1" }, { id: "dom_2", name: "send.other.test", status: "pending", region: "eu-west-1" }] });
    }
    if (method === "POST" && /^https:\/\/api(\.eu)?\.mailgun\.net\/v3\/routes$/.test(url)) {
      const f = new URLSearchParams(init?.body ?? "");
      return reply(200, { route: { id: "rt1", expression: f.get("expression"), priority: Number(f.get("priority")), actions: f.getAll("action") } });
    }
    return reply(404, { message: "not recorded" });
  };
  return { calls, fetch };
}

async function bootProviders(dir: string, p: ReturnType<typeof providers>, keys: Record<string, string>): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "space.example.com"], {}, "1.2.3"),
    platform: machine(dir), fetch: caddyFetch, http: p.fetch,
    vault: { secret: async (h) => { const v = keys[h]; if (v === undefined) throw new Error("no such item"); return v; }, signRs256: async () => "" },
    seams: {
      files: { read: () => Promise.reject(new Error("no files")) },
      blobs: { put: () => Promise.reject(new Error("no blobs")) },
      members: { emails: () => Promise.resolve([]) },
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000 },
  });
}
const post = (d: Daemon, p: string, body: unknown) => fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });

test("mail-providers boot: a plain boot wires resend and mailgun from the hostSeams the module impls export", async () => {
  const d = await bootProviders(seededDir(), providers(), { "#Resend_Key": "re_live_key", "#Mailgun_Key": "key-mg-secret" });
  try { assert.deepEqual([d.seams?.state.resend, d.seams?.state.mailgun], ["wired", "wired"]); } finally { await d.stop(); }
});

test("mail-providers boot: resend answers real calls with the Space key, not 'not set up'", async () => {
  const p = providers();
  const d = await bootProviders(seededDir(), p, { "#Resend_Key": "re_live_key" });
  try {
    const l = await post(d, "/v1/resend/domains/list", {});
    assert.equal(l.status, 200);
    const { data } = (await l.json()) as { data: { domains: { name: string; status: string }[] } };
    assert.deepEqual(data.domains.map((x) => [x.name, x.status]), [["mail.vyre.test", "verified"], ["send.other.test", "pending"]]);
    assert.ok(p.calls.length >= 1 && p.calls.every((c) => c.url.startsWith("https://api.resend.com/") && c.headers["authorization"] === "Bearer re_live_key"), "every call carries the Vault key");
  } finally { await d.stop(); }
});

test("mail-providers boot: mailgun answers real calls and points its inbound route at the Space's public address", async () => {
  const p = providers();
  const d = await bootProviders(seededDir(), p, { "#Mailgun_Key": "key-mg-secret" });
  try {
    const r = await post(d, "/v1/mailgun/routes/create", { expression: 'match_recipient("hello@vyre.test")', description: "inbound", idempotencyKey: "idem-route" });
    assert.equal(r.status, 200);
    const { data } = (await r.json()) as { data: { route: { routeId: string; forwardTo: string[] } } };
    assert.deepEqual([data.route.routeId, data.route.forwardTo], ["rt1", ["https://space.example.com/hooks/mail/mailgun"]]);
    const c = p.calls.find((x) => x.url.endsWith("/v3/routes"));
    assert.equal(c?.headers["authorization"], `Basic ${Buffer.from("api:key-mg-secret").toString("base64")}`);
  } finally { await d.stop(); }
});

test("mail-providers boot: with no key in the Vault both backends say the key is missing, not that the server has no backend", async () => {
  const d = await bootProviders(seededDir(), providers(), {});
  try {
    const r = await post(d, "/v1/resend/domains/list", {});
    assert.notEqual(r.status, 200);
    const body = (await r.json()) as { error: { code: string; message?: string } };
    assert.equal(body.error.code, "provider.auth_failed");
    assert.doesNotMatch(body.error.message ?? "", /not set up/);
  } finally { await d.stop(); }
});

// ---- gate: one approval, one send

const ALLOW = { effect: "allow", reason: "ok", steps: [], scope: undefined, obligations: [], decisionId: "dec_nesting01" } as const;
const PERSON: CtxSeed["principal"] = { kind: "person", id: "usr_maya01" };
const AGENT: CtxSeed["principal"] = { kind: "agent", id: "agt_scout01" };
const APPROVED = "approval-for-this-payload";
const SEND = { mailboxId: "mbx_hello", to: [{ address: "pat@acme.test" }], subject: "Hello", text: "Hi Pat", idempotencyKey: "idem-1" };

/** The real contract definitions, with the send's own resource binding kept. */
const capsOf = (...names: string[]): CapabilityDef[] => (registry.capabilities as unknown as CapabilityDef[]).filter((c) => names.includes(c.name));

/**
 * mail.send over the real pipeline. The Gate hook is the strictest reading of the contract: it asks for every call whose capability declares a Gate act, from anyone but an approved
 * payload, except that a person's own mail.send is never held. That is what turns a provider call nested in a cleared send into a second question without the wrapper.
 */
function sendStack(o: { nested: boolean; inner?: string[] }) {
  const parked: string[] = [];
  const ran: string[] = [];
  const raw: GateHook = {
    applies: (c, _i, seed) => (c.gate && c.gate.act !== "none" && !(c.name === "mail.send" && seed.principal.kind === "person") ? { act: c.gate.act } : null),
    park: async (a) => { parked.push(a.cap.name); return { taskId: `tsk_${parked.length}` }; },
    verify: (token, a) => token === APPROVED && a.cap.name === "mail.send",
  };
  const handlers: Record<string, Handler> = {
    "mail.send": async (ctx) => {
      for (const name of o.inner ?? ["resend.send_email"]) {
        await ctx.call(name as never, name === "resend.domains.delete" ? { providerDomainId: "dom_1", idempotencyKey: "idem-del" } : { from: "maya@vyre.test", to: ["pat@acme.test"], subject: "Hello", text: "Hi Pat", idempotencyKey: "idem-1" });
      }
      return { status: "sent" };
    },
    "resend.send_email": async () => { ran.push("resend.send_email"); return { providerId: "em_1" }; },
    "resend.domains.delete": async () => { ran.push("resend.domains.delete"); return { deleted: true }; },
  };
  const invoke = createInvoke({
    caps: indexCapabilities(capsOf("mail.send", "resend.send_email", "resend.domains.delete")),
    validateInput: () => [],
    authorize: () => ALLOW,
    handler: (name) => handlers[name],
    commit: async (b: CommitBatch) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    gate: o.nested ? withGateNesting(raw) : raw,
    now: () => NOW,
  });
  const as = (principal: CtxSeed["principal"], more: Partial<CtxSeed> = {}): CtxSeed => ({ space: "spc_nesting", principal, ...more });
  return { invoke, as, parked, ran };
}
const held = (r: InvokeResult): boolean => r.status === "held";

test("gate nesting: an agent's send is held once; once approved it sends, and its provider call is not held again", async () => {
  const s = sendStack({ nested: true });
  const first = await s.invoke("mail.send", SEND, s.as(AGENT));
  assert.equal(held(first), true);
  assert.deepEqual(s.parked, ["mail.send"], "exactly one hold, on the send");
  assert.deepEqual(s.ran, [], "nothing reached the provider before the approval");
  const second = await s.invoke("mail.send", SEND, s.as(AGENT, { approval: APPROVED }));
  assert.equal(second.status, "ok");
  assert.deepEqual(s.ran, ["resend.send_email"], "the provider was called once");
  assert.deepEqual(s.parked, ["mail.send"], "still exactly one hold in total");
});

test("gate nesting: without the wrapper the approved send is parked a second time at its provider call (the bug this packet closes)", async () => {
  const s = sendStack({ nested: false });
  await s.invoke("mail.send", SEND, s.as(AGENT));
  await assert.rejects(s.invoke("mail.send", SEND, s.as(AGENT, { approval: APPROVED })), code("permission.needs_approval"));
  assert.deepEqual(s.parked, ["mail.send", "resend.send_email"]);
  assert.deepEqual(s.ran, []);
});

test("gate nesting: a person's own send, which no Gate holds, is not held at its provider call either", async () => {
  const s = sendStack({ nested: true });
  const r = await s.invoke("mail.send", SEND, s.as(PERSON));
  assert.equal(r.status, "ok");
  assert.deepEqual(s.parked, []);
  assert.deepEqual(s.ran, ["resend.send_email"]);
});

test("gate nesting: a provider call that no cleared send stands behind is still held, for an agent calling it directly", async () => {
  const s = sendStack({ nested: true });
  const r = await s.invoke("resend.send_email", { from: "maya@vyre.test", to: ["pat@acme.test"], subject: "Hello", text: "Hi", idempotencyKey: "idem-2" }, s.as(AGENT));
  assert.equal(held(r), true);
  assert.deepEqual(s.parked, ["resend.send_email"]);
  assert.deepEqual(s.ran, []);
});

test("gate nesting: an approval for a send does not cover a different act made inside it (deleting a domain is asked on its own)", async () => {
  const s = sendStack({ nested: true, inner: ["resend.send_email", "resend.domains.delete"] });
  await s.invoke("mail.send", SEND, s.as(AGENT));
  await assert.rejects(s.invoke("mail.send", SEND, s.as(AGENT, { approval: APPROVED })), code("permission.needs_approval"));
  assert.deepEqual(s.parked, ["mail.send", "resend.domains.delete"]);
  assert.deepEqual(s.ran, ["resend.send_email"], "the send went out; the delete did not");
});

test("gate nesting: a caller cannot hand itself a cleared act through the call seed's approval", async () => {
  const s = sendStack({ nested: true });
  const r = await s.invoke("resend.send_email", { from: "maya@vyre.test", to: ["pat@acme.test"], subject: "Hello", text: "Hi", idempotencyKey: "idem-3" }, s.as(AGENT, { approval: "forged" }));
  assert.equal(held(r), true);
  assert.deepEqual(s.ran, []);
});

// P-H_03 final run: each named test above shows its own ok line in the run on the last commit.
