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
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
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


const LAYOUT = { type: "note_board", sections: [{ key: "main", title: "Note", fields: ["title", "body"] }] };

test("a declared type exists after start, the owner can set its layout, it survives a restart, and a caller without a token is refused", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  try {
    const got = await call(d, "schema.types.get", { type: "note_board" });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.type.key, "note_board");
    const set = await call(d, "schema.layout.set", LAYOUT);
    assert.equal(set.status, 200, `the owner may set the layout of a declared type: ${JSON.stringify(set.data)}`);
    const refused = await fetch(`${d.url}/v1/schema/layout/set`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(LAYOUT) });
    assert.equal(refused.status, 401, "no token, no layout");
  } finally { await d.stop(); }
  d = await boot(dir);
  try {
    assert.equal((await call(d, "schema.types.get", { type: "note_board" })).status, 200, "still there after a restart");
    const lay = await call(d, "schema.layout.get", { type: "note_board" });
    assert.equal(lay.status, 200, JSON.stringify(lay.data));
    assert.deepEqual(lay.data.sections.map((s: { key: string }) => s.key), ["main"], "the layout survived the restart");
    const set = await call(d, "schema.layout.set", LAYOUT);
    assert.equal(set.status, 200, `and can be set again: ${JSON.stringify(set.data)}`);
  } finally { await d.stop(); }
});
