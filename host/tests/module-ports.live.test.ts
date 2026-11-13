// The ports a booted daemon binds on its modules (host/src/daemon/module-ports.ts, f-wire 12 Nov). Unbound, terminal and computers took every Space for a Team Space, and turning subscription
// sharing off never stopped the person's sessions on the server (engine answered sandboxStopped false).
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
import { bindSpacePorts, unbindSpacePorts } from "../src/daemon/module-ports.ts";

test("the ports: a Personal Space answers not a team, a Team Space answers team, and the stopper reaches the server's sessions", async () => {
  const team: Record<string, (s: string) => boolean> = {};
  let stopper: ((p: string) => Promise<boolean>) | null = null;
  const ns = (id: string) => ({
    bindTeam: (f: ((s: string) => boolean) | null) => {
      if (f) team[id] = f;
      else delete team[id];
    },
  });
  const modules = new Map<string, Record<string, unknown>>([
    ["terminal", ns("terminal")],
    ["computers", ns("computers")],
    [
      "engine",
      {
        bindSandboxStopper: (f: typeof stopper) => {
          stopper = f;
        },
      },
    ],
    ["notes", {}],
  ]);
  const stopped: string[] = [];
  assert.deepEqual(
    bindSpacePorts(modules, {
      team: false,
      stopSandbox: async (p) => {
        stopped.push(p);
        return true;
      },
    }),
    ["terminal.bindTeam", "computers.bindTeam", "engine.bindSandboxStopper"],
  );
  assert.equal(team["terminal"]!("spc_1"), false);
  assert.equal(team["computers"]!("spc_1"), false);
  assert.equal(await stopper!("usr_dana"), true);
  assert.deepEqual(stopped, ["usr_dana"]);
  const teamDeps = { team: true, stopSandbox: async () => false };
  bindSpacePorts(modules, teamDeps);
  assert.equal(team["terminal"]!("spc_1"), true);
  // two daemons in one process: the Team one stops, and the Personal one still running keeps its own answer (review, 12 Nov: stopping either unbound both)
  unbindSpacePorts(modules, teamDeps);
  assert.equal(team["terminal"]!("spc_1"), false, "the daemon still running is a Personal Space again");
  assert.equal(await stopper!("usr_dana"), true);
  unbindSpacePorts(modules);
  assert.deepEqual(Object.keys(team), [], "the last daemon to stop puts the module defaults back");
  assert.equal(stopper, null);
  assert.deepEqual(
    bindSpacePorts(new Map(), { team: true, stopSandbox: async () => false }),
    [],
    "a module that is not loaded is skipped",
  );
});

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-ports-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("a booted Personal Space daemon binds the Space kind on terminal and computers and the engine's sandbox stopper", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "ports-live",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    assert.deepEqual([...(d.boundPorts ?? [])].sort(), [
      "computers.bindTeam",
      "engine.bindSandboxStopper",
      "terminal.bindTeam",
    ]);
  } finally {
    await d.stop();
  }
});
