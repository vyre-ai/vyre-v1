// An outward send held for approval resumes on the same attempt, so the idempotency key does not change.
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
const TO = "held@gate.test";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gate-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "gate-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "gate-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

const call = async (d: Daemon, p: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
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

interface StepRow { step: string; attempt: number; state: string; inputRef?: string; outputRef?: string; error?: { code?: string; message?: string } }
interface HoldRow { id?: string; taskId?: string; runId?: string; capName?: string; act?: string; state?: string }

test("an outward send held for approval resumes with the same attempt key", async () => {
  const d = await boot(seededDir());
  try {
    await ok(d, "/v1/contacts/suppression/add", { channel: "email", addresses: [TO], reason: "manual" });
    const box = await ok(d, "/v1/mail/mailbox/create", {
      idempotencyKey: "gate-mbx", kind: "service", address: "gate-live@example.com", title: "Gate", provider: "inbound_only",
    });
    const mailboxId = String((box["mailbox"] as { id?: string } | undefined)?.id);
    assert.match(mailboxId, /^mbx_/);
    const made = await ok(d, "/v1/automations/create", { idempotencyKey: "gate-send", name: "Held send" });
    const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
    assert.match(id, /^aut_/);
    const serviceId = `svc_${id.slice(4)}`;
    await ok(d, "/v1/automations/update", {
      automationId: id,
      definition: {
        triggers: [{ key: "manual" }],
        nodes: [
          { id: "letter", key: "send_email", input: { mailboxId, to: [TO], subject: "Held", body: "This waits for approval." } },
        ],
      },
    });
    await ok(d, "/v1/automations/promote", { automationId: id, confirm: true });
    await ok(d, "/v1/access/share", {
      idempotencyKey: "gate-share-space", resource: { type: "space", id: "spc_core" }, subject: { kind: "service", id: serviceId }, level: "view",
    });
    await ok(d, "/v1/access/share", {
      idempotencyKey: "gate-share-mbx", resource: { type: "mailbox", id: mailboxId }, subject: { kind: "service", id: serviceId }, level: "use",
    });
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "gate-run-1" }))["runId"]);
    const key = `in:${runId}:letter:1`;
    const waiting = await until("the send to wait for approval", 12_000, async () => {
      const body = await ok(d, "/v1/runs/get", { runId });
      const run = body["run"] as { status?: string; summary?: string };
      const steps = (await ok(d, "/v1/runs/steps", { runId }))["steps"] as StepRow[];
      if (run.status === "failed" || run.status === "succeeded" || run.status === "stopped") {
        assert.fail(`the run ended ${run.status} before approval: ${JSON.stringify({ run, steps })}`);
      }
      const send = steps.find((s) => s.step === "letter" && s.state === "waiting");
      return run.status === "waiting" && send ? send : undefined;
    });
    assert.equal(waiting.attempt, 1, JSON.stringify(waiting));
    assert.equal(waiting.inputRef, key, JSON.stringify(waiting));
    const listed = (await ok(d, "/v1/gate/holds/list", { states: ["held"], runId }))["holds"] as HoldRow[];
    assert.ok(listed.length >= 1, `no hold for this run: ${JSON.stringify(await ok(d, "/v1/gate/holds/list", { states: ["held"] }))}`);
    const hold = listed[0]!;
    assert.equal(hold.runId, runId, JSON.stringify(hold));
    assert.equal(hold.capName, "mail.send", JSON.stringify(hold));
    assert.equal(hold.act, "send", JSON.stringify(hold));
    await ok(d, "/v1/tasks/act", { taskId: hold.taskId, action: "approve" });
    await until("the run to finish after approval", 12_000, async () => {
      const body = await ok(d, "/v1/runs/get", { runId });
      const run = body["run"] as { status?: string; summary?: string };
      if (run.status === "succeeded") return true;
      if (run.status === "failed" || run.status === "stopped") {
        const steps = (await ok(d, "/v1/runs/steps", { runId }))["steps"];
        assert.fail(`approval did not finish the run: ${JSON.stringify({ run, steps })}`);
      }
      return undefined;
    });
    const steps = (await ok(d, "/v1/runs/steps", { runId }))["steps"] as StepRow[];
    const sends = steps.filter((s) => s.step === "letter");
    assert.deepEqual(sends.map((s) => ({ attempt: s.attempt, state: s.state, inputRef: s.inputRef, outputRef: s.outputRef })), [
      { attempt: 1, state: "succeeded", inputRef: key, outputRef: `out:${runId}:letter:1` },
    ], `the send resumed on the same attempt key: ${JSON.stringify(sends)}`);
  } finally { await d.stop(); }
});
