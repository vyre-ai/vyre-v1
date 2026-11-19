// The Space's own mail server (SMTP): mail.smtp.set / get / verify, an SMTP sending domain with Vyre's own DKIM key, and mail.send going out through it.
// The socket is a recorded transport, the Vault and DNS are scripted. Nothing leaves the process and no address here is real.
import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { domainAdd, domainCheck, dkimOf } from "../handlers/extra/domains.ts";
import { bindDns } from "../handlers/extra/dns.ts";
import { routeSet } from "../handlers/extra/routes.ts";
import { script, zone } from "../handlers/extra/kit.ts";
import { send } from "../handlers/send.ts";
import {
  bindSmtp,
  explain,
  mask,
  setMailFileBytes,
  setSmtpSecret,
  smtpGet,
  smtpSet,
  smtpVerify,
} from "../handlers/smtp.ts";
import type { SmtpConn, SmtpMail, SmtpTransport } from "../handlers/smtp.ts";
import { ensureWatch } from "../handlers/watch.ts";
import { codeOf, contractErrors, harness, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { rig, row, sendIn } from "./send.rig.test.ts";

const SERVER = {
  host: "smtp.northwind.example",
  port: 587,
  username: "hello@northwind.example",
  passwordHandle: "#Smtp_Password",
};
// secret-scan: fake
const PASSWORD = "correct horse battery staple";

interface Wire {
  verified: SmtpConn[];
  sent: { conn: SmtpConn; mail: SmtpMail }[];
  fail: unknown;
  rejected: { address: string; code?: number }[];
}
/** A recorded socket: it keeps what it was asked to do, and fails once with `fail` when that is set. */
function wire(ctx: Harness["ctx"]): Wire {
  const w: Wire = { verified: [], sent: [], fail: null, rejected: [] };
  const trip = (): void => {
    if (!w.fail) return;
    const e = w.fail;
    w.fail = null;
    throw e;
  };
  const t: SmtpTransport = {
    async verify(conn) {
      trip();
      w.verified.push(conn);
    },
    async send(conn, mail) {
      trip();
      w.sent.push({ conn, mail });
      return { rejected: w.rejected };
    },
  };
  bindSmtp(ctx, t);
  kinds(ctx);
  return w;
}
/** The Vault's item list as the module sees it: handle to kind. A handle not here is not an item this person can open. */
export const KINDS: Record<string, string> = {
  "#Smtp_Password": "login",
  "#Smtp_Other": "login",
  "#Smtp_Dkim_vyre_test": "login",
  "#Aws_Root_Key": "env",
};
function kinds(ctx: Harness["ctx"]): void {
  const base = ctx.call.bind(ctx);
  ctx.call = async (cap, input) => {
    if (cap !== "vault.items.list") return base(cap, input);
    const want = (input as { kind?: string }).kind;
    return {
      items: Object.entries(KINDS)
        .filter(([, k]) => k === want)
        .map(([handle]) => ({ handle })),
      counts: {},
    };
  };
}
const err = (code: string, extra: Record<string, unknown> = {}): Error =>
  Object.assign(new Error((extra.message as string) ?? code), { code, ...extra });

/** The Vault as the module sees it: a value per handle, and the handles that were read. */
function vault(values: Record<string, string> = { "#Smtp_Password": PASSWORD }): {
  read: string[];
  values: Record<string, string>;
} {
  const v = { read: [] as string[], values };
  setSmtpSecret(async (_ctx, handle) => {
    v.read.push(handle);
    const value = v.values[handle];
    if (!value) throw err("provider.auth_failed", { message: "The Vault has no item for that mailbox password." });
    return value;
  });
  return v;
}
test.afterEach(() => {
  setSmtpSecret(null);
  setMailFileBytes(null);
});

// ---- mail.smtp.set / get

test("smtp.set saves the server and answers what a person entered, never the password or its handle", async () => {
  const h = harness();
  vault();
  wire(h.ctx);
  assert.deepEqual(await smtpGet(h.ctx), { configured: false, state: "none" });
  const saved = await smtpSet(h.ctx, SERVER);
  assert.deepEqual(saved, {
    configured: true,
    host: "smtp.northwind.example",
    port: 587,
    security: "starttls",
    username: "he…@northwind.example",
    state: "unchecked",
  });
  assert.deepEqual(await smtpGet(h.ctx), saved);
  assert.ok(!JSON.stringify(saved).includes("Smtp_Password"));
  assert.deepEqual(contractErrors("mail.smtp.get", "out", saved), []);
  assert.deepEqual(contractErrors("mail.smtp.set", "out", saved), []);
  assert.deepEqual(contractErrors("mail.smtp.set", "in", SERVER), []);
});

test("smtp.set: port 465 starts secure unless the person chose, and saving again replaces the one row and clears the last test", async () => {
  const h = harness();
  vault();
  wire(h.ctx);
  assert.equal((await smtpSet(h.ctx, { ...SERVER, port: 465 })).security, "tls");
  assert.equal((await smtpSet(h.ctx, { ...SERVER, port: 465, security: "starttls" })).security, "starttls");
  assert.equal((await smtpVerify(h.ctx, {})).ok, true);
  assert.equal((await smtpGet(h.ctx)).state, "ok");
  const again = await smtpSet(h.ctx, { ...SERVER, host: "SMTP.Other.Example " });
  assert.equal(again.host, "smtp.other.example");
  assert.equal(again.state, "unchecked");
  assert.equal(again.checkedAt, undefined);
  assert.equal(h.rows(`SELECT * FROM mail_smtp`).length, 1);
});

test("smtp.set refuses a server it cannot use, in a sentence, and saves nothing", async () => {
  const h = harness();
  vault();
  const refused = async (over: Record<string, unknown>, words: RegExp): Promise<void> => {
    await assert.rejects(
      () => smtpSet(h.ctx, { ...SERVER, ...over }),
      (e: unknown) =>
        codeOf(e) === "validation.bad_input" && words.test((e as { error: { message: string } }).error.message),
    );
  };
  await refused({ host: "not a host" }, /mail server's name/);
  await refused({ host: "localhost" }, /mail server's name/);
  await refused({ port: 0 }, /port is a number/);
  await refused({ port: 70000 }, /port is a number/);
  await refused({ security: "ssl" }, /starttls or tls/);
  await refused({ username: " " }, /username/);
  await refused({ passwordHandle: "hunter2" }, /Vault/);
  assert.equal(h.rows(`SELECT * FROM mail_smtp`).length, 0);
});

// ---- mail.smtp.verify

test("smtp.verify signs in to the saved server with the Vault password and records that it works", async () => {
  const h = harness();
  const v = vault();
  const w = wire(h.ctx);
  await smtpSet(h.ctx, SERVER);
  h.advance(400);
  const out = await smtpVerify(h.ctx, {});
  assert.equal(out.ok, true);
  assert.equal(out.message, "Connected to smtp.northwind.example and signed in.");
  assert.deepEqual(contractErrors("mail.smtp.verify", "out", out), []);
  assert.deepEqual(w.verified, [
    {
      host: "smtp.northwind.example",
      port: 587,
      security: "starttls",
      username: "hello@northwind.example",
      password: PASSWORD,
      ip: "93.184.216.34",
    },
  ]);
  assert.ok(v.read.includes("#Smtp_Password"));
  assert.equal(w.sent.length, 0, "a test sends nothing");
  const got = await smtpGet(h.ctx);
  assert.equal(got.state, "ok");
  assert.equal(got.checkedAt, NOW + 400);
});

test("smtp.verify on a server that cannot open mail ports says so and names the way out; the saved server shows why", async () => {
  const h = harness();
  vault();
  const w = wire(h.ctx);
  await smtpSet(h.ctx, SERVER);
  w.fail = err("ETIMEDOUT", { message: "Connection timeout" });
  const out = await smtpVerify(h.ctx, {});
  assert.equal(out.ok, false);
  assert.equal(out.reason, "blocked");
  assert.match(out.message, /cannot open port 587/);
  assert.match(out.message, /Railway/);
  assert.match(out.message, /port 2525/);
  assert.match(out.message, /Mailgun or Resend/);
  assert.deepEqual(contractErrors("mail.smtp.verify", "out", out), []);
  const got = await smtpGet(h.ctx);
  assert.equal(got.state, "failed");
  assert.equal(got.detail, out.message);
});

test("smtp.verify with other values tries them and leaves the saved server's state alone", async () => {
  const h = harness();
  vault();
  const w = wire(h.ctx);
  await smtpSet(h.ctx, SERVER);
  w.fail = err("ETIMEDOUT");
  await smtpVerify(h.ctx, {});
  const tried = await smtpVerify(h.ctx, { port: 2525, passwordHandle: "#Smtp_Password" });
  assert.equal(tried.ok, true);
  assert.equal(w.verified[0]?.port, 2525);
  assert.equal(w.verified[0]?.host, "smtp.northwind.example", "what was not given falls back to the saved server");
  const got = await smtpGet(h.ctx);
  assert.equal(got.port, 587);
  assert.equal(got.state, "failed", "only a test of the saved server changes what the page shows");
});

test("smtp.verify before anything is saved tests what was entered, and with nothing entered asks for a server", async () => {
  const h = harness();
  vault();
  const w = wire(h.ctx);
  await assert.rejects(
    () => smtpVerify(h.ctx, {}),
    (e: unknown) => codeOf(e) === "validation.bad_input",
  );
  assert.equal((await smtpVerify(h.ctx, SERVER)).ok, true);
  assert.equal(w.verified.length, 1);
  assert.equal(h.rows(`SELECT * FROM mail_smtp`).length, 0, "a test saves nothing");
});

test("smtp.verify names each failure in words a person can act on, and never repeats the password", async () => {
  const h = harness();
  vault();
  const w = wire(h.ctx);
  await smtpSet(h.ctx, SERVER);
  const cases: [unknown, string, RegExp][] = [
    [
      err("EAUTH", { responseCode: 535, response: `535 5.7.8 Bad credentials for ${PASSWORD}` }),
      "auth",
      /did not accept that username and password/,
    ],
    [err("ENOTFOUND"), "unknown_host", /No mail server answers at smtp\.northwind\.example/],
    [err("ECONNREFUSED"), "refused", /refused the connection on port 587/],
    [err("ESOCKET", { message: "self-signed certificate in certificate chain" }), "tls", /secure connection/],
    [err("ECONNECTION", { message: "Greeting never received" }), "blocked", /cannot open port 587/],
    [
      err("EENVELOPE", { response: "554 5.7.1 Relay access denied" }),
      "failed",
      /^The mail server did not accept the connection\.$/,
    ],
  ];
  for (const [thrown, reason, words] of cases) {
    w.fail = thrown;
    const out = await smtpVerify(h.ctx, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, reason);
    assert.match(out.message, words);
    assert.ok(!out.message.includes(PASSWORD), `${reason}: the password is not in the sentence`);
  }
  // the Vault refusing reads as a sign-in problem, in the Vault's own fixed words
  const v = vault({});
  const out = await smtpVerify(h.ctx, {});
  assert.equal(out.reason, "auth");
  assert.equal(out.message, "The Vault has no item for that mailbox password.");
  assert.deepEqual(v.read, ["#Smtp_Password"]);
});

test("explain: a secure connection that fails on port 465 and on 587 each say which way to turn", () => {
  const tls = explain(err("ETLS"), { host: "smtp.x.example", port: 465, security: "tls" });
  assert.match(tls.message, /Port 465 starts secure/);
  const start = explain(err("ETLS"), { host: "smtp.x.example", port: 465, security: "starttls" });
  assert.match(start.message, /choose TLS/);
});

// ---- an SMTP sending domain

/** The Vault's folder list and item store, scripted: one Connections folder, and every item put is kept. */
function vaultCalls(h: Harness): {
  items: { name: string; fields: { key: string; value: string; secret?: boolean }[]; handle: string }[];
} {
  const store = {
    items: [] as { name: string; fields: { key: string; value: string; secret?: boolean }[]; handle: string }[],
  };
  script(h, {
    "vault.folders.list": () => ({
      folders: [{ id: "vfo_connections", name: "Connections", scope: "shared", yourLevel: "manage" }],
    }),
    "vault.share": () => ({}),
    "vault.item.put": (i) => {
      const name = String(i.name);
      const handle = `#${name.replace(/\s+/g, "_")}`;
      store.items.push({ name, fields: i.fields as { key: string; value: string; secret?: boolean }[], handle });
      return { item: { id: `vit_${store.items.length}`, handle } };
    },
  });
  return store;
}

test("domain.add for smtp asks for the mail server first", async () => {
  const h = harness();
  vaultCalls(h);
  await assert.rejects(
    () => domainAdd(h.ctx, { name: "northwind.example", provider: "smtp", idempotencyKey: "idem-smtp-0" }),
    (e: unknown) =>
      codeOf(e) === "validation.precondition_failed" &&
      /Add the mail server first/.test((e as { error: { message: string } }).error.message),
  );
  assert.equal(h.rows(`SELECT * FROM mail_domain`).length, 0);
});

test("domain.add for smtp makes the domain's own DKIM key: the private half goes to the Vault, the public half is the record", async () => {
  const h = harness();
  const store = vaultCalls(h);
  vault();
  wire(h.ctx);
  await smtpSet(h.ctx, SERVER);
  const out = await domainAdd(h.ctx, { name: "Northwind.Example", provider: "smtp", idempotencyKey: "idem-smtp-1" });
  assert.deepEqual(contractErrors("mail.domain.add", "out", out), []);
  assert.equal(out.domain.provider, "smtp");
  assert.equal(out.domain.verified, false);
  assert.deepEqual(
    out.records.map((r) => [r.purpose, r.type, r.name]),
    [
      ["spf", "TXT", "northwind.example"],
      ["dkim", "TXT", "vyre._domainkey.northwind.example"],
      ["dmarc", "TXT", "_dmarc.northwind.example"],
    ],
  );
  assert.equal(out.records[0]?.value, "v=spf1 a:smtp.northwind.example ~all");
  assert.equal(out.records[2]?.value, "v=DMARC1; p=none; rua=mailto:dmarc@northwind.example");

  // one item in the Vault, a secret field, and its public half is exactly what the record says
  assert.equal(store.items.length, 1);
  const item = store.items[0]!;
  assert.equal(item.fields.length, 1);
  assert.equal(item.fields[0]?.secret, true);
  const publicDer = createPublicKey(createPrivateKey(item.fields[0]!.value)).export({ type: "spki", format: "der" });
  assert.equal(out.records[1]?.value, `v=DKIM1; k=rsa; p=${publicDer.toString("base64")}`);

  // the row keeps the handle, never the key
  const stored = h.rows(`SELECT * FROM mail_domain`)[0]!;
  assert.ok(!String(stored.records).includes("PRIVATE KEY"));
  assert.deepEqual(dkimOf(stored), { selector: "vyre", handle: item.handle });
  assert.equal(h.calls("resend.domains.create").length + h.calls("mailgun.domains.create").length, 0);
});

test("domain.check for smtp: any published SPF counts, DKIM must be the exact key, and the domain is verified only once the mail server tested well", async () => {
  const h = harness();
  vaultCalls(h);
  vault();
  wire(h.ctx);
  await smtpSet(h.ctx, SERVER);
  const added = await domainAdd(h.ctx, { name: "northwind.example", provider: "smtp", idempotencyKey: "idem-smtp-2" });
  const dkim = added.records[1]!.value;
  const id = added.domain.id;

  bindDns(h.ctx, zone({ txt: { "northwind.example": ["v=spf1 include:spf.mailhost.example ~all"] } }));
  let out = await domainCheck(h.ctx, { domainId: id });
  assert.deepEqual(
    [out.domain.spf, out.domain.dkim, out.domain.dmarc, out.domain.verified],
    ["pass", "pending", "pending", false],
  );

  bindDns(
    h.ctx,
    zone({
      txt: {
        "northwind.example": ["some-site-verification=abc", "v=spf1 include:spf.mailhost.example ~all"],
        "vyre._domainkey.northwind.example": ["v=DKIM1; k=rsa; p=AAAAnotthekey"],
        "_dmarc.northwind.example": ["v=DMARC1; p=quarantine; rua=mailto:dmarc@northwind.example"],
      },
    }),
  );
  out = await domainCheck(h.ctx, { domainId: id });
  assert.deepEqual([out.domain.spf, out.domain.dkim, out.domain.dmarc], ["pass", "fail", "pass"]);

  const green = zone({
    txt: {
      "northwind.example": ["v=spf1 include:spf.mailhost.example ~all"],
      "vyre._domainkey.northwind.example": [dkim],
      "_dmarc.northwind.example": ["v=DMARC1; p=quarantine; rua=mailto:dmarc@northwind.example"],
    },
  });
  bindDns(h.ctx, green);
  out = await domainCheck(h.ctx, { domainId: id });
  assert.deepEqual([out.domain.spf, out.domain.dkim, out.domain.dmarc], ["pass", "pass", "pass"]);
  assert.equal(out.domain.verified, false, "the records are found, but the mail server has not been tested");

  assert.equal((await smtpVerify(h.ctx, {})).ok, true);
  out = await domainCheck(h.ctx, { domainId: id });
  assert.equal(out.domain.verified, true);
  assert.deepEqual(contractErrors("mail.domain.check", "out", out), []);
  assert.ok(dkimOf(h.rows(`SELECT * FROM mail_domain`)[0]!), "a check keeps where the signing key is");
  assert.equal(h.calls("resend.domains.verify").length + h.calls("mailgun.domains.verify").length, 0);
});

test("route.set on an smtp domain says where that mail arrives instead of making a route that never receives", async () => {
  const h = harness();
  vaultCalls(h);
  vault();
  wire(h.ctx);
  await smtpSet(h.ctx, SERVER);
  const added = await domainAdd(h.ctx, { name: "northwind.example", provider: "smtp", idempotencyKey: "idem-smtp-3" });
  seedMailbox(h, "mbx_hello", "hello@northwind.example", { kind: "shared" });
  await assert.rejects(
    () =>
      routeSet(h.ctx, {
        domainId: added.domain.id,
        localPart: "hello",
        mailboxId: "mbx_hello",
        idempotencyKey: "idem-rte-1",
      }),
    (e: unknown) =>
      codeOf(e) === "validation.precondition_failed" &&
      /arrives at your own mail server/.test((e as { error: { message: string } }).error.message),
  );
  assert.equal(h.rows(`SELECT * FROM mail_route`).length, 0);
});

// ---- mail.send through the mail server

// secret-scan: fake
const DKIM_KEY = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----";

/** A Space whose sending provider is smtp: the server saved, one verified smtp domain with a DKIM key in the Vault. */
async function smtpSpace(o: { origin?: string; dkim?: boolean } = {}) {
  const r = rig({ noDomain: true, settings: { "mail.provider": "smtp" }, ...(o.origin ? { origin: o.origin } : {}) });
  const v = vault({ "#Smtp_Password": PASSWORD, "#Smtp_Dkim_vyre_test": DKIM_KEY });
  const w = wire(r.ctx);
  await smtpSet(r.ctx, { ...SERVER, host: "smtp.vyre.test", username: "hello@vyre.test" });
  r.h.ctx.db.run(
    `INSERT INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", records, "checkedAt", version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "dom_vyretest",
    "vyre.test",
    "smtp",
    "pass",
    "pass",
    "pass",
    1,
    1,
    JSON.stringify({
      ref: "vyre.test",
      providerVerified: true,
      records: [],
      ...(o.dkim === false ? {} : { dkimHandle: "#Smtp_Dkim_vyre_test" }),
    }),
    NOW,
    1,
    NOW,
    null,
  );
  return { r, v, w };
}

test("mail.send with the smtp provider goes out through the Space's mail server, signed with the domain's key, and no other provider is called", async () => {
  const { r, v, w } = await smtpSpace();
  const out = await send(r.ctx, sendIn({ cc: [{ address: "lee@acme.test" }], html: "<p>Hi Pat</p>" }));
  assert.equal(out.status, "sent");
  assert.equal(w.sent.length, 1);
  const { conn, mail } = w.sent[0]!;
  assert.deepEqual(conn, {
    host: "smtp.vyre.test",
    port: 587,
    security: "starttls",
    username: "hello@vyre.test",
    password: PASSWORD,
    ip: "93.184.216.34",
  });
  assert.equal(mail.from, "hello@vyre.test");
  assert.deepEqual(mail.to, ["pat@acme.test"]);
  assert.deepEqual(mail.cc, ["lee@acme.test"]);
  assert.equal(mail.subject, "Hello");
  assert.equal(mail.text, "Hi Pat");
  assert.equal(mail.html, "<p>Hi Pat</p>");
  assert.equal(mail.messageId, `<${out.messageId}@vyre.test>`);
  assert.equal(mail.headers?.["X-Vyre-Trace"], r.ctx.trace.traceId);
  assert.ok(
    !Object.keys(mail.headers ?? {}).some((k) => k.toLowerCase() === "message-id"),
    "the Message-ID is written once",
  );
  assert.deepEqual(mail.dkim, { domain: "vyre.test", selector: "vyre", privateKey: DKIM_KEY });
  assert.deepEqual([...new Set(v.read)].sort(), ["#Smtp_Dkim_vyre_test", "#Smtp_Password"]);
  assert.equal(r.sent().length, 0, "Resend, Mailgun, Gmail and Graph were not called");

  const stored = row(r, out.messageId!)!;
  assert.equal(stored.status, "sent");
  assert.equal(stored.providerId, `${out.messageId}@vyre.test`);
  assert.equal(stored.rfcMessageId, `<${out.messageId}@vyre.test>`);
  assert.equal(r.h.named("message.sent").length, 1);
});

test("mail.send over smtp without a DKIM key still sends: the mail server signs alone", async () => {
  const { r, w } = await smtpSpace({ dkim: false });
  assert.equal((await send(r.ctx, sendIn())).status, "sent");
  assert.equal(w.sent[0]?.mail.dkim, undefined);
});

test("mail.send over smtp attaches Space files by their bytes", async () => {
  const { r, w } = await smtpSpace();
  const asked: string[] = [];
  setMailFileBytes(async (ctx, fileId) => {
    asked.push(`${ctx.space}:${fileId}`);
    return { name: "stored-name.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) };
  });
  await send(r.ctx, sendIn({ attachments: ["fil_agreement01"] }));
  assert.deepEqual(asked, ["spc_mailtest:fil_agreement01"]);
  assert.deepEqual(w.sent[0]?.mail.attachments, [
    { name: "fil_agreement01.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) },
  ]);
});

test("mail.send over smtp: a server that says try later is a retry, a wrong password is a sign-in failure, and the message row says failed", async () => {
  const { r, w } = await smtpSpace();
  w.fail = err("EENVELOPE", { responseCode: 421, response: "421 4.7.0 Try again later" });
  const first = sendIn();
  await assert.rejects(
    () => send(r.ctx, first),
    (e: unknown) => codeOf(e) === "provider.rate_limited",
  );
  assert.equal(r.h.rows(`SELECT * FROM mail_message WHERE status = ?`, "failed").length, 1);

  w.fail = err("EAUTH", { responseCode: 535, response: "535 5.7.8 Authentication failed" });
  await assert.rejects(
    () => send(r.ctx, sendIn()),
    (e: unknown) =>
      codeOf(e) === "provider.auth_failed" &&
      (e as { error: { message: string } }).error.message ===
        "The mail server did not accept that username and password.",
  );
  // one refused sign-in does not stop the domain (it takes two in a row): the next send is allowed to try

  w.rejected = [{ address: "pat@acme.test" }];
  await assert.rejects(
    () => send(r.ctx, sendIn()),
    (e: unknown) =>
      codeOf(e) === "provider.bad_response" &&
      (e as { error: { message: string } }).error.message === "The mail server refused every recipient.",
  );
  assert.equal(r.h.named("message.sent").length, 0);
});

test("mail.send with the smtp provider and no verified smtp domain is refused in words that name the place to fix it", async () => {
  const r = rig({ noDomain: true, settings: { "mail.provider": "smtp" } });
  wire(r.ctx);
  await assert.rejects(
    () => send(r.ctx, sendIn()),
    (e: unknown) =>
      codeOf(e) === "validation.precondition_failed" &&
      (e as { error: { message: string } }).error.message ===
        "No verified SMTP sending domain. Add and verify one in Console, Comms.",
  );
});

// ---- r-review of d1380bf99: the saved password stays with the saved place, targets are public, no server words, no resend after DATA, partial refusals reported

const moveRefused = async (run: () => Promise<unknown>): Promise<string> =>
  run().then(
    () => "",
    (e: unknown) =>
      `${codeOf(e)}: ${(e as { error?: { message: string }; message?: string }).error?.message ?? (e as Error).message}`,
  );

test("changing the server, port or username never reuses the saved password: the handle must be given again, and nothing is read or connected to without it", async () => {
  const h = harness();
  const v = vault({ "#Smtp_Password": PASSWORD, "#Smtp_Other": "other password" });
  const w = wire(h.ctx);
  await smtpSet(h.ctx, SERVER);
  v.read.length = 0;
  for (const over of [{ host: "attacker.example.com" }, { port: 2525 }, { username: "someone@else.example" }]) {
    assert.match(
      await moveRefused(() => smtpVerify(h.ctx, over)),
      /^validation\.bad_input: .*give the password's Vault handle again/,
    );
    assert.match(
      await moveRefused(() => smtpSet(h.ctx, { ...SERVER, ...over, passwordHandle: undefined })),
      /^validation\.bad_input/,
    );
  }
  assert.deepEqual(v.read, [], "no Vault read happened");
  assert.equal(w.verified.length, 0, "no connection was made");
  assert.equal((await smtpGet(h.ctx)).host, "smtp.northwind.example", "the saved server is untouched");
  // with the handle given anew it works, and the same server and port again needs nothing new
  assert.equal((await smtpVerify(h.ctx, { host: "smtp.other.example", passwordHandle: "#Smtp_Other" })).ok, true);
  assert.equal(w.verified[0]?.password, "other password");
  assert.equal((await smtpVerify(h.ctx, { security: "starttls" })).ok, true);
});

test("a password handle must be a Vault item of the kind Login or API key that the person can open, checked from the Vault and not from its name", async () => {
  const h = harness();
  const v = vault({ "#Smtp_Password": PASSWORD, "#Aws_Root_Key": "other secret" });
  wire(h.ctx);
  assert.match(
    await moveRefused(() => smtpSet(h.ctx, { ...SERVER, passwordHandle: "#Aws_Root_Key" })),
    /^validation\.bad_input: .*kind Login or API key/,
  );
  assert.match(
    await moveRefused(() => smtpVerify(h.ctx, { ...SERVER, passwordHandle: "#Aws_Root_Key" })),
    /^validation\.bad_input/,
  );
  assert.ok(!v.read.includes("#Aws_Root_Key"), "that item was never read");
  assert.match(
    await moveRefused(() => smtpSet(h.ctx, { ...SERVER, passwordHandle: "#Smtp_Missing" })),
    /^validation\.bad_input: .*you can open/,
  );
  assert.equal(h.rows(`SELECT * FROM mail_smtp`).length, 0);
});

test("a server that is not on the public internet is refused after DNS, for save, test and send, and the connection goes to the address that was checked", async () => {
  const bad = ["127.0.0.1", "10.0.0.5", "192.168.1.9", "169.254.169.254", "172.16.0.1", "::1", "fd00::1", "100.64.0.1"];
  for (const ip of bad) {
    const h = harness();
    const v = vault();
    const w = wire(h.ctx);
    bindSmtp(
      h.ctx,
      { verify: async (c) => void w.verified.push(c), send: async () => ({ rejected: [] }) },
      async () => [ip],
    );
    assert.match(await moveRefused(() => smtpSet(h.ctx, SERVER)), /^validation\.bad_input: .*public internet/, ip);
    const out = await smtpVerify(h.ctx, SERVER);
    assert.equal(out.ok, false, ip);
    assert.equal(out.reason, "address", ip);
    assert.equal(out.message, "A mail server must be on the public internet. That address is not allowed.");
    assert.equal(w.verified.length, 0, `no connection to ${ip}`);
    assert.deepEqual(v.read, [], "no password was read for it");
  }
  // a name that answers with a public and a private address is refused whole (rebinding)
  const h = harness();
  vault();
  const w = wire(h.ctx);
  bindSmtp(h.ctx, { verify: async (c) => void w.verified.push(c), send: async () => ({ rejected: [] }) }, async () => [
    "93.184.216.34",
    "10.0.0.5",
  ]);
  assert.equal((await smtpVerify(h.ctx, SERVER)).reason, "address");
  // a public answer is connected to by that address
  bindSmtp(h.ctx, { verify: async (c) => void w.verified.push(c), send: async () => ({ rejected: [] }) }, async () => [
    "198.51.100.0".replace("198.51.100.0", "93.184.216.34"),
  ]);
  assert.equal((await smtpVerify(h.ctx, SERVER)).ok, true);
  assert.equal(w.verified[0]?.ip, "93.184.216.34");
  assert.equal(w.verified[0]?.host, "smtp.northwind.example");
  // a name that does not resolve is told so, not "blocked"
  bindSmtp(h.ctx, { verify: async () => undefined, send: async () => ({ rejected: [] }) }, async () => {
    throw err("ENOTFOUND");
  });
  assert.equal((await smtpVerify(h.ctx, SERVER)).reason, "unknown_host");
});

test("mail.send over smtp to a server whose name now answers with a private address fails without connecting", async () => {
  const { r, w } = await smtpSpace();
  bindSmtp(
    r.ctx,
    { verify: async () => undefined, send: async (c, m) => void w.sent.push({ conn: c, mail: m }) as never },
    async () => ["10.1.2.3"],
  );
  const before = w.sent.length;
  await assert.rejects(
    () => send(r.ctx, sendIn()),
    (e: unknown) =>
      codeOf(e) === "provider.bad_response" &&
      /public internet/.test((e as { error: { message: string } }).error.message),
  );
  assert.equal(w.sent.length, before);
});

test("what the server says is never shown: not in a test result, not in the saved detail", async () => {
  const h = harness();
  vault();
  const w = wire(h.ctx);
  await smtpSet(h.ctx, SERVER);
  w.fail = err("EPROTOCOL", {
    message: "HTTP/1.1 200 OK secret-internal-banner",
    response: "HTTP/1.1 200 OK secret-internal-banner",
  });
  const out = await smtpVerify(h.ctx, {});
  assert.equal(out.reason, "failed");
  assert.equal(out.message, "The mail server did not accept the connection.");
  w.fail = err("EPROTOCOL", { responseCode: 554, response: "554 internal-hostname.corp wrote this" });
  const coded = await smtpVerify(h.ctx, {});
  assert.equal(coded.message, "The mail server answered with an error (554).");
  assert.ok(!JSON.stringify(await smtpGet(h.ctx)).includes("internal-hostname"));
  // a server reply that says "timeout" is not a blocked port
  w.fail = err("EPROTOCOL", { responseCode: 421, response: "421 connection timed out, try later" });
  assert.equal((await smtpVerify(h.ctx, {})).reason, "failed");
});

test("after the message body may have left, a socket failure is an unknown outcome: reported, never retried, never marked as a retry", async () => {
  const { r, w } = await smtpSpace();
  for (const command of ["DATA", ""]) {
    w.fail = err("ESOCKET", { command, message: "Connection closed unexpectedly" });
    const before = w.sent.length;
    await assert.rejects(
      () => send(r.ctx, sendIn()),
      (e: unknown) => {
        const x = e as { error: { code: string; message: string } };
        return (
          x.error.code === "provider.bad_response" &&
          /may have been delivered/.test(x.error.message) &&
          /Vyre did not send it again/.test(x.error.message) &&
          /<eml_[a-z0-9]+@vyre\.test>/.test(x.error.message)
        );
      },
      command,
    );
    assert.equal(w.sent.length, before, "the transport saw one try");
  }
  // before the body went out, nothing was delivered: a connection problem says so
  w.fail = err("ETIMEDOUT", { command: "CONN" });
  await assert.rejects(
    () => send(r.ctx, sendIn()),
    (e: unknown) => /cannot open port 587/.test((e as { error: { message: string } }).error.message),
  );
  // a definite 4xx at any step is "try later": the server did not take it
  w.fail = err("EPROTOCOL", { command: "DATA", responseCode: 451 });
  await assert.rejects(
    () => send(r.ctx, sendIn()),
    (e: unknown) => codeOf(e) === "provider.rate_limited",
  );
});

test("when the server refuses some recipients the message is sent and each refused address is reported on its own", async () => {
  const { r, w } = await smtpSpace();
  w.rejected = [
    { address: "lee@acme.test", code: 550 },
    { address: "kim@acme.test", code: 450 },
  ];
  const out = await send(r.ctx, sendIn({ cc: [{ address: "lee@acme.test" }, { address: "kim@acme.test" }] }));
  assert.equal(out.status, "sent");
  const bounced = r.h.named("message.bounced");
  assert.deepEqual(bounced.map((e) => [e.payload.address, e.payload.kind, e.payload.messageId]).sort(), [
    ["kim@acme.test", "soft", out.messageId],
    ["lee@acme.test", "hard", out.messageId],
  ]);
  assert.ok(bounced.every((e) => e.payload.reason === "The mail server refused this address."));
});

test("what people and agents read of the username is its first two letters and the domain, and saving without retyping it keeps the saved one", async () => {
  const h = harness();
  vault();
  wire(h.ctx);
  const saved = await smtpSet(h.ctx, SERVER);
  assert.equal(saved.username, "he…@northwind.example");
  assert.ok(!JSON.stringify(await smtpGet(h.ctx)).includes("hello@northwind"));
  const again = await smtpSet(h.ctx, { host: SERVER.host, port: 2525, passwordHandle: "#Smtp_Password" });
  assert.equal(again.port, 2525);
  assert.equal(
    h.rows(`SELECT username FROM mail_smtp`)[0]?.username,
    "hello@northwind.example",
    "the real username was kept",
  );
  assert.equal(mask("sam"), "sa…");
});

test("a domain whose mail server fails stops saying verified on the second failure in a row, a pass clears the count, and a moved server stops it at once", async () => {
  const { r, w } = await smtpSpace();
  ensureWatch(r.ctx);
  const verified = (): number =>
    Number(r.h.rows(`SELECT verified FROM mail_domain WHERE id = ?`, "dom_vyretest")[0]?.verified);
  const strikes = (): number =>
    Number(r.h.rows(`SELECT strikes FROM mail_domain_watch WHERE "domainId" = ?`, "dom_vyretest")[0]?.strikes ?? 0);
  assert.equal(verified(), 1);
  // a busy server is not a failed one: a timeout before the message went out counts for nothing
  w.fail = err("ETIMEDOUT", { command: "CONN" });
  await assert.rejects(() => send(r.ctx, sendIn()));
  assert.equal(strikes(), 0);
  // one refused sign-in is a warning, not a stop
  w.fail = err("EAUTH", { responseCode: 535 });
  await assert.rejects(() => send(r.ctx, sendIn()));
  assert.deepEqual([verified(), strikes()], [1, 1]);
  assert.equal((await smtpGet(r.ctx)).state, "failed");
  // a pass clears it
  assert.equal((await smtpVerify(r.ctx, {})).ok, true);
  assert.deepEqual([verified(), strikes()], [1, 0]);
  // the second failure in a row stops the domain
  w.fail = err("ECONNREFUSED");
  assert.equal((await smtpVerify(r.ctx, {})).ok, false);
  assert.deepEqual([verified(), strikes()], [1, 1]);
  // a second failure moments later is the same bad moment: not counted again
  w.fail = err("ECONNREFUSED");
  assert.equal((await smtpVerify(r.ctx, {})).ok, false);
  assert.deepEqual([verified(), strikes()], [1, 1]);
  r.h.advance(2 * 60 * 60_000);
  w.fail = err("ECONNREFUSED");
  assert.equal((await smtpVerify(r.ctx, {})).ok, false);
  assert.deepEqual([verified(), strikes()], [0, 2]);
  // moving the server is a new place: it stops a verified domain at once
  r.h.ctx.db.run(`UPDATE mail_domain SET verified = ? WHERE id = ?`, 1, "dom_vyretest");
  await smtpSet(r.ctx, { host: "smtp.moved.example", passwordHandle: "#Smtp_Password" });
  assert.equal(verified(), 0);
});

test("the Vault list is read page by page, so a short name that matches many items still finds the exact one", async () => {
  const h = harness();
  vault({ "#Smtp_Password": PASSWORD, "#Smtp_Wanted": "wanted password" });
  wire(h.ctx);
  const pages = [
    { items: Array.from({ length: 50 }, (_, i) => ({ handle: `#Smtp_Decoy${i}` })), next: "p2" },
    { items: [{ handle: "#Smtp_Wanted" }], next: "" },
  ];
  const seen: (string | undefined)[] = [];
  const base = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => {
    if (cap !== "vault.items.list") return base(cap, input);
    const cursor = (input as { cursor?: string }).cursor;
    seen.push(cursor);
    return cursor === "p2" ? pages[1] : (input as { kind?: string }).kind === "login" ? pages[0] : { items: [] };
  };
  const out = await smtpSet(h.ctx, { ...SERVER, passwordHandle: "#Smtp_Wanted" });
  assert.equal(out.configured, true);
  assert.ok(seen.includes("p2"), "the second page was read");
});

test("two quick send failures stop only the domain whose server failed, and clear the default only if that domain held it", async () => {
  const { r, w } = await smtpSpace();
  ensureWatch(r.ctx);
  // a second smtp domain that is the Space's default, and is not the one sent through
  r.h.ctx.db.run(
    `INSERT INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", records, "checkedAt", version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "dom_other",
    "other.test",
    "smtp",
    "pass",
    "pass",
    "pass",
    1,
    0,
    JSON.stringify({ ref: "other.test", providerVerified: true, records: [] }),
    NOW,
    1,
    NOW,
    null,
  );
  const row = (id: string) => r.h.rows(`SELECT verified, "isDefault" FROM mail_domain WHERE id = ?`, id)[0]!;
  w.fail = err("EAUTH", { responseCode: 535 });
  await assert.rejects(() => send(r.ctx, sendIn()));
  r.h.advance(2 * 60 * 60_000);
  w.fail = err("EAUTH", { responseCode: 535 });
  r.h.ctx.db.run(`UPDATE mail_domain SET verified = ? WHERE id = ?`, 1, "dom_vyretest");
  await assert.rejects(() => send(r.ctx, sendIn()));
  assert.deepEqual(
    [Number(row("dom_vyretest")?.verified), Number(row("dom_vyretest")?.isDefault)],
    [0, 0],
    "the domain that was sent through stopped",
  );
  assert.deepEqual(
    [Number(row("dom_other")?.verified), Number(row("dom_other")?.isDefault)],
    [1, 0],
    "the other domain is untouched",
  );
});
