// @heavy docker
// Documenso against the real pinned container (ARCH 8.4, P-L8_HEAVY): the compose units and lock in images/documenso boot with a Postgres sidecar, and an envelope
// goes create, send, recipient signs, Documenso's own webhook, completed, signed PDF saved, all through the real provider and esign.hook.
// Without a Docker daemon or without VYRE_HEAVY_DOCKER=1 every test here is skipped with its reason, so a skip is visible in the run and never counts as a pass of the real thing.
// @reads /images/documenso/documenso.lock
// @reads /images/documenso/compose.yml

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { documenso } from "../handlers/documenso.ts";
import type { HttpFn } from "../handlers/documenso.ts";
import { harness, toBase64, fromBase64, dana } from "../fixtures/db.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const COMPOSE = path.join(REPO, "images/documenso/compose.yml");
const LOCK = path.join(REPO, "images/documenso/documenso.lock");

const dockerOn = process.env["VYRE_HEAVY_DOCKER"] === "1" && spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status === 0;
const skip = dockerOn ? false : "needs Docker and VYRE_HEAVY_DOCKER=1";

const run = `vdt${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-documenso-heavy-"));
const say = (...a: unknown[]): void => console.log("[documenso-heavy]", ...a);

function sh(cmd: string, args: string[], o: { timeout?: number; input?: string; allowFail?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: o.timeout ?? 60_000, ...(o.input !== undefined ? { input: o.input } : {}), maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 && !o.allowFail) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${out.slice(-4000)}`);
  return out;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

const state: { port: number; sinkPort: number; base: string; compose: string[] } = { port: 0, sinkPort: 0, base: "", compose: [] };

// The runner has no compose plugin: CI downloads the standalone binary and names it in VYRE_COMPOSE_BIN.
const composeBin = process.env["VYRE_COMPOSE_BIN"];

function dc(args: string[], o: { timeout?: number; input?: string; allowFail?: boolean } = {}): string {
  return composeBin ? sh(composeBin, [...state.compose, ...args], o) : sh("docker", ["compose", ...state.compose, ...args], o);
}

const SINK = `const net = require("node:net");
const http = require("node:http");
const captured = { mail: [], hooks: [] };
http.createServer((req, res) => {
  let b = "";
  req.on("data", (d) => { b += d; });
  req.on("end", () => {
    res.setHeader("connection", "close");
    if (req.method === "GET" && req.url === "/captured") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(captured)); return; }
    if (req.method === "POST") captured.hooks.push({ url: req.url, headers: req.headers, body: b, at: Date.now() });
    res.end("ok");
  });
}).listen(8080);
net.createServer((s) => {
  let buf = ""; let data = false; let msg = ""; let auth = "";
  s.write("220 sink ESMTP\\r\\n");
  const line = (l) => {
    if (data) { if (l === ".") { data = false; captured.mail.push({ text: msg, at: Date.now() }); msg = ""; s.write("250 queued\\r\\n"); } else msg += (l.startsWith("..") ? l.slice(1) : l) + "\\n"; return; }
    if (auth === "plain") { auth = ""; s.write("235 ok\\r\\n"); return; }
    if (auth === "user") { auth = "pass"; s.write("334 UGFzc3dvcmQ6\\r\\n"); return; }
    if (auth === "pass") { auth = ""; s.write("235 ok\\r\\n"); return; }
    const c = l.toUpperCase();
    if (c.startsWith("EHLO") || c.startsWith("HELO")) s.write("250-sink\\r\\n250 AUTH PLAIN LOGIN\\r\\n");
    else if (c.startsWith("AUTH PLAIN")) { if (l.length > 11) s.write("235 ok\\r\\n"); else { auth = "plain"; s.write("334 \\r\\n"); } }
    else if (c.startsWith("AUTH LOGIN")) { auth = "user"; s.write("334 VXNlcm5hbWU6\\r\\n"); }
    else if (c.startsWith("DATA")) { data = true; s.write("354 go\\r\\n"); }
    else if (c.startsWith("QUIT")) { s.write("221 bye\\r\\n"); s.end(); }
    else s.write("250 ok\\r\\n");
  };
  s.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\\r\\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); line(l); } });
  s.on("error", () => {});
}).listen(2525);
`;

test("setup: the pinned stack boots (Postgres sidecar, Documenso, a sink for mail and webhooks) and reports healthy", { skip }, async () => {
  state.port = await freePort();
  state.sinkPort = await freePort();
  state.base = `http://127.0.0.1:${state.port}`;
  fs.writeFileSync(path.join(tmp, "sink.js"), SINK);
  const rnd = (n: number): string => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))).toString("hex");
  fs.writeFileSync(path.join(tmp, "test.env"), [
    `DOCUMENSO_PORT=${state.port}`, `DOCUMENSO_PUBLIC_URL=${state.base}`, `DOCUMENSO_DB_PASSWORD=${rnd(12)}`, `DOCUMENSO_AUTH_SECRET=${rnd(24)}`,
    `DOCUMENSO_ENCRYPTION_KEY=${rnd(16)}`, `DOCUMENSO_ENCRYPTION_SECONDARY_KEY=${rnd(16)}`, `DOCUMENSO_SIGNING_PASSPHRASE=testpass`,
    "DOCUMENSO_SMTP_HOST=sink", "DOCUMENSO_SMTP_PORT=2525", "DOCUMENSO_SMTP_USERNAME=sink", "DOCUMENSO_SMTP_PASSWORD=sink", "DOCUMENSO_SMTP_FROM=sign@vyre.test", `SINK_PORT=${state.sinkPort}`, "",
  ].join("\n"));
  fs.writeFileSync(path.join(tmp, "override.yml"), `services:
  documenso:
    environment:
      NEXT_PUBLIC_DISABLE_SIGNUP: "false"
  sink:
    image: node:24-alpine
    command: ["node", "/sink/sink.js"]
    volumes:
      - ${tmp}:/sink:ro
    ports:
      - "127.0.0.1:\${SINK_PORT}:8080"
    networks:
      - documenso-edge
`);
  state.compose = ["-p", run, "--env-file", LOCK, "--env-file", path.join(tmp, "test.env"), "-f", COMPOSE, "-f", path.join(tmp, "override.yml")];
  say(dc(["config", "--images"]));
  try {
    say(dc(["up", "-d", "--wait", "--wait-timeout", "420"], { timeout: 600_000 }));
  } finally {
    say(dc(["ps", "-a"], { allowFail: true }));
    say(dc(["logs", "--tail", "60", "documenso"], { allowFail: true }));
  }
  const health = await fetch(`${state.base}/api/health`);
  assert.equal(health.status, 200);
  say("health", await health.text());
});

// ---- helpers for the flow ---------------------------------------------------------------------------------------------

/** A one page PDF Documenso will accept: valid objects and a real cross-reference table. */
function makePdf(): Uint8Array {
  const body = "BT /F1 18 Tf 72 700 Td (Retainer agreement) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

interface Reply { status: number; text: string; json: any; headers: Headers }   // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(pathName: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<Reply> {
  const res = await fetch(`${state.base}${pathName}`, {
    method: init.method ?? "GET", redirect: "manual", signal: AbortSignal.timeout(60_000),
    headers: { origin: state.base, ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json, headers: res.headers };
}

const flow: {
  cookie: string; teamId: number; userId: number; apiToken: string; hookSecret: string; webhookOk: boolean;
  envelopeId: string; ref: string; docId: number; recipients: { email: string; name: string; token: string; fieldIds: number[] }[];
} = { cookie: "", teamId: 0, userId: 0, apiToken: "", hookSecret: `whsec_${Math.random().toString(36).slice(2)}`, webhookOk: false, envelopeId: "", ref: "", docId: 0, recipients: [] };

const OWNER = { name: "Heavy Tester", email: "owner@vyre.test", password: "Heavy-Test-pass-1!" };
const psql = (q: string): string => dc(["exec", "-T", "documenso-db", "psql", "-U", "documenso", "-d", "documenso", "-tA", "-c", q], { allowFail: true }).trim();
const trpc = (name: string, input: unknown): Promise<Reply> => call(`/api/trpc/${name}`, { method: "POST", headers: { ...(flow.cookie ? { cookie: flow.cookie } : {}), ...(flow.teamId ? { "x-team-id": String(flow.teamId) } : {}) }, body: { json: input } });
const dataOf = (r: Reply): any => r.json?.result?.data?.json;   // eslint-disable-line @typescript-eslint/no-explicit-any
const cookiesOf = (h: Headers): string => h.getSetCookie().map((c) => c.split(";")[0]).join("; ");

// ---- the flow ------------------------------------------------------------------------------------------------------------

test("certificate: a self-signed signing certificate goes into the container", { skip }, async () => {
  const key = path.join(tmp, "key.pem");
  const crt = path.join(tmp, "crt.pem");
  const p12 = path.join(tmp, "cert.p12");
  sh("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "2", "-subj", "/CN=Vyre heavy test"]);
  sh("openssl", ["pkcs12", "-export", "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1", "-out", p12, "-inkey", key, "-in", crt, "-passout", "pass:testpass"]);
  fs.chmodSync(p12, 0o644);
  const id = dc(["ps", "-q", "documenso"]).trim();
  sh("docker", ["cp", p12, `${id}:/opt/documenso/cert.p12`]);
  let health = "";
  for (let i = 0; i < 20; i++) {
    health = await (await fetch(`${state.base}/api/health`)).text();
    if (/"certificate":\{"status":"ok"/.test(health)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  say("health after certificate", health);
  say("cert dir", dc(["exec", "-T", "documenso", "sh", "-c", "ls -ln /opt/documenso; id; env | grep -i SIGNING | sed s/PASSPHRASE=.*/PASSPHRASE=.../"], { allowFail: true }));
  say("logs", dc(["logs", "--tail", "25", "documenso"], { allowFail: true }));
  assert.match(health, /"certificate":\{"status":"ok"/, "the compose file points Documenso at the certificate volume");
});

test("account: sign up, verify, sign in, make an API token and a webhook to the sink", { skip }, async () => {
  const up = await call("/api/auth/email-password/signup", { method: "POST", headers: { origin: state.base }, body: OWNER });
  say("signup", up.status, up.text.slice(0, 300));
  if (up.status >= 300) say("logs after signup", dc(["logs", "--tail", "30", "documenso"], { allowFail: true }), "env", dc(["exec", "-T", "documenso", "sh", "-c", "env | grep -i SIGNUP"], { allowFail: true }));
  assert.ok(up.status < 300, "signup");
  psql(`update "User" set "emailVerified" = now() where email = '${OWNER.email}'`);
  flow.userId = Number(psql(`select id from "User" where email = '${OWNER.email}'`));
  flow.teamId = Number(psql(`select t.id from "Team" t join "Organisation" o on o.id = t."organisationId" where o."ownerUserId" = ${flow.userId} order by t.id limit 1`));
  say("ids", flow.userId, flow.teamId);
  const csrf = await call("/api/auth/csrf");
  say("csrf", csrf.status, csrf.text.slice(0, 200));
  const jar = cookiesOf(csrf.headers);
  const signin = await call("/api/auth/email-password/authorize", { method: "POST", headers: jar ? { cookie: jar } : {}, body: { email: OWNER.email, password: OWNER.password, csrfToken: csrf.json?.csrfToken ?? "" } });
  say("authorize", signin.status, signin.text.slice(0, 300), "cookies", cookiesOf(signin.headers).replace(/=[^;]+/g, "=..."));
  flow.cookie = [jar, cookiesOf(signin.headers)].filter(Boolean).join("; ");
  const tok = await trpc("apiToken.create", { tokenName: "vyre-heavy", teamId: flow.teamId, expirationDate: null });
  say("apiToken.create", tok.status, tok.text.slice(0, 400));
  flow.apiToken = String(dataOf(tok)?.token ?? "");
  assert.match(flow.apiToken, /^api_/, "an API token came back");
  const hook = await trpc("webhook.createWebhook", {
    webhookUrl: "http://sink:8080/hook", eventTriggers: ["DOCUMENT_OPENED", "DOCUMENT_SIGNED", "DOCUMENT_COMPLETED", "DOCUMENT_REJECTED", "DOCUMENT_CANCELLED"], secret: flow.hookSecret, enabled: true, teamId: flow.teamId,
  });
  say("webhook.createWebhook", hook.status, hook.text.slice(0, 400));
  flow.webhookOk = hook.status < 300;
  assert.ok(flow.webhookOk, "webhook created");
});

test("create and send: esign.send through the real provider makes the envelope with a signature field per signer and sends it to both", { skip }, async () => {
  const pdf = makePdf();
  const http: HttpFn = async (url, init) => {
    const res = await fetch(url, { method: init?.method ?? "GET", headers: init?.headers ?? {}, ...(init?.body !== undefined ? { body: init.body as BodyInit } : {}), signal: AbortSignal.timeout(120_000) });
    const path = new URL(url).pathname;
    if (init?.method === "POST" && /\/envelope\/(create|distribute)$/.test(path)) say(path, res.status, (await res.clone().text()).slice(0, 600));
    return res as never;
  };
  const provider = documenso({ baseUrl: state.base, apiToken: flow.apiToken, http });
  assert.deepEqual(await provider.health!(), { ok: true });
  const h = harness({ providers: { documenso: provider } });
  h.callee("files.read", () => ({ base64: toBase64(pdf), mime: "application/pdf", size: pdf.length, version: 1, truncated: false }));
  Object.assign(flow, { h, provider });
  const SIGNERS = [{ name: "Dana Whitfield", email: "dana@client.example" }, { name: "Sam Ortiz", email: "sam@client.example" }];
  const sent = await h.call("esign.send", { fileId: "fil_contract1", recordId: "rec_dana", signers: SIGNERS, idempotencyKey: "heavy-1" }, { ...dana, thread: "thr_1" });
  flow.envelopeId = sent.envelopeId;
  say("esign.send", JSON.stringify(sent));
  const row = h.rows("esign_envelope")[0]!;
  flow.ref = String(row.provider_ref);
  assert.match(flow.ref, /^envelope_/);
  assert.equal((await h.call("esign.status", { envelopeId: flow.envelopeId })).status, "sent");
  const status = await provider.status(flow.ref);
  assert.equal(status.state, "sent");
  assert.deepEqual(status.signers.map((x) => x.email).sort(), ["dana@client.example", "sam@client.example"]);
  const fields = psql(`select r.email || ':' || f.id || ':' || f.type from "Field" f join "Recipient" r on r.id = f."recipientId" order by r.email`).split("\n").filter(Boolean);
  say("fields", fields.join(" | "));
  flow.recipients = psql(`select r.email || '|' || r.token || '|' || f.id || '|' || r.name from "Recipient" r join "Field" f on f."recipientId" = r.id order by r.email`).split("\n").filter(Boolean).map((l) => {
    const [email, token, field, name] = l.split("|");
    return { email: email!, token: token!, fieldIds: [Number(field)], name: name! };
  });
  flow.docId = Number(psql(`select regexp_replace("secondaryId", '[^0-9]', '', 'g') from "Envelope" where id = '${flow.ref}'`));
  say("document", flow.docId, "recipients", flow.recipients.length);
  assert.equal(flow.recipients.length, 2, "one signature field per signer");
  assert.ok(flow.docId > 0);
});

test("sign: each signer signs through Documenso's own signing API, and Documenso posts its webhooks to the sink", { skip }, async () => {
  for (const r of flow.recipients) {
    const field = await trpc("field.signFieldWithToken", { token: r.token, fieldId: r.fieldIds[0], value: r.name, isBase64: false });
    say("sign field", r.email, field.status, field.text.slice(0, 300));
    assert.ok(field.status < 300, `field signed for ${r.email}`);
    const done = await trpc("recipient.completeDocumentWithToken", { token: r.token, documentId: flow.docId });
    say("complete", r.email, done.status, done.text.slice(0, 300));
    assert.ok(done.status < 300, `document completed for ${r.email}`);
  }
  let hooks: { url: string; headers: Record<string, string>; body: string }[] = [];
  for (let i = 0; i < 40; i++) {
    const cap = (await (await fetch(`http://127.0.0.1:${state.sinkPort}/captured`)).json()) as { hooks: typeof hooks };
    hooks = cap.hooks;
    if (hooks.some((x) => x.body.includes("DOCUMENT_COMPLETED"))) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (hooks.length === 0) say("why no webhooks", dc(["exec", "-T", "documenso", "sh", "-c", "sed -n 1,75p /app/apps/remix/build/server/hono/packages/lib/jobs/definitions/internal/execute-webhook.handler.js; grep -rhoE 'NEXT_PRIVATE_[A-Z_]*SSRF[A-Z_]*' /app/apps/remix/build/server | sort -u"], { allowFail: true }));
  const events = hooks.map((x) => (JSON.parse(x.body) as { event: string }).event);
  say("webhook events", events.join(","));
  assert.ok(events.includes("DOCUMENT_SIGNED"), "DOCUMENT_SIGNED arrived");
  assert.ok(events.includes("DOCUMENT_COMPLETED"), "DOCUMENT_COMPLETED arrived");
  assert.ok(hooks.every((x) => x.headers["x-documenso-secret"] === flow.hookSecret), "every webhook carries the shared secret");
  Object.assign(flow, { hooks });
});

test("completed: replaying Documenso's own webhooks through esign.hook saves the real signed PDF once and ends the envelope", { skip }, async () => {
  const h = (flow as unknown as { h: ReturnType<typeof harness> }).h;
  const hooks = (flow as unknown as { hooks: { body: string }[] }).hooks;
  for (const x of hooks) await h.call("esign.hook", { provider: "documenso", payload: JSON.parse(x.body) });
  // a re-delivery of everything changes nothing
  const before = h.written.length;
  for (const x of hooks) await h.call("esign.hook", { provider: "documenso", payload: JSON.parse(x.body) });
  assert.equal(h.written.length, before);
  assert.equal(h.written.length, 1, "one new version of the file");
  const signed = fromBase64(h.written[0]!.base64);
  assert.equal(new TextDecoder().decode(signed.subarray(0, 5)), "%PDF-");
  assert.ok(signed.length > makePdf().length, "the signed PDF carries the signatures and the certificate");
  say("signed pdf bytes", signed.length);
  assert.deepEqual(await h.call("esign.status", { envelopeId: flow.envelopeId }), { status: "signed", signers: [{ name: "Dana Whitfield", status: "signed" }, { name: "Sam Ortiz", status: "signed" }] });
  assert.ok(h.callsTo("tasks.transition").some((c) => c.input.to === "done"));
});

test("cleanup", { skip }, () => {
  say(dc(["logs", "--tail", "120", "documenso"], { allowFail: true }));
  dc(["down", "-v", "--remove-orphans", "--timeout", "10"], { allowFail: true, timeout: 120_000 });
  fs.rmSync(tmp, { recursive: true, force: true });
  void execFileSync;
});
