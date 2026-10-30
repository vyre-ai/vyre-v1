// A revoked Google account fails the automation step as provider.auth_failed. The token stays inside the stub. A retry uses the same connection id.
import test from "node:test";
import assert from "node:assert/strict";
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
import type { FetchLike } from "../src/ctx/http.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const NOAH = "tok-usr_noah";
const CONNECTION = "con_revoked";
const TOKEN = "ya29.revoked-google-fixture";
const TRACE = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
const seen: string[] = [];

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-google-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** Gmail for the revoked connection answers 401. Any other host is refused here, so the test never calls the public network. The token is not copied into the answer. */
const http: FetchLike = (url) => {
  const host = new URL(url).hostname;
  if (!host.endsWith(".googleapis.com")) return Promise.reject(new Error(`this test does not call ${host}`));
  return Promise.resolve({ status: 401, headers: { get: () => null }, text: () => Promise.resolve("") });
};

const boot = (dir: string): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "google-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  http,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    const who = t === OWNER ? "usr_olivia" : t === NOAH ? "usr_noah" : null;
    return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "google-live" };
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  seams: {
    drivers: {
      setGoogleHost: () => ({
        async mintToken(_ctx: unknown, a: { connectionId: string }) {
          seen.push(a.connectionId);
          if (a.connectionId !== CONNECTION) throw new Error(`mint refused ${a.connectionId}`);
          return { token: TOKEN, expiresAt: Date.now() + 3_600_000 };
        },
        memberEmails: () => Promise.resolve([]),
        serviceAccount: () => Promise.resolve({ clientId: "0", clientEmail: "sa@vyre.test" }),
        fileBytes: () => Promise.reject(new Error("file bytes are unused")),
        putBlob: () => Promise.reject(new Error("blob store is unused")),
        download: () => Promise.reject(new Error("download is unused")),
        upload: () => Promise.reject(new Error("upload is unused")),
      }),
    },
  },
} satisfies DaemonOptions);

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
};
const ok = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body, token);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};

async function untilFailed(d: Daemon, runId: string): Promise<void> {
  const end = Date.now() + 10_000;
  for (;;) {
    const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
    const status = String(run.status);
    if (status === "failed") return;
    assert.notEqual(status, "waiting", `run ${runId} is waiting`);
    assert.notEqual(status, "succeeded", `run ${runId} succeeded`);
    assert.ok(Date.now() < end, `run ${runId} stayed ${status}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function seedGoogle(d: Daemon): void {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../modules/google/migrations/0001_google_core.sql");
  d.db!.exec(fs.readFileSync(file, "utf8"));
  d.db!.run(
    `INSERT INTO google_config (id, "connectionId", "adminEmail", domain, configured, "autoConnect", updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "google", CONNECTION, "olivia@vyre.test", "vyre.test", 1, 0, 1,
  );
  d.db!.run(
    `INSERT INTO google_member (email, "userId", mapped, excluded, updated_at) VALUES (?, ?, ?, ?, ?)`,
    "olivia@vyre.test", "usr_olivia", 1, 0, 1,
  );
}

function stepRows(d: Daemon, runId: string): { input_json: string | null; output_json: string | null; error_code: string | null; error_message: string | null }[] {
  return d.db!.all(
    "SELECT input_json, output_json, error_code, error_message FROM runs_steps WHERE run_id = ?",
    runId,
  ) as { input_json: string | null; output_json: string | null; error_code: string | null; error_message: string | null }[];
}

test("a revoked Google account fails the step, the token stays out, and retry uses the same connection", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  try {
    await d.log!.append({
      id: "evt_res_con_revoked", type: "resource.created", sv: 1, trace_id: TRACE, actor: "svc_seed", vis: "space",
      entity: "resource", entity_id: CONNECTION,
      payload: { id: CONNECTION, type: "connection", parent_id: "spc_core", label: 0, owner_id: "usr_olivia", holds: 0 },
    });
  } finally { await d.stop(); }

  d = await boot(dir);
  try {
    seedGoogle(d);
    const made = await ok(d, "/v1/automations/create", { idempotencyKey: "google-revoked", name: "List revoked mail" });
    const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
    assert.match(id, /^aut_/);
    await ok(d, "/v1/automations/update", {
      automationId: id,
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "list", key: "google.gmail.list_messages", input: { connectionId: CONNECTION, q: "in:inbox" } }] },
    });
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "run-revoked" }))["runId"]);
    await untilFailed(d, runId);

    const stepsRes = await call(d, "/v1/runs/steps", { runId });
    assert.equal(stepsRes.status, 200, stepsRes.text);
    assert.equal(stepsRes.text.includes(TOKEN), false, "the step response holds the token");
    const steps = stepsRes.data["steps"] as { state?: string; error?: { code?: string; message?: string } }[];
    const failed = steps.find((s) => s.state === "failed");
    assert.equal(failed?.error?.code, "provider.auth_failed", JSON.stringify(steps));
    assert.equal(failed?.error?.message, "Google did not accept the delegated sign-in.");

    const stored = stepRows(d, runId);
    assert.equal(JSON.stringify(stored).includes(TOKEN), false, "the stored step holds the token");
    const input = JSON.parse(String(stored.find((s) => s.error_code === "provider.auth_failed")?.input_json)) as { connectionId?: string };
    assert.equal(input.connectionId, CONNECTION);
    const minted = seen.length;
    assert.ok(minted >= 1, "the Gmail call minted for the revoked connection");
    assert.deepEqual([...new Set(seen)], [CONNECTION]);

    const retry = await call(d, "/v1/automations/retry", { automationId: id, runId });
    assert.equal(retry.status, 200, retry.text);
    assert.equal(retry.text.includes(TOKEN), false, "the retry response holds the token");
    assert.equal(retry.text.includes("con_"), false, "the retry response names a connection id");
    const nextId = String(retry.data["runId"]);
    assert.notEqual(nextId, runId);
    await untilFailed(d, nextId);
    assert.ok(seen.length > minted, "the retry reached Gmail");
    assert.deepEqual([...new Set(seen)], [CONNECTION]);
    const again = stepRows(d, nextId);
    assert.equal(JSON.stringify(again).includes(TOKEN), false, "the retried step holds the token");
    const nextInput = JSON.parse(String(again.find((s) => s.error_code === "provider.auth_failed")?.input_json)) as { connectionId?: string };
    assert.equal(nextInput.connectionId, CONNECTION);
    const nextSteps = await call(d, "/v1/runs/steps", { runId: nextId });
    assert.equal(nextSteps.text.includes(TOKEN), false);
  } finally { await d.stop(); }
});
