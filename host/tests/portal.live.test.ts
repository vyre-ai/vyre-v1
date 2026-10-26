// P-L8_17: the portal module is live on a booted daemon and an invitation goes out as email through the host's portal mailer (host/src/seams/comms.ts createPortalHost), which calls
// mail.mailbox.list and mail.send through the invoke pipeline. Mail is still a stub module, so the test supplies those two handlers (daemon option extra.handlers); everything else is
// the real thing: the portal handlers, the seam, the pipeline and the gateway with a real token.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const OWNER_TOKEN = "tok-usr_olivia";
const MEMBER_TOKEN = "tok-usr_noah";
const SITE = "sit_main";
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** The seeded Space plus one site resource: sites is deferred, so nothing else would make the account's parent. */
function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-portal-live-"));
  const r = core.store.appendBatch([{
    id: "evt_test_site", type: "resource.created", sv: 1, trace_id: "c0".repeat(16), actor: "svc_seed", vis: "space", entity: "resource", entity_id: SITE,
    payload: { id: SITE, type: "site", parent_id: core.space, label: 0, owner_id: "usr_olivia", holds: 0 },
  }]);
  assert.ok(r.every((x) => x.ok), "the site resource was added to the seed");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

interface Sent { mailboxId: string; route: string; to: { address: string }[]; subject: string; text: string }

function boot(dir: string, mailboxes: { id: string }[], sent: Sent[]): Promise<Daemon> {
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
        "mail.mailbox.list": async () => ({ mailboxes }),
        "mail.send": async (_ctx: unknown, input: unknown) => { sent.push(input as Sent); return { messageId: "eml_1", status: "queued", suppressed: [] }; },
      },
    },
    seams: { publicUrl: async () => "https://space.example" },
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER_TOKEN ? "usr_olivia" : t === MEMBER_TOKEN ? "usr_noah" : null;
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

test("portal live: portal is live in host/modules.json and the daemon wires its mailer", async () => {
  const list = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; status: string }[] };
  assert.equal(list.modules.find((m) => m.id === "portal")?.status, "live");
  const d = await boot(seededDir(), [{ id: "mbx_service" }], []);
  try {
    assert.ok(d.seams?.wired.includes("configurePortal"), "configurePortal is wired by the generic loader and daemon");
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module === "portal"), [], "portal is not reported as not set up");
  } finally { await d.stop(); }
});

test("portal live: an invitation is emailed from the service mailbox with a link that carries a one-use token", async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), [{ id: "mbx_service" }], sent);
  try {
    const r = await post(d, OWNER_TOKEN, "portal.account_create", { siteId: SITE, email: "pat@client.test", method: "magic_link" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.account.email, "pat@client.test");
    assert.equal(sent.length, 1, "one email went through mail.send");
    assert.equal(sent[0]?.mailboxId, "mbx_service");
    assert.equal(sent[0]?.route, "space_domain");
    assert.deepEqual(sent[0]?.to, [{ address: "pat@client.test" }]);
    assert.match(sent[0]?.text ?? "", new RegExp(`https://space\\.example/portal/${SITE}/link/[A-Za-z0-9_-]{20,}\\?purpose=invite`));
    const listed = await post(d, OWNER_TOKEN, "portal.accounts", { siteId: SITE });
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    assert.equal(listed.data.accounts.length, 1);
  } finally { await d.stop(); }
});

test("portal live: with no service mailbox the invitation fails with a message that says what to create, and no account is left behind", async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), [], sent);
  try {
    const r = await post(d, OWNER_TOKEN, "portal.account_create", { siteId: SITE, email: "pat@client.test", method: "magic_link" });
    assert.notEqual(r.status, 200);
    assert.match(JSON.stringify(r.data), /service mailbox/);
    assert.equal(sent.length, 0);
    const listed = await post(d, OWNER_TOKEN, "portal.accounts", { siteId: SITE });
    assert.equal(listed.data.accounts.length, 0, "the account made for the invitation was removed");
  } finally { await d.stop(); }
});

test("portal live: a member without sites.deploy cannot invite", async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), [{ id: "mbx_service" }], sent);
  try {
    const r = await post(d, MEMBER_TOKEN, "portal.account_create", { siteId: SITE, email: "pat@client.test", method: "magic_link" });
    assert.equal(r.status, 403, JSON.stringify(r.data));
    assert.equal(sent.length, 0);
  } finally { await d.stop(); }
});
