// Hole 1 of the chat design: an automation an agent made or edited holds no grant. A Personal automation runs as its owner and a person's own act skips the Gate, so without a grant check an agent
// could leave a standing automation that sends as the person, with no one asked. Only a person's press makes a grant; it names the outward steps; any edit voids it.
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

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const NOAH = "tok-usr_noah";
const AGENT = "tok-agent";
const TO = "held@gate.test";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-grant-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "grant-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    if (t === OWNER) return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "grant-live" };
    if (t === NOAH) return { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "grant-live" };
    if (t === AGENT) return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_noah" };
    return null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
});

const post = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
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

async function mailbox(d: Daemon, name: string): Promise<string> {
  await post(d, "/v1/contacts/suppression/add", { channel: "email", addresses: [TO], reason: "manual" });
  const box = await post(d, "/v1/mail/mailbox/create", { idempotencyKey: `${name}-mbx`, kind: "service", address: `${name}@example.com`, title: name, provider: "inbound_only" });
  const mailboxId = String((box["mailbox"] as { id?: string } | undefined)?.id);
  await post(d, "/v1/access/share", { idempotencyKey: `${name}-noah`, resource: { type: "mailbox", id: mailboxId }, subject: { kind: "person", id: "usr_noah" }, level: "use" });
  return mailboxId;
}
const sendStep = (mailboxId: string, to: string = TO) => ({ triggers: [{ key: "manual" }], nodes: [{ id: "letter", key: "send_email", input: { mailboxId, to: [to], subject: "Hello", body: "Body." } }] });

/** "sent" when the run finishes with no hold, "held" when it waits on the Gate. */
async function outcome(d: Daemon, id: string, key: string, who = NOAH): Promise<"sent" | "held"> {
  const runId = String((await post(d, "/v1/automations/run", { automationId: id, idempotencyKey: key }, who))["runId"]);
  return until("the run to send or hold", 15_000, async () => {
    const run = (await post(d, "/v1/runs/get", { runId }, who))["run"] as { status?: string };
    if (run.status === "succeeded") return "sent" as const;
    if (run.status === "waiting") {
      const holds = (await post(d, "/v1/gate/holds/list", { states: ["held"], runId }, who))["holds"] as unknown[];
      return holds.length > 0 ? "held" as const : undefined;
    }
    if (run.status === "failed" || run.status === "stopped") assert.fail(`the run ${run.status}: ${JSON.stringify(await post(d, "/v1/runs/steps", { runId }, who))}`);
    return undefined;
  });
}

test("a Personal automation an agent made holds at its send, though it runs as the person", async () => {
  const d = await boot(seededDir());
  try {
    const mailboxId = await mailbox(d, "agent-made");
    const made = await post(d, "/v1/automations/create", { idempotencyKey: "agent-made", name: "Agent made", definition: sendStep(mailboxId) }, AGENT);
    const id = String((made["automation"] as { id?: string }).id);
    assert.equal(await outcome(d, id, "agent-made-run"), "held");
  } finally { await d.stop(); }
});

const make = async (d: Daemon, key: string, definition: unknown, who: string): Promise<string> =>
  String(((await post(d, "/v1/automations/create", { idempotencyKey: key, name: key, definition }, who))["automation"] as { id?: string }).id);
async function approve(d: Daemon, id: string, key: string, payload: unknown): Promise<string> {
  const runId = String((await post(d, "/v1/automations/run", { automationId: id, idempotencyKey: key, payload }, NOAH))["runId"]);
  const hold = await until("the run to hold", 15_000, async () => ((await post(d, "/v1/gate/holds/list", { states: ["held"], runId }, NOAH))["holds"] as { taskId?: string }[])[0]);
  await post(d, "/v1/tasks/act", { taskId: hold.taskId, action: "approve" }, NOAH);
  return until("the run to finish", 15_000, async () => {
    const run = (await post(d, "/v1/runs/get", { runId }, NOAH))["run"] as { status?: string };
    return run.status === "succeeded" ? "sent" : undefined;
  });
}

test("a person's own automation sends with no hold, and an agent's edit voids what it held", async () => {
  const d = await boot(seededDir());
  try {
    const mailboxId = await mailbox(d, "own");
    const id = await make(d, "own", sendStep(mailboxId), NOAH);
    assert.equal(await outcome(d, id, "own-1"), "sent");
    await post(d, "/v1/automations/update", { automationId: id, definition: sendStep(mailboxId, "other@gate.test") }, AGENT);
    await post(d, "/v1/contacts/suppression/add", { channel: "email", addresses: ["other@gate.test"], reason: "manual" });
    assert.equal(await outcome(d, id, "own-2"), "held");
  } finally { await d.stop(); }
});

test("a person pressing Turn on gives an agent's automation the steps it names", async () => {
  const d = await boot(seededDir());
  try {
    const mailboxId = await mailbox(d, "press");
    const id = await make(d, "press", sendStep(mailboxId), AGENT);
    assert.equal(await outcome(d, id, "press-before"), "held");
    await post(d, "/v1/automations/set_enabled", { automationId: id, enabled: true }, AGENT);
    assert.equal(await outcome(d, id, "press-agent-on"), "held", "an agent turning it on grants nothing");
    await post(d, "/v1/automations/set_enabled", { automationId: id, enabled: false }, NOAH);
    await post(d, "/v1/automations/set_enabled", { automationId: id, enabled: true }, NOAH);
    assert.equal(await outcome(d, id, "press-after"), "sent");
  } finally { await d.stop(); }
});

test("a Run reaching a new target raises a task; approving adds that one target", async () => {
  const d = await boot(seededDir());
  try {
    const mailboxId = await mailbox(d, "reach");
    await post(d, "/v1/contacts/suppression/add", { channel: "email", addresses: ["new@gate.test"], reason: "manual" });
    const def = { triggers: [{ key: "manual" }], nodes: [{ id: "letter", key: "send_email", input: { mailboxId, to: ["{{ trigger.input.to }}"], subject: "Hello", body: "Body." } }] };
    const id = await make(d, "reach", def, AGENT);
    await post(d, "/v1/automations/set_enabled", { automationId: id, enabled: true }, NOAH);
    assert.equal(await approve(d, id, "reach-1", { to: TO }), "sent");
    const again = String((await post(d, "/v1/automations/run", { automationId: id, idempotencyKey: "reach-2", payload: { to: TO } }, NOAH))["runId"]);
    assert.equal(await until("the second send", 15_000, async () => (((await post(d, "/v1/runs/get", { runId: again }, NOAH))["run"] as { status?: string }).status === "succeeded" ? "sent" : undefined)), "sent", "the approved target goes");
    assert.equal(await approve(d, id, "reach-3", { to: "new@gate.test" }), "sent", "a new target stopped first");
  } finally { await d.stop(); }
});

test("a step a person wrote with a computed target goes wherever it computes", async () => {
  const d = await boot(seededDir());
  try {
    const mailboxId = await mailbox(d, "computed");
    const def = { triggers: [{ key: "manual" }], nodes: [{ id: "letter", key: "send_email", input: { mailboxId, to: ["{{ trigger.input.to }}"], subject: "Hello", body: "Body." } }] };
    const id = await make(d, "computed", def, NOAH);
    const runId = String((await post(d, "/v1/automations/run", { automationId: id, idempotencyKey: "computed-1", payload: { to: TO } }, NOAH))["runId"]);
    await until("the send", 15_000, async () => (((await post(d, "/v1/runs/get", { runId }, NOAH))["run"] as { status?: string }).status === "succeeded" ? true : undefined));
  } finally { await d.stop(); }
});

test("a step set to ask before sending asks, even in a person's own automation", async () => {
  const d = await boot(seededDir());
  try {
    const mailboxId = await mailbox(d, "asks");
    const def = sendStep(mailboxId) as { nodes: Record<string, unknown>[] };
    def.nodes[0]!["askBeforeSending"] = true;
    assert.equal(await outcome(d, await make(d, "asks", def, NOAH), "asks-1"), "held");
  } finally { await d.stop(); }
});
