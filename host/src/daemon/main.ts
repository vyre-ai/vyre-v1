// `vyred` entry point: node host/src/daemon/main.ts --role space --data-dir D [--space spc_x] [--port 8420] [--host 127.0.0.1]
// The installer's launchd and systemd units, the Tauri sidecar and `vyre server start` all run this file. It does one thing before the start (run.ts): it turns on Node's compile cache for the server's own
// source. Parsing about 4,000 TypeScript files was 4.5 s of a 6.3 s start (27 Nov 2026: imports 1.5 s, loading the modules 2.75 s); with the cache a restart's imports take 0.48 s and the modules 1.24 s.
// The cache lives in the data directory (compile-cache/<version>: it survives restarts, goes with a reinstall, and another version's folder is removed). The first start after an update has no cache and is not
// slowed by making one: it runs without, and a background process at the lowest priority fills the cache after the server listens (warm-cache.ts), for the start after it.
// Everything of the server is imported by run.ts, after this has run: a module imported before the cache is on is parsed without it.
import { enableCompileCache } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// the real-server guard (test/loop.guard.server.live.test.ts) asks for a loop monitor from the very start of the process; the product never sets this
if (process.env["VYRE_LOOP_MONITOR"]) (await import("./loop-monitor.ts")).startLoopMonitor();

const version = process.env["VYRE_VERSION"] ?? "0.0.0-dev";
const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
let warm = "";
try {
  if (process.env["VYRE_COMPILE_CACHE"] !== "off") {
    const home = flag("data-dir") ?? (process.env["VYRE_DATA_DIR"] || path.join(os.homedir(), ".vyre"));
    const root = path.join(path.resolve(home), "compile-cache");
    const dir = path.join(root, version.replace(/[^A-Za-z0-9._-]/g, "_"));
    if (fs.existsSync(root))
      for (const name of fs.readdirSync(root)) if (path.join(root, name) !== dir) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) enableCompileCache(dir);
    else {
      fs.mkdirSync(dir, { recursive: true });
      warm = dir; // no cache yet: run.ts has it filled after the server listens
    }
  }
} catch {
  /* a cache that cannot be made is no cache: the start is the same without it */
}
process.env["VYRE_COMPILE_CACHE_WARM"] = warm;
await import("./run.ts");
