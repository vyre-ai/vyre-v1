// Installs the workspace dependencies on first use (CI has network; the Mac never runs npm).
// Many processes may call this at once (test shards, shots): one installs under a lock directory, the rest wait for the ready marker.
// With a committed package-lock.json this is `npm ci`; before the lockfile exists it is `npm install --no-package-lock`.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readOr = (f) => { try { return fs.readFileSync(f); } catch { return Buffer.alloc(0); } };

/** Key over every package.json and the lockfile, so a dependency change re-installs. */
function depsKey(repo) {
  const h = crypto.createHash("sha256");
  for (const f of ["package.json", "package-lock.json", "ui/package.json", "scripts/shots/app/package.json", "apps/app/package.json"]) h.update(f + "\0").update(readOr(path.join(repo, f)));
  return h.digest("hex").slice(0, 16);
}

/** Makes node_modules match package.json. Returns true when it had to install. */
export async function ensureDeps(repo) {
  const nm = path.join(repo, "node_modules");
  const ready = path.join(nm, `.deps-ready-${depsKey(repo)}`), lock = path.join(repo, ".install-lock");
  let installed = false;
  for (let i = 0; i < 1200 && !fs.existsSync(ready); i++) {
    try { fs.mkdirSync(lock); } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 600000) fs.rmSync(lock, { recursive: true }); } catch { /* raced */ }
      await sleep(500); continue;
    }
    try {
      if (!fs.existsSync(ready)) {
        const cmd = fs.existsSync(path.join(repo, "package-lock.json"))
          ? "npm ci --no-audit --no-fund --ignore-scripts"
          : "npm install --no-audit --no-fund --no-package-lock --ignore-scripts";
        console.log(`ensure-deps: ${cmd}`);
        execSync(cmd, { cwd: repo, stdio: "inherit" });
        fs.mkdirSync(nm, { recursive: true });
        fs.writeFileSync(ready, "ok");
        installed = true;
      }
    } finally { fs.rmSync(lock, { recursive: true, force: true }); }
  }
  if (!fs.existsSync(ready)) throw new Error("workspace dependencies not installed");
  return installed;
}

/** Downloads the headless Chrome shell playwright-core drives (cached by playwright after the first run). */
export function ensureChromium(repo) {
  execSync("npx playwright-core install chromium-headless-shell", { cwd: repo, stdio: "inherit" });
}
