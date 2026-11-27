// The compile-cache warm-up (host/src/daemon/warm-cache.ts) imports the daemon and every module's handlers in a process of its own. Importing must be all it does: no database opened, nothing started, no
// file written outside the cache folder, and the process ends by itself (VYRE_WARM_NO_EXIT turns off the explicit exit the warm-up normally ends with, so a timer, a socket or a handle left open would hold it).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const WARM = fileURLToPath(new URL("../src/daemon/warm-cache.ts", import.meta.url));
const walk = (dir: string, base = dir): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))],
    );

test(
  "the warm-up writes only into the cache folder, opens nothing, starts nothing and ends by itself",
  { timeout: 120_000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-warm-"));
    const data = path.join(root, "data");
    const home = path.join(root, "home");
    const cwd = path.join(root, "cwd");
    const cache = path.join(data, "compile-cache", "t");
    for (const d of [data, home, cwd, cache]) fs.mkdirSync(d, { recursive: true });
    const lock = path.join(cache, ".warming");
    fs.writeFileSync(lock, "");
    try {
      const t0 = Date.now();
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, WARM], {
          cwd,
          stdio: "ignore",
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            VYRE_DATA_DIR: data,
            NODE_COMPILE_CACHE: cache,
            VYRE_WARM_NO_EXIT: "1",
            VYRE_COMPILE_CACHE_LOCK: lock,
          },
        });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("the warm-up did not end by itself within 60 s: it left a timer, socket or handle open"));
        }, 60_000);
        child.once("exit", (c) => {
          clearTimeout(timer);
          resolve(c);
        });
        child.once("error", reject);
      });
      assert.equal(code, 0, "the warm-up ends with status 0");
      assert.ok(Date.now() - t0 < 60_000);
      // nothing outside the cache folder: not in the data directory, not in the home directory, not in the working directory
      const outside = walk(data).filter((f) => !f.startsWith(`compile-cache${path.sep}`));
      assert.deepEqual(outside, [], "no file in the data directory but the cache");
      assert.deepEqual(walk(home), [], "nothing written to the home directory");
      assert.deepEqual(walk(cwd), [], "nothing written to the working directory");
      assert.ok(walk(cache).some((f) => f !== ".warming") || !fs.existsSync(lock), "the cache was filled");
      assert.equal(fs.existsSync(lock), false, "the lock file is removed when the warm-up ends");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
