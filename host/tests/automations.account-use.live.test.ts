// F47 (14 Nov 2026): a step may name only a mailbox, number or connection its saver may use. Real daemon, two people. A member's private mailbox cannot be named by someone else (the save says so, in words that
// name the step, and nothing is stored), a shared inbox every member may use still can, and the person's own works; a stored step that names a thing its owner may no longer use fails its Run in words.
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

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });
const OWNER = "tok-usr_olivia";
const NOAH = "tok-usr_noah";
const AGENT = "tok-agent";
const TO = "held@gate.test";

function seededDir(): string {
  const core = bootCore();
  core.store.appendBatch([
    {
      id: "evt_f47_box",
      type: "resource.created",
      sv: 1,
      trace_id: "1".repeat(32),
      actor: "svc_seed",
      vis: "space",
      entity: "resource",
      entity_id: "mbx_privatebox0001",
      payload: { id: "mbx_privatebox0001", type: "mailbox", parent_id: null, label: 0, owner_id: "usr_olivia", holds: 0 },
    } as never,
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-grant-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string): Promise<Daemon> =>
  startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "grant-live",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      if (t === OWNER)
        return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "grant-live" };
      if (t === NOAH) return { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "grant-live" };
      if (t === AGENT)
        return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_noah" };
      return null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  });

const post = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await fetch(`${d.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await r.text();
  assert.equal(r.status, 200, `${p}: ${text}`);
  return (JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {};
};
async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mailbox(d: Daemon, name: string, share = true): Promise<string> {
  await post(d, "/v1/contacts/suppression/add", { channel: "email", addresses: [TO], reason: "manual" });
  const box = await post(d, "/v1/mail/mailbox/create", {
    idempotencyKey: `${name}-mbx`,
    kind: "service",
    address: `${name}@example.com`,
    title: name,
    provider: "inbound_only",
  });
  const mailboxId = String((box["mailbox"] as { id?: string } | undefined)?.id);
  // Turn on checks that the mailbox can send: this one sends through the Space domain, so the Space has a verified one. The recipient is suppressed, so nothing reaches a provider
  d.db!.run(
    `INSERT OR IGNORE INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "dom_gate",
    "example.com",
    "resend",
    "pass",
    "pass",
    "pass",
    1,
    1,
    1,
  );
  if (share)
    await post(d, "/v1/access/share", {
      idempotencyKey: `${name}-noah`,
      resource: { type: "mailbox", id: mailboxId },
      subject: { kind: "person", id: "usr_noah" },
      level: "use",
    });
  return mailboxId;
}
const sendStep = (mailboxId: string, to: string = TO) => ({
  triggers: [{ key: "manual" }],
  nodes: [{ id: "letter", key: "send_email", input: { mailboxId, to: [to], subject: "Hello", body: "Body." } }],
});

/** "sent" when the run finishes with no hold, "held" when it waits on the Gate. */
async function outcome(d: Daemon, id: string, key: string, who = NOAH): Promise<"sent" | "held"> {
  const runId = String((await post(d, "/v1/automations/run", { automationId: id, idempotencyKey: key }, who))["runId"]);
  return until("the run to send or hold", 15_000, async () => {
    const run = (await post(d, "/v1/runs/get", { runId }, who))["run"] as { status?: string };
    if (run.status === "succeeded") return "sent" as const;
    if (run.status === "waiting") {
      const holds = (await post(d, "/v1/gate/holds/list", { states: ["held"], runId }, who))["holds"] as unknown[];
      return holds.length > 0 ? ("held" as const) : undefined;
    }
    if (run.status === "failed" || run.status === "stopped")
      assert.fail(`the run ${run.status}: ${JSON.stringify(await post(d, "/v1/runs/steps", { runId }, who))}`);
    return undefined;
  });
}


const raw = async (d: Daemon, p: string, body: unknown, token: string): Promise<{ status: number; text: string }> => {
  const r = await fetch(`${d.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  return { status: r.status, text: await r.text() };
};


const named = async (d: Daemon, body: unknown, token: string): Promise<{ status: number; text: string; id?: string }> => {
  const r = await raw(d, "/v1/automations/create", body, token);
  return { ...r, id: (JSON.parse(r.text) as { data?: { automation?: { id?: string } } }).data?.automation?.id };
};

test("a private mailbox cannot be named by another person; a shared inbox and their own can; a stored step stops in words", async () => {
  const d = await boot(seededDir());
  try {
    const shared = await mailbox(d, "shared-inbox", false);
    d.db!.run(
      `INSERT INTO mail_mailbox (id, kind, address, title, "ownerId", "agentId", provider, privacy, state, "connectionId", "lastSyncAt", paused, version, updated_at, deleted_at) VALUES (?, 'personal', ?, ?, 'usr_olivia', NULL, 'inbound_only', 'private', 'syncing', NULL, NULL, 0, 1, 1, NULL)`,
      "mbx_privatebox0001",
      "olivia@example.com",
      "olivia",
    );
    // another person's private mailbox: refused at save, nothing stored
    const refused = await named(d, { name: "Steal", idempotencyKey: "steal", definition: sendStep("mbx_privatebox0001", "real@person.test") }, NOAH);
    assert.equal(refused.status, 422, refused.text);
    assert.match(refused.text, /Send an email: you cannot use the mailbox it names/);
    assert.equal(refused.text.includes("mbx_privatebox0001"), false, "no id in the words");
    assert.equal((await raw(d, "/v1/automations/list", {}, NOAH)).text.includes("Steal"), false, "nothing was stored");
    // the validate banner says it too
    const banner = await raw(d, "/v1/automations/validate", { definition: sendStep("mbx_privatebox0001") }, NOAH);
    assert.match(banner.text, /you cannot use the mailbox it names/);
    // a shared inbox every member may use still saves, and so does the owner's own private mailbox
    assert.equal((await named(d, { name: "Shared", idempotencyKey: "sh", definition: sendStep(shared) }, NOAH)).status, 200);
    assert.equal((await named(d, { name: "Own", idempotencyKey: "own", definition: sendStep("mbx_privatebox0001") }, OWNER)).status, 200);
    // an Automation that already holds the id (saved by its owner) and is run by someone without use stops at the send, in words, and sends nothing
    const own = await named(d, { name: "Own2", idempotencyKey: "own2", definition: sendStep("mbx_privatebox0001", "real@person.test") }, OWNER);
    const before = (d.db!.all(`SELECT COUNT(*) AS n FROM mail_message`) as { n: number }[])[0]!.n;
    const run = await raw(d, "/v1/automations/run", { automationId: own.id, idempotencyKey: "rr" }, NOAH);
    assert.match(run.text, /runs only as its owner/, "a Personal automation is run by its owner alone");
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal((d.db!.all(`SELECT COUNT(*) AS n FROM mail_message`) as { n: number }[])[0]!.n, before, "nothing was sent");
  } finally {
    await d.stop();
  }
});
