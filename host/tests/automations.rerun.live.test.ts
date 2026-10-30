// A live rerun is automations.replay: it starts a real automation run and needs confirm.
// runs.replay is the sandbox (kind replay) and does not repeat the note.
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

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-rerun-"));
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
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "exec-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

interface Reply { status: number; data: Record<string, unknown>; text: string; json: Record<string, unknown> }

const call = async (d: Daemon, p: string, body: unknown): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text, json };
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

const idOf = (made: Record<string, unknown>): string => {
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/);
  return id;
};
async function noteCount(d: Daemon, title: string): Promise<number> {
  const rows = (await ok(d, "/v1/records/query", { type: "note_board" }))["rows"] as { fields?: { title?: string } }[];
  return rows.filter((row) => row.fields?.title === title).length;
}
async function untilStatus(d: Daemon, runId: string, want: string, ms: number): Promise<void> {
  await until(`the run to be ${want}`, ms, async () => {
    const body = await ok(d, "/v1/runs/get", { runId });
    const status = String((body["run"] as { status?: string } | undefined)?.status ?? "");
    if (status === "failed" || status === "stopped") assert.fail(`the run ${status}: ${JSON.stringify(body)}`);
    return status === want ? true : undefined;
  });
}
async function kindOf(d: Daemon, runId: string): Promise<string> {
  const body = await ok(d, "/v1/runs/get", { runId });
  return String((body["run"] as { kind?: string } | undefined)?.kind ?? "");
}

test("a live rerun needs confirmation and a sandbox replay does not write the note", async () => {
  const d = await boot(seededDir());
  try {
    const title = "Made by a live rerun";
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: "rerun-note", name: "rerun-note",
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "note", key: "records.create", input: { type: "note_board", fields: { title } } }] },
    });
    const id = idOf(made);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "rerun-1" }))["runId"]);
    await untilStatus(d, runId, "succeeded", 12_000);
    assert.equal(await noteCount(d, title), 1);

    const refused = await call(d, "/v1/automations/replay", { automationId: id, runId, version: "same" });
    assert.notEqual(refused.status, 200, refused.text);
    assert.equal(await noteCount(d, title), 1, "a replay without confirm does not write a second note");

    const live = await ok(d, "/v1/automations/replay", { automationId: id, runId, version: "same", confirm: true });
    const liveId = String(live["runId"]);
    assert.match(liveId, /^run_/);
    assert.notEqual(liveId, runId);
    assert.equal(await kindOf(d, liveId), "automation");
    await untilStatus(d, liveId, "succeeded", 12_000);
    const afterLive = await noteCount(d, title);

    const sand = await ok(d, "/v1/runs/replay", { runId });
    const sandId = String(sand["runId"]);
    assert.match(sandId, /^run_/);
    assert.notEqual(sandId, runId);
    assert.equal(await kindOf(d, sandId), "replay");
    const end = Date.now() + 2_500;
    for (;;) {
      const body = await ok(d, "/v1/runs/get", { runId: sandId });
      const status = String((body["run"] as { status?: string } | undefined)?.status ?? "");
      if (status === "succeeded" || status === "failed" || status === "stopped" || Date.now() >= end) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(await noteCount(d, title), afterLive, "a sandbox replay does not write another note");
  } finally { await d.stop(); }
});
