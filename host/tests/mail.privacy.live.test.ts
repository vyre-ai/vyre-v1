// F48 (14 Nov 2026): an inbox a person set to private is private where the kernel decides: the owner, and the people it is shared with, nobody else, for send and for naming it in a saved definition. Setting
// it back to the Space gives it back to every member. Real daemon, two people.
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



const sendAs = async (d: Daemon, box: string, token: string, key: string) =>
  raw(d, "/v1/mail/send", { idempotencyKey: key, mailboxId: box, to: [{ address: "real@person.test" }], subject: "Hi", text: "B" }, token);
const savesAs = async (d: Daemon, box: string, token: string, key: string) =>
  raw(d, "/v1/automations/create", { name: key, idempotencyKey: key, definition: sendStep(box) }, token);

test("setting an inbox private makes it private: members are refused, the owner and who it is shared with are not, and setting it back to the Space restores it", async () => {
  const d = await boot(seededDir());
  try {
    const box = await mailbox(d, "inbox", false);
    const reachOf = async (token: string): Promise<string> =>
      ((JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "mailbox", id: box }] }, token)).text) as { data: { items: { level: string }[] } }).data.items[0]!.level);
    const checkOf = async (): Promise<string> =>
      ((JSON.parse((await raw(d, "/v1/access/check", { principal: { kind: "person", id: "usr_noah" }, action: { level: "use" }, resource: { type: "mailbox", id: box } }, OWNER)).text) as { data: { decision: { effect: string } } }).data.decision.effect);
    await new Promise((r) => setTimeout(r, 3000));
    // F49: what the screens are told (reach, check) is what the server does
    assert.notEqual(await reachOf(NOAH), "none", "reach says none for an inbox the server lets a member use");
    assert.equal(await checkOf(), "allow", "check denies what the server allows");
    // before: a shared inbox is every member's (the product's rule)
    assert.notEqual((await sendAs(d, box, NOAH, "s0")).status, 403, "a Space inbox is open to members");
    const set = (privacy: string, key: string) => raw(d, "/v1/mail/mailbox/set_privacy", { mailboxId: box, privacy, idempotencyKey: key }, OWNER);
    assert.equal((await set("private", "p1")).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    const refused = await sendAs(d, box, NOAH, "s1");
    assert.equal(await reachOf(NOAH), "none", "reach after private");
    assert.equal(await checkOf(), "deny", "check after private");
    assert.equal(refused.status, 403, `a member sends from a private inbox: ${refused.text.slice(0, 200)}`);
    assert.equal((await savesAs(d, box, NOAH, "save-noah")).status, 422, "a member names a private inbox in a definition");
    assert.notEqual((await sendAs(d, box, OWNER, "s2")).status, 403, "the owner still sends");
    assert.equal((await savesAs(d, box, OWNER, "save-olivia")).status, 200);
    // shared with Noah: he may use it
    await raw(d, "/v1/access/share", { idempotencyKey: "share", resource: { type: "mailbox", id: box }, subject: { kind: "person", id: "usr_noah" }, level: "use" }, OWNER);
    assert.notEqual((await sendAs(d, box, NOAH, "s3")).status, 403, "the person it is shared with sends");
    // back to the Space for everyone
    assert.equal((await set("space", "p2")).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.notEqual((await sendAs(d, box, NOAH, "s4")).status, 403);
  } finally {
    await d.stop();
  }
});
