// What the Code step's sandbox is started with: no environment of the daemon at either layer. spawn gets an empty environment, and bwrap clears what it inherits and sets only an allow-list.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SPAWN_ENV, wallCommand } from "../code-sandbox.ts";

const SECRET = "daemon-secret-7731";   // secret-scan: fake
const setenvOf = (args: readonly string[]): Record<string, string> => Object.fromEntries(args.flatMap((x, k) => (x === "--setenv" ? [[args[k + 1] as string, args[k + 2] as string]] : [])));

function command(hosts: string[]): { w: ReturnType<typeof wallCommand>; dir: string } {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-code-env-")));
  const root = path.join(data, "code");
  const dir = path.join(root, "run-abc123");
  fs.mkdirSync(dir, { recursive: true });
  return { w: wallCommand({ dataDir: data, node: "/usr/bin/node" }, fs.realpathSync(root), fs.realpathSync(dir), hosts, "/tmp/vyre-net-unit"), dir: data };
}

test("the sandbox process is spawned with an empty environment, whatever the daemon holds", () => {
  process.env["DAEMON_ONLY_SECRET"] = SECRET;
  try {
    assert.deepEqual(Object.keys(SPAWN_ENV), []);
    const { w, dir } = command([]);
    assert.deepEqual(w.env, {});
    assert.equal(w.args.some((a) => a.includes(SECRET)), false, "the daemon's secret is nowhere in the command");
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { delete process.env["DAEMON_ONLY_SECRET"]; }
});

test("bwrap clears its environment and sets exactly the allow-list: no hosts named, and with hosts named", () => {
  process.env["DAEMON_ONLY_SECRET"] = SECRET;
  try {
    const none = command([]);
    assert.ok(none.w.args.indexOf("--clearenv") >= 0 && none.w.args.indexOf("--clearenv") < none.w.args.indexOf("--setenv"), "cleared before anything is set");
    const base = ["HOME", "PATH", "LANG", "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
    const keysNone = Object.keys(setenvOf(none.w.args)).sort();
    assert.ok(keysNone.every((k) => [...base, "NODE_USE_ENV_PROXY", "VYRE_CODE_NET"].includes(k)), `unexpected variables: ${keysNone.join(", ")}`);
    assert.equal(keysNone.includes("NODE_USE_ENV_PROXY"), false);
    assert.equal(keysNone.includes("VYRE_CODE_NET"), false);
    const named = command(["api.example.com"]);
    const keysNamed = Object.keys(setenvOf(named.w.args)).sort();
    assert.deepEqual(keysNamed, [...keysNone, "NODE_USE_ENV_PROXY", "VYRE_CODE_NET"].sort());
    for (const c of [none, named]) {
      assert.equal(JSON.stringify(setenvOf(c.w.args)).includes(SECRET), false);
      fs.rmSync(c.dir, { recursive: true, force: true });
    }
  } finally { delete process.env["DAEMON_ONLY_SECRET"]; }
});
