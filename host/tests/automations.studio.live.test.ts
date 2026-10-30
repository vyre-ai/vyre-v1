// Package export and import, the starter templates, analytics and dependencies, through a booted host.
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

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-studio-"));
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
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
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
const ok = async (d: Daemon, p: string, body: unknown): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
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
const idOf = (made: Record<string, unknown>): string => String((made["automation"] as { id?: string }).id);

test("export carries the definition only, and import makes a Personal Draft that lists what to connect", async () => {
  const d = await boot(seededDir());
  try {
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: "pkg-src", name: "pkg-src",
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "connector_request", input: { connector: "stripe", action: "ping", connectionId: "con_source1" } }] },
    });
    const id = idOf(made);
    const exported = await ok(d, "/v1/automations/packages/export", { automationId: id, name: "Shared pack" });
    const pkg = exported["package"] as { id: string; requires: { connections: { slot: string }[] } };
    assert.deepEqual(pkg.requires.connections.map((c) => c.slot), ["con_slot1"]);
    assert.doesNotMatch(JSON.stringify(exported), /con_source1/);
    const listed = await ok(d, "/v1/automations/packages/list", {});
    assert.deepEqual((listed["packages"] as { id: string }[]).map((p) => p.id), [pkg.id]);
    const refused = await call(d, "/v1/automations/packages/import", { packageId: pkg.id, connections: { con_slot1: "con_nobody1" } });
    assert.equal(refused.status, 422, refused.text);
    const imported = await ok(d, "/v1/automations/packages/import", { packageId: pkg.id, name: "Imported copy" });
    const copy = imported["automation"] as { id: string; kind: string; status: string; ownerId: string };
    assert.deepEqual([copy.kind, copy.status, copy.ownerId], ["personal", "draft", "usr_olivia"]);
    assert.notEqual(copy.id, id);
    assert.deepEqual((imported["needs"] as { connections: { slot: string }[] }).connections.map((c) => c.slot), ["con_slot1"]);
    const stranger = await call(d, "/v1/automations/packages/import", { packageId: pkg.id }, NOAH);
    assert.notEqual(stranger.status, 200, "another person cannot import someone else's package");
  } finally { await d.stop(); }
});

test("a template becomes a Personal Draft", async () => {
  const d = await boot(seededDir());
  try {
    const listed = await ok(d, "/v1/automations/templates/list", {});
    const keys = (listed["templates"] as { key: string }[]).map((t) => t.key);
    assert.ok(keys.includes("webhook_to_record") && keys.includes("approval_before_sending"));
    const made = await ok(d, "/v1/automations/templates/use", { idempotencyKey: "tpl-1", templateKey: "weekly_digest" });
    const row = made["automation"] as { kind: string; status: string; name: string; definition: { triggers: { key: string }[] } };
    assert.deepEqual([row.kind, row.status, row.name, row.definition.triggers[0]?.key], ["personal", "draft", "Weekly digest", "schedule"]);
  } finally { await d.stop(); }
});

test("analytics and dependencies read the runs and definitions that exist", async () => {
  const d = await boot(seededDir());
  try {
    const before = await ok(d, "/v1/automations/analytics", {});
    assert.equal((before["totals"] as { runs: number }).runs, 0);
    const callee = idOf(await ok(d, "/v1/automations/create", {
      idempotencyKey: "an-callee", name: "an-callee",
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "note", key: "records.create", input: { type: "note_board", fields: { title: "Analytics note" } } }] },
    }));
    const caller = idOf(await ok(d, "/v1/automations/create", {
      idempotencyKey: "an-caller", name: "an-caller",
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "sub", key: "call_automation", input: { automationId: callee } }] },
    }));
    const runId = String((await ok(d, "/v1/automations/run", { automationId: callee, idempotencyKey: "an-run" }))["runId"]);
    await until("the run to succeed", 15_000, async () => (String(((await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string }).status) === "succeeded" ? true : undefined));
    const out = await ok(d, "/v1/automations/analytics", {});
    const totals = out["totals"] as { runs: number; succeeded: number; failed: number; successRate: number | null };
    assert.deepEqual([totals.runs, totals.succeeded, totals.failed, totals.successRate], [1, 1, 0, 1]);
    assert.deepEqual((out["automations"] as { automationId: string; runs: number }[]).map((a) => [a.automationId, a.runs]), [[callee, 1]]);
    const mine = await ok(d, "/v1/automations/analytics", { automationId: callee, days: 7 });
    assert.equal((mine["totals"] as { runs: number }).runs, 1);
    const deps = await ok(d, "/v1/automations/dependencies", {});
    const items = deps["items"] as { kind: string; ref: string; problem: string | null; usedBy: { automationId: string }[] }[];
    const edge = items.find((i) => i.kind === "automation" && i.ref === callee);
    assert.ok(edge, JSON.stringify(items));
    assert.equal(edge.problem, "off");
    assert.deepEqual(edge.usedBy.map((u) => u.automationId), [caller]);
  } finally { await d.stop(); }
});
