// Crash resume through the live daemon. The first process is SIGKILLed while a Run is waiting. The next daemon finishes that same Run once.
import test from "node:test";
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
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-killed-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

function boot(dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "killed-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (header) => {
      const token = /^Bearer (.+)$/.exec(String(header["authorization"] ?? ""))?.[1];
      return token === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "killed-live" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
    ...extra,
  });
}

async function call(url: string, route: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; text: string }> {
  const response = await fetch(`${url}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  return { status: response.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
}

async function ok(url: string, route: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await call(url, route, body);
  assert.equal(response.status, 200, `${route}: ${response.text}`);
  return response.data;
}

async function until(what: string, ms: number, look: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await look()) return;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
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

test("a SIGKILL while a Run is waiting resumes that Run once on the next daemon", async () => {
  const dir = seededDir();
  const first = await hold(dir);
  let runId = "";
  try {
    const made = await ok(first.url, "/v1/automations/create", { idempotencyKey: "killed-make", name: "killed-wait" });
    const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
    await ok(first.url, "/v1/automations/update", {
      automationId: id,
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "pause", key: "wait", input: { forDuration: "5s" } }, { id: "note", key: "records.create", input: { type: "note_board", fields: { title: "Made after the kill" } } }] },
    });
    runId = String((await ok(first.url, "/v1/automations/run", { automationId: id, idempotencyKey: "killed-run" }))["runId"]);
    await until("the run to wait", 10_000, async () => (await ok(first.url, "/v1/runs/get", { runId }))["run"] !== undefined && String(((await ok(first.url, "/v1/runs/get", { runId }))["run"] as { status?: string }).status) === "waiting");
  } finally {
    first.child.kill("SIGKILL");
    await new Promise((resolve) => first.child.once("exit", resolve));
  }
  const next = await boot(dir);
  try {
    await until("the recovered run to succeed", 60_000, async () => String(((await ok(next.url, "/v1/runs/get", { runId }))["run"] as { status?: string }).status) === "succeeded");
    const rows = (await ok(next.url, "/v1/records/query", { type: "note_board" }))["rows"] as { fields: { title?: string } }[];
    assert.equal(rows.filter((row) => row.fields.title === "Made after the kill").length, 1);
  } finally {
    await next.stop();
  }
});
