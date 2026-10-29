// Crash resume through the live daemon. The holder is SIGKILLed while a Run is waiting. The next daemon finishes that Run once, and a later boot does not write the note again.
// A loop child parked on its own wait is the same seam: the next daemon writes that child's remaining note once.
// The old driver also kept that child's run id and attempt, and held the later iterations. Those are not on this seam.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const HOLDER = fileURLToPath(new URL("./daemon-hold.ts", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OWNER = "tok-usr_olivia";
const NOAH = "tok-usr_noah";
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-killed-host-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

function boot(dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> {
  return startDaemon({
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
}

interface Reply { status: number; data: Record<string, unknown>; text: string }

async function call(base: string, route: string, body: unknown): Promise<Reply> {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try { data = (JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}; } catch { /* not JSON */ }
  return { status: response.status, data, text };
}

async function ok(base: string, route: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await call(base, route, body);
  assert.equal(response.status, 200, `${route}: ${response.text}`);
  return response.data;
}

async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function noteCount(base: string, title: string): Promise<number> {
  const rows = (await ok(base, "/v1/records/query", { type: "note_board" }))["rows"] as { fields?: { title?: string } }[];
  return rows.filter((row) => row.fields?.title === title).length;
}

async function runStatus(base: string, runId: string): Promise<string> {
  const body = await ok(base, "/v1/runs/get", { runId });
  const status = String((body["run"] as { status?: string } | undefined)?.status ?? "");
  if (status === "failed" || status === "stopped") assert.fail(`the run ${status}: ${JSON.stringify(body)}`);
  return status;
}

async function waitingChild(base: string, parentId: string): Promise<string | undefined> {
  const runs = (await ok(base, "/v1/runs/list", { scope: "mine", statuses: ["waiting"], limit: 50 }))["runs"] as { id?: string; parentRun?: string }[];
  return runs.find((row) => row.parentRun === parentId && typeof row.id === "string")?.id;
}

function hold(dir: string): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(process.execPath, ["--experimental-strip-types", HOLDER, "--data-dir", dir], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let buf = "";
    let err = "";
    const timer = setTimeout(() => reject(new Error(`daemon did not listen\n${buf}\n${err}`)), 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const found = /listening (http\S+)/.exec(buf);
      if (!found?.[1]) return;
      clearTimeout(timer);
      resolve({ child, url: found[1] });
    });
    child.stderr?.on("data", (chunk: Buffer) => { err += chunk.toString(); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`daemon exited ${code ?? "null"}\n${err}`));
    });
  });
}

async function sigkill(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

async function automation(base: string, name: string, nodes: unknown[]): Promise<string> {
  const made = await ok(base, "/v1/automations/create", { idempotencyKey: `killed-${name}`, name, definition: { triggers: [{ key: "manual" }], nodes } });
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/);
  return id;
}

describe("killed host", { concurrency: 1 }, () => {
  test("a SIGKILL while a Run is waiting resumes that Run once, and a second recover does not write the note again", async () => {
    const dir = seededDir();
    const title = "Made after the kill";
    const first = await hold(dir);
    let runId = "";
    try {
      const id = await automation(first.url, "wait", [
        { id: "pause", key: "wait", input: { forDuration: "5s" } },
        { id: "note", key: "records.create", input: { type: "note_board", fields: { title } } },
      ]);
      runId = String((await ok(first.url, "/v1/automations/run", { automationId: id, idempotencyKey: "killed-run" }))["runId"]);
      await until("the run to wait", 10_000, async () => (await runStatus(first.url, runId)) === "waiting" ? true : undefined);
      assert.equal(await noteCount(first.url, title), 0);
    } finally {
      await sigkill(first.child);
    }
    const recovered = await boot(dir);
    try {
      await until("the recovered run to succeed", 20_000, async () => (await runStatus(recovered.url, runId)) === "succeeded" ? true : undefined);
      assert.equal(await noteCount(recovered.url, title), 1);
    } finally {
      await recovered.stop();
    }
    const again = await boot(dir);
    try {
      assert.equal(await runStatus(again.url, runId), "succeeded");
      await ok(again.url, "/v1/runs/get", { runId });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      assert.equal(await noteCount(again.url, title), 1);
    } finally {
      await again.stop();
    }
  });

  test("a SIGKILL while a loop child is waiting writes that child's note once", async () => {
    const dir = seededDir();
    const title = "Made after the killed loop";
    const first = await hold(dir);
    let runId = "";
    let childId = "";
    try {
      const id = await automation(first.url, "loop-wait", [
        {
          id: "each", key: "loop",
          input: { items: [{ id: "only" }], concurrency: 1, maxIterations: 10 },
          branches: [{ label: "body", to: "pause" }],
        },
        { id: "pause", key: "wait", input: { forDuration: "5s" }, next: ["note"] },
        { id: "note", key: "records.create", input: { type: "note_board", fields: { title } } },
      ]);
      runId = String((await ok(first.url, "/v1/automations/run", { automationId: id, idempotencyKey: "killed-loop" }))["runId"]);
      childId = await until("a loop child to wait", 10_000, async () => waitingChild(first.url, runId));
      assert.equal(await runStatus(first.url, childId), "waiting");
      assert.equal(await noteCount(first.url, title), 0);
    } finally {
      await sigkill(first.child);
    }
    const recovered = await boot(dir);
    try {
      await until("the recovered child to write its note", 20_000, async () => {
        const status = await runStatus(recovered.url, childId);
        return status === "succeeded" && (await noteCount(recovered.url, title)) === 1 ? true : undefined;
      });
    } finally {
      await recovered.stop();
    }
    const again = await boot(dir);
    try {
      assert.equal(await runStatus(again.url, childId), "succeeded");
      await ok(again.url, "/v1/runs/get", { runId });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      assert.equal(await noteCount(again.url, title), 1);
    } finally {
      await again.stop();
    }
  });
});
