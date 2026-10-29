// Self-trigger and chain depth on a booted daemon. fire drops origin automation:<id> unless the definition allows it, drops depth >= 8, and one eventId starts one run.
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
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const NOAH = "tok-usr_noah";
const HOUR = 3_600_000;

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-depth-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "exec-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    const who = t === OWNER ? "usr_olivia" : t === NOAH ? "usr_noah" : null;
    return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "exec-live" };
  },
  intervals: { fast: HOUR, slow: HOUR, encryption: HOUR, commands: HOUR, hooks: HOUR, tick: HOUR, sweep: HOUR },
  ...extra,
});

interface Reply { status: number; data: Record<string, unknown>; text: string }

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
};
const ok = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body, token);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};

const note = (title: string) => ({ id: "note", key: "records.create", input: { type: "note_board", fields: { title } } });
const definition = (title: string, allowSelfTrigger = false) => ({
  triggers: [{ key: "record_change" }],
  nodes: [note(title)],
  ...(allowSelfTrigger ? { allowSelfTrigger: true } : {}),
});

async function automation(d: Daemon, name: string, allowSelfTrigger = false): Promise<string> {
  const made = await ok(d, "/v1/automations/create", { idempotencyKey: `depth-${name}`, name, definition: definition(name, allowSelfTrigger) });
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? "");
  assert.match(id, /^aut_/, `automations.create: ${JSON.stringify(made)}`);
  const turned = await ok(d, "/v1/automations/set_enabled", { automationId: id, enabled: true });
  assert.equal((turned["automation"] as { status?: string }).status, "on", JSON.stringify(turned));
  return id;
}

const runIds = async (d: Daemon, id: string): Promise<string[]> => {
  const listed = await ok(d, "/v1/runs/list", { scope: "subject", subject: { type: "automation", id }, limit: 50 });
  return ((listed["runs"] as { id?: string }[] | undefined) ?? []).map((row) => String(row.id));
};

interface Fired { dropped?: string; runId?: string }

const fire = async (d: Daemon, id: string, eventId: string, depth: number, origin?: string): Promise<Fired> => {
  const body: Record<string, unknown> = {
    automationId: id, trigger: "record_change", eventId, idempotencyKey: eventId, payload: { recordId: "rec_abc" }, depth,
  };
  if (origin !== undefined) body["origin"] = origin;
  const data = await ok(d, "/v1/automations/fire", body);
  return { dropped: typeof data["dropped"] === "string" ? data["dropped"] : undefined, runId: typeof data["runId"] === "string" ? data["runId"] : undefined };
};

interface DropRow { type?: string; payload?: { eventId?: string; reason?: string } }

/** events.list returns automation.trigger_dropped for this automation. The reason on that row is the audit proof. */
async function droppedReason(d: Daemon, id: string, eventId: string): Promise<string | undefined> {
  const r = await call(d, "/v1/events/list", { types: ["automation.trigger_dropped"], subject: { type: "automation", id }, limit: 50 });
  assert.equal(r.status, 200, r.text);
  const events = (r.data["events"] as DropRow[] | undefined) ?? [];
  return events.find((e) => e.type === "automation.trigger_dropped" && e.payload?.eventId === eventId)?.payload?.reason;
}

test("self-trigger and chain depth hold on the live daemon", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "chain");
    const self = await fire(d, id, "evt_self1", 0, `automation:${id}`);
    assert.equal(self.dropped, "self_trigger");
    assert.equal(self.runId, undefined);
    assert.deepEqual(await runIds(d, id), [], "a dropped self-trigger starts no run");
    assert.equal(await droppedReason(d, id, "evt_self1"), "self_trigger");

    const saved = await ok(d, "/v1/automations/update", { automationId: id, definition: definition("chain", true) });
    const row = saved["automation"] as { status?: string; definition?: { allowSelfTrigger?: boolean } };
    assert.equal(row.status, "on");
    assert.equal(row.definition?.allowSelfTrigger, true);

    const at7 = await fire(d, id, "evt_d7", 7, `automation:${id}`);
    assert.match(at7.runId ?? "", /^run_[a-z0-9]+$/, JSON.stringify(at7));
    assert.deepEqual(await runIds(d, id), [at7.runId], "depth 7 is the last hop that starts a run");

    const at8 = await fire(d, id, "evt_d8", 8, `automation:${id}`);
    assert.equal(at8.dropped, "depth_limit");
    assert.equal(at8.runId, undefined);
    assert.deepEqual(await runIds(d, id), [at7.runId], "depth 8 does not add a run");
    assert.equal(await droppedReason(d, id, "evt_d8"), "depth_limit");

    const onceId = await automation(d, "once", true);
    const eventId = "evt_once1";
    const body = { automationId: onceId, trigger: "record_change", eventId, idempotencyKey: eventId, payload: { recordId: "rec_once" }, depth: 0 };
    const first = await ok(d, "/v1/automations/fire", body);
    const second = await ok(d, "/v1/automations/fire", body);
    const runId = String(first["runId"] ?? "");
    assert.match(runId, /^run_[a-z0-9]+$/, JSON.stringify(first));
    assert.equal(String(second["runId"] ?? ""), runId);
    assert.deepEqual(await runIds(d, onceId), [runId], "the same eventId is one run");
  } finally { await d.stop(); }
});
