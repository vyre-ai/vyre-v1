// The workspace does not install spike dependencies; install them next to the spike on first use (CI has network).
// Test files run in parallel, so one process installs under a lock directory and the others wait for the ready marker.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
const ready = dir + "node_modules/.deps-ready", lock = dir + ".install-lock";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 400 && !fs.existsSync(ready); i++) {
  try { fs.mkdirSync(lock); } catch {
    try { if (Date.now() - fs.statSync(lock).mtimeMs > 120000) fs.rmSync(lock, { recursive: true }); } catch { /* raced */ }
    await sleep(250); continue;
  }
  try {
    if (!fs.existsSync(ready)) {
      execSync("npm install --no-audit --no-fund --no-package-lock --ignore-scripts", { cwd: dir, stdio: "inherit" });
      fs.writeFileSync(ready, "ok");
    }
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
if (!fs.existsSync(ready)) throw new Error("spike dependencies not installed");
