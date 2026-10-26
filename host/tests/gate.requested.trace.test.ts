// P-GF_08 (ruling 87): when the Gate parks a call, gate.requested is in the Space's log, in the trace of the held call, naming the asker, the capability and the hold, and never the input.
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

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

test("a member's held call leaves gate.requested in the log, in the held call's trace, without the input", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gate-requested-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "gate-requested", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => (/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === "tok-usr_noah" ? { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "gate-requested" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const traceId = "9d".repeat(16);
    // exporting one's own Mine items is behind the secret_export Gate act, which holds a person's own call too
    const r = await fetch(`${d.url}/v1/vault/items/export_mine`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tok-usr_noah", "x-vyre-trace": `${traceId}-${"ef".repeat(8)}` }, body: JSON.stringify({ expiresIn: "1h" }),
    });
    const body = (await r.json()) as { data?: { status?: string; taskId?: string }; error?: { code?: string } };
    assert.equal(body.data?.status, "held", `the call is held: ${JSON.stringify(body)}`);
    const requested = (await d.log!.read({ type: "gate.requested" })).filter((e) => e.trace_id === traceId);
    assert.equal(requested.length, 1, "gate.requested is in the held call's trace");
    const payload = JSON.parse(new TextDecoder().decode(requested[0]!.payload)) as Record<string, unknown>;
    assert.equal(payload["capName"], "vault.items.export_mine");
    assert.deepEqual(payload["principal"], { kind: "person", id: "usr_noah" });
    assert.equal(payload["taskId"], body.data?.taskId);
    assert.ok(typeof payload["holdId"] === "string");
    assert.ok(!JSON.stringify(payload).includes("1h"), "and it carries no input value");
  } finally { await d.stop(); }
});
