// P-L3_17: the record types the manifests declare are seeded once when the daemon starts and registered as resources the Space owner holds, so a capability on a declared type (the Default Kit's
// schema.layout.set on note_board is the step that failed) is authorized, and the type is still there after a restart. Everything goes through the gateway with a token (rule 27).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-schema-boot-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "schema-boot", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}


test("Personal session import persists through restart, supports archive read and continuation over the gateway", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let conversationId = "";
  try {
    const imported = await call(d, "sessions.import", {
      provider: "codex", sourceKey: "codex:fixture", consent: { previewedAt: 1, confirmedAt: 2 }, idempotencyKey: "fixture-import",
      sessions: [{ sourceSessionId: "fixture", title: "Fixture session", startedAt: 1,
        repo: { remote: "git@github.com:acme/app.git", root: "/workspace/app" },
        messages: [{ sourceMessageId: "m1", role: "user", text: "Fixture visible message", at: 1 }] }],
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assert.equal(imported.data.imported, 1);
    conversationId = imported.data.sessions[0].conversationId;
    assert.equal(imported.data.sessions[0].destination.kind, "project");
  } finally { await d.stop(); }
  d = await boot(dir);
  try {
    const listed = await call(d, "sessions.list", {});
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    assert.equal(listed.data.sessions[0].conversationId, conversationId);
    const read = await call(d, "sessions.get", { conversationId });
    assert.equal(read.status, 200, JSON.stringify(read.data));
    assert.equal(read.data.messages[0].text, "Fixture visible message");
    const live = await call(d, "sessions.continue", { conversationId, destinationSpaceId: "spc_core", destinationScope: "personal", agentId: "agt_intake" });
    assert.equal(live.status, 200, JSON.stringify(live.data));
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
