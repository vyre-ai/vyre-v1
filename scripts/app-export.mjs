#!/usr/bin/env node
// The one way to export the app for release: expo export with the daemon's registry hash baked in, then a check that it is there. An export without it says registryHash "" in its
// hello, the server refuses the live socket and nothing live reaches the app: no Working, no streaming, no live line (rc.8 and rc.9 on the Mac).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportEnv } from "./lib/registry-hash.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, cwd, env) => { const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" }); if (r.status !== 0) process.exit(r.status ?? 1); };
run("npx", ["expo", "export", "--platform", "web", "--output-dir", "dist"], path.join(repo, "apps/app"), exportEnv());
run(process.execPath, [path.join(repo, "scripts/shots/registry-hash-in-bundle.mjs"), path.join(repo, "apps/app/dist")], repo, process.env);
