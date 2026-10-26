// P-L8_17: the portal module is live on a booted daemon and an invitation goes out as email through the host's portal mailer (host/src/seams/comms.ts createPortalHost), which calls
// mail.mailbox.list and mail.send through the invoke pipeline. Mail is still a stub module, so the test supplies those two handlers (daemon option extra.handlers); everything else is
// the real thing: the portal handlers, the seam, the pipeline and the gateway with a real token.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const OWNER_TOKEN = "tok-usr_olivia";
const TEMP_TOKEN = "tok-usr_tess";
const SITE = "sit_default";   // the Space's default portal (ruling 73): no Sites site, no sites.get
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-portal-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

interface Sent { mailboxId: string; route: string; to: { address: string }[]; subject: string; text: string }

/** Mail is live, so the service mailbox is a real one (created below through the gateway). Only mail.send is replaced: a real send needs a DNS-verified sending domain and a provider key. */
let lastDir = "";
function boot(dir: string, sent: Sent[]): Promise<Daemon> {
  lastDir = dir;
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "portal-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    extra: {
      handlers: {
        "mail.send": async (_ctx: unknown, input: unknown) => { sent.push(input as Sent); return { messageId: "eml_1", status: "queued", suppressed: [] }; },
      },
    },
    seams: { publicUrl: async () => "https://space.example" },
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER_TOKEN ? "usr_olivia" : t === TEMP_TOKEN ? "usr_tess" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "portal-live" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

let n = 0;
async function post(d: Daemon, token: string, cap: string, body: Record<string, unknown>): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey: `portal-live-${++n}`, ...body }) });
  const json = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: json.data ?? json };
}

async function serviceMailbox(d: Daemon): Promise<string> {
  const r = await post(d, OWNER_TOKEN, "mail.mailbox.create", { kind: "service", address: "portal@space.example", title: "Portal", provider: "inbound_only" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.mailbox.id as string;
}
const invite = (d: Daemon, token = OWNER_TOKEN, email = "pat@client.test") => post(d, token, "portal.account_create", { siteId: SITE, email, method: "magic_link" });
const linkOf = (sent: Sent[]): string => /(https:\/\/space\.example)(\/portal\/[^\s?]+)/.exec(sent.at(-1)?.text ?? "")?.[2] ?? "";
/** Why a portal email failed: the mailer records code and message in logs.db (the portal module itself only says the email could not be sent). */
async function whyMail(): Promise<string> {
  await new Promise((r) => setTimeout(r, 400));
  try {
    const db = new DatabaseSync(path.join(lastDir, "logs.db"), { readOnly: true });
    try { return JSON.stringify(db.prepare("SELECT msg, attrs FROM logs WHERE place = 'portal'").all()); } finally { db.close(); }
  } catch (e) { return `(no log: ${e instanceof Error ? e.message : "unreadable"})`; }
}
const get = async (d: Daemon, p: string) => { const r = await fetch(`${d.url}${p}`); return { status: r.status, headers: r.headers, text: await r.text() }; };

test("portal live: portal is live in host/modules.json and the daemon wires its mailer", async () => {
  const list = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; status: string }[] };
  assert.equal(list.modules.find((m) => m.id === "portal")?.status, "live");
  const d = await boot(seededDir(), []);
  try {
    assert.ok(d.seams?.wired.includes("configurePortal"), "configurePortal is wired by the generic loader and daemon");
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module === "portal"), [], "portal is not reported as not set up");
  } finally { await d.stop(); }
});

test("portal live: an invitation is emailed from the real service mailbox with a link that carries a one-use token", async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), sent);
  try {
    const mailbox = await serviceMailbox(d);
    const r = await invite(d);
    assert.equal(r.status, 200, `${JSON.stringify(r.data)} ${r.status === 200 ? "" : await whyMail()}`);
    assert.equal(r.data.account.email, "pat@client.test");
    assert.equal(sent.length, 1, "one email went through mail.send");
    assert.equal(sent[0]?.mailboxId, mailbox);
    assert.equal(sent[0]?.route, "space_domain");
    assert.deepEqual(sent[0]?.to, [{ address: "pat@client.test" }]);
    assert.match(linkOf(sent), new RegExp(`^/portal/${SITE}/link/[A-Za-z0-9_-]{20,}$`));
    assert.match(sent[0]?.text ?? "", /\?purpose=invite/);
    const listed = await post(d, OWNER_TOKEN, "portal.accounts", { siteId: SITE });
    assert.equal(listed.data.accounts?.length, 1, JSON.stringify(listed.data));
  } finally { await d.stop(); }
});

test("portal live: the invitation link opens a landing page for the invited client, and a bad, wrong-site or used token is a 404", async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), sent);
  try {
    await serviceMailbox(d);
    const made = await invite(d);
    assert.equal(made.status, 200, `${JSON.stringify(made.data)} ${made.status === 200 ? "" : await whyMail()}`);
    const link = linkOf(sent);
    const token = link.split("/").at(-1) ?? "";

    const page = await get(d, link);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page.headers.get("cache-control") ?? "", /no-store/);
    assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'nonce-[^']+'/);
    assert.match(page.text, /pat@client\.test/);
    assert.match(page.text, /Shared with you/);
    assert.match(page.text, /Nothing has been shared with you yet/);
    assert.match(page.text, /Open my portal/);
    assert.equal((await get(d, link)).status, 200, "looking at the page does not use the link up");

    assert.equal((await get(d, `/portal/${SITE}/link/${token.slice(0, -1)}x`)).status, 404, "a wrong token");
    assert.equal((await get(d, `/portal/sit_other/link/${token}`)).status, 404, "the right token on another site");

    const done = await fetch(`${d.url}${link}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const claimed = (await done.json()) as { data?: { session?: string } };
    assert.equal(done.status, 200, JSON.stringify(claimed));
    assert.match(claimed.data?.session ?? "", /\S{20,}/, "the client got a session");
    assert.equal((await get(d, link)).status, 404, "a used link is gone");
    const again = await fetch(`${d.url}${link}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(again.status, 404, "a used link cannot be claimed twice");
    const wrong = await fetch(`${d.url}/portal/${SITE}/link/not-a-token`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(wrong.status, 404);
  } finally { await d.stop(); }
});

test("portal live: the session a claim makes is the client's portal session only: the gateway does not know it as a Space caller", async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), sent);
  try {
    await serviceMailbox(d);
    assert.equal((await invite(d)).status, 200);
    const link = linkOf(sent);
    const done = await fetch(`${d.url}${link}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const session = ((await done.json()) as { data?: { session?: string } }).data?.session ?? "";
    assert.ok(session.length >= 20);
    for (const cap of ["portal.accounts", "spaces.list", "records.list"]) {
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session}` }, body: JSON.stringify({ siteId: SITE }) });
      assert.equal(r.status, 401, `${cap} does not take a portal session as a Space caller`);
    }
  } finally { await d.stop(); }
});

test("portal live: a source that tries many tokens on the link is turned away with 429", async () => {
  const d = await boot(seededDir(), []);
  try {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await fetch(`${d.url}/portal/${SITE}/link/guess${i}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(404), "ten tries are answered, each the same 404");
    assert.deepEqual(codes.slice(10), [429, 429], "then the source is held off");
  } finally { await d.stop(); }
});

test("portal live: the landing page shows what is shared with the client once their record is linked", async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), sent);
  try {
    await serviceMailbox(d);
    const made = await invite(d);
    const typed = await post(d, OWNER_TOKEN, "schema.apply", { ops: [{ op: "type.create", type: "rt_client", def: { title: "Client", plural: "Clients", icon: "user", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } }] });
    assert.equal(typed.status, 200, JSON.stringify(typed.data));
    const rec = await post(d, OWNER_TOKEN, "records.create", { type: "rt_client", fields: { name: "Pat Client" } });
    assert.equal(rec.status, 200, JSON.stringify(rec.data));
    const linked = await post(d, OWNER_TOKEN, "portal.link_record", { accountId: made.data.account.accountId, recordId: rec.data.record.id, rowRule: { recordType: "rt_client" } });
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    const page = await get(d, linkOf(sent));
    assert.equal(page.status, 200);
    assert.match(page.text, /Your records/);
    assert.match(page.text, /Shared rt client records/);
  } finally { await d.stop(); }
});

test("portal live: with no service mailbox the invitation fails with a message that says what to create, and no account is left behind", async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), sent);
  try {
    const r = await invite(d);
    assert.notEqual(r.status, 200);
    assert.equal(sent.length, 0);
    const listed = await post(d, OWNER_TOKEN, "portal.accounts", { siteId: SITE });
    assert.equal(listed.data.accounts?.length, 0, `the account made for the invitation was removed: ${JSON.stringify(listed.data)}`);
  } finally { await d.stop(); }
});

test("portal live: a temporary guest without sites.deploy cannot invite", async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), sent);
  try {
    await serviceMailbox(d);
    const r = await invite(d, TEMP_TOKEN);
    assert.equal(r.status, 403, JSON.stringify(r.data));
    assert.equal(sent.length, 0);
  } finally { await d.stop(); }
});
