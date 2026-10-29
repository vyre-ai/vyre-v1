// A personal automation runs only as its owner. A space automation runs as its own service.
// The acceptance file's session accepts Olivia and Noah. This file uses the same pair.
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
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const NOAH = "tok-usr_noah";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-owner-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "owner-live", free: 80e9,
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
    return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "owner-live" };
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

interface Reply { status: number; data: Record<string, unknown>; text: string; json: Record<string, unknown> }

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text, json };
};
const ok = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body, token);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};

const idOf = (made: Record<string, unknown>): string => {
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/, `automation.create: ${JSON.stringify(made)}`);
  return id;
};
const note = (title: string) => ({ id: "note", key: "records.create", input: { type: "note_board", fields: { title } } });

function refusedAsNotOwner(r: Reply): void {
  assert.equal(r.status, 404, r.text);
  const error = r.json["error"] as { code?: string; message?: string } | undefined;
  assert.equal(error?.code, "permission.not_found", r.text);
  assert.match(error?.message ?? "", /personal automation runs only as its owner/, r.text);
}

/** The daemon writes module tables to modules.db. The copied events.db is only the log. */
function runPrincipal(file: string, runId: string): { kind: string; id: string } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT principal_kind, principal_id FROM automations_runs WHERE run_id = ?").get(runId) as { principal_kind?: string; principal_id?: string } | undefined;
    assert.ok(row, `no automations_runs row for ${runId} in ${file}`);
    return { kind: String(row.principal_kind), id: String(row.principal_id) };
  } finally { db.close(); }
}

test("Olivia cannot run Noah's personal automation, and Noah still can", async () => {
  const d = await boot(seededDir());
  try {
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: "owner-noah", name: "noah-note",
      definition: { triggers: [{ key: "manual" }], nodes: [note("Noah's note")] },
    }, NOAH);
    const id = idOf(made);
    const row = made["automation"] as { ownerId?: string; kind?: string };
    assert.equal(row.ownerId, "usr_noah");
    assert.equal(row.kind, "personal");
    const seen = await ok(d, "/v1/automations/get", { automationId: id }, OWNER);
    assert.equal((seen["automation"] as { id?: string }).id, id, "a space owner may still read it");
    refusedAsNotOwner(await call(d, "/v1/automations/run", { automationId: id, idempotencyKey: "olivia-run" }, OWNER));
    refusedAsNotOwner(await call(d, "/v1/automations/test", { automationId: id }, OWNER));
    refusedAsNotOwner(await call(d, "/v1/automations/fire", {
      automationId: id, trigger: "manual", payload: {}, depth: 0, idempotencyKey: "olivia-fire",
    }, OWNER));
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "noah-run" }, NOAH))["runId"]);
    assert.match(runId, /^run_/);
  } finally { await d.stop(); }
});

test("a space automation run is linked to its service principal", async () => {
  const d = await boot(seededDir());
  try {
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: "owner-space", name: "space-note",
      definition: { triggers: [{ key: "manual" }], nodes: [note("Space note")] },
    });
    const id = idOf(made);
    const promoted = await ok(d, "/v1/automations/promote", { automationId: id, confirm: true });
    assert.equal((promoted["automation"] as { kind?: string }).kind, "space");
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "space-run" }))["runId"]);
    assert.match(runId, /^run_/);
    const serviceId = `svc_${id.replace(/^aut_/, "")}`;
    assert.deepEqual(runPrincipal(d.paths.modules, runId), { kind: "service", id: serviceId });
  } finally { await d.stop(); }
});
