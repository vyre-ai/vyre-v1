// spaces.matrix reports the Space kind the node was started with (--space-kind) and marks the team-only features unavailable on a Personal Space, matching the gate that refuses them (P-H_19).
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
const OWNER_TOKEN = "tok-usr_olivia";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-matrix-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

type Matrix = { kind: string; features: { key: string; available: boolean; line?: string }[] };

async function matrixOf(dir: string, kindFlag: string[]): Promise<Matrix> {
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com", ...kindFlag], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "matrix", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => (/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === OWNER_TOKEN ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "matrix" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const r = await fetch(`${d.url}/v1/spaces/matrix`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER_TOKEN}` }, body: "{}" });
    assert.equal(r.status, 200, await r.clone().text());
    return ((await r.json()) as { data: Matrix }).data;
  } finally { await d.stop(); }
}

test("spaces.matrix on a node started with --space-kind personal says personal and marks every team-only feature unavailable; the same Space started as a team says team", async () => {
  const dir = seededDir();
  const personal = await matrixOf(dir, ["--space-kind", "personal"]);
  assert.equal(personal.kind, "personal");
  assert.ok(personal.features.length > 0);
  for (const f of personal.features) assert.deepEqual([f.available, f.line], [false, "Needs a Team Space"], f.key);
  const team = await matrixOf(dir, []);
  assert.equal(team.kind, "team", "the setting at start is the truth");
  for (const f of team.features) assert.equal(f.available, true, f.key);
});
