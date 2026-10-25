// Stages what the desktop bundle carries for the vyred sidecar (ARCH 7.13, R13):
//   binaries/vyred-<target triple>[.exe]   the Node runtime that runs the daemon (Tauri externalBin "binaries/vyred")
//   runtime/                               the daemon's program: the workspaces it needs plus production node_modules
// The Rust shell starts `vyred runtime/host/src/daemon/main.ts --role device ...`, the same entry the Docker image runs.
//   node apps/desktop/src-tauri/stage-runtime.ts [--out DIR] [--dry-run]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..", "..");

/** Workspaces the device daemon loads. Every other workspace keeps only its package.json so `npm ci` can resolve the lockfile. */
export const RUNTIME_DIRS = ["lib", "manifest", "contracts", "kernel", "host", "sync", "client", "agent", "sandbox", "modules", "connectors", "generated", "manifests", "packages", "relay/client", "testkit"] as const;
export const ROOT_FILES = ["package.json", "package-lock.json", "tsconfig.base.json", "LICENSE", "NOTICE"] as const;
/** Never staged, whatever the directory: tests, screenshots, caches and build output. */
export const SKIP = /(^|\/)(node_modules|\.git|target|dist|coverage|__screens__|tests?|golden|fixtures)(\/|$)|\.test\.(ts|js|mjs|tsx)$|\.heavy\.test\./;

export type StagePlan = { copyDirs: string[]; packageOnly: string[]; rootFiles: string[] };

/** From the root package.json workspaces list: which directories are copied whole and which keep only package.json. */
export function plan(workspaces: string[], exists: (rel: string) => boolean = () => true): StagePlan {
  const dirs: string[] = [];
  for (const w of workspaces) {
    if (w.endsWith("/*")) continue;
    dirs.push(w);
  }
  const want = new Set<string>(RUNTIME_DIRS);
  const copyDirs = [...want].filter((d) => exists(d));
  const packageOnly = dirs.filter((d) => !want.has(d) && !copyDirs.some((c) => d === c || d.startsWith(`${c}/`)));
  return { copyDirs, packageOnly, rootFiles: [...ROOT_FILES].filter((f) => exists(f)) };
}

/** The Rust target triple of this machine, as Tauri names external binaries. */
export function hostTriple(): string {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const m = /^host:\s*(\S+)$/m.exec(out);
  if (!m) throw new Error("rustc -vV printed no host triple");
  return m[1];
}

export function binaryName(triple: string): string {
  return `vyred-${triple}${triple.includes("windows") ? ".exe" : ""}`;
}

function copyTree(src: string, dst: string, rel: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (SKIP.test(r)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTree(from, to, r);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : HERE;
  const dry = args.includes("--dry-run");
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { workspaces: string[] };
  const expanded: string[] = [];
  for (const w of rootPkg.workspaces) {
    if (w.endsWith("/*")) {
      const base = w.slice(0, -2);
      for (const e of fs.existsSync(path.join(REPO, base)) ? fs.readdirSync(path.join(REPO, base), { withFileTypes: true }) : []) {
        if (e.isDirectory() && fs.existsSync(path.join(REPO, base, e.name, "package.json"))) expanded.push(`${base}/${e.name}`);
      }
    } else expanded.push(w);
  }
  const p = plan(expanded, (rel) => fs.existsSync(path.join(REPO, rel)));
  if (dry) {
    process.stdout.write(`${JSON.stringify(p, null, 2)}\n`);
    return;
  }
  const runtime = path.join(out, "runtime");
  fs.rmSync(runtime, { recursive: true, force: true });
  fs.mkdirSync(runtime, { recursive: true });
  for (const f of p.rootFiles) fs.copyFileSync(path.join(REPO, f), path.join(runtime, f));
  for (const d of p.copyDirs) {
    fs.mkdirSync(path.join(runtime, d), { recursive: true });
    copyTree(path.join(REPO, d), path.join(runtime, d), d);
  }
  for (const d of p.packageOnly) {
    fs.mkdirSync(path.join(runtime, d), { recursive: true });
    fs.copyFileSync(path.join(REPO, d, "package.json"), path.join(runtime, d, "package.json"));
  }
  execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: runtime, stdio: "inherit", shell: os.platform() === "win32" });
  const bin = path.join(out, "binaries");
  fs.mkdirSync(bin, { recursive: true });
  const target = path.join(bin, binaryName(hostTriple()));
  fs.copyFileSync(process.execPath, target);
  fs.chmodSync(target, 0o755);
  process.stdout.write(`staged ${runtime} and ${target}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
