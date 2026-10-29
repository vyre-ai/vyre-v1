// Run by the PACKAGED Node (Vyre.app/Contents/MacOS/vyred) against the app's bundled runtime, in the desktop job (macOS): the pieces a Personal Space needs to run an agent are in the bundle, and the
// bundled Node starts under the exact Seatbelt profile the bundled sandbox code builds. Usage: vyred bundle-check.ts <Resources/runtime>
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime = path.resolve(process.argv[2] ?? "");
const need = [
  "host/src/daemon/main.ts", "sandbox/src/seatbelt.ts", "sandbox/src/index.ts", "modules/engine/sandbox.ts", "modules/engine/sandbox-default.ts", "modules/engine/mcp-bridge.ts", "modules/engine/session.ts",
  "agent/src/drivers/cli/launcher.ts", "agent/src/drivers/cli/claude.ts", "agent/src/drivers/cli/codex.ts", "package.json", "node_modules",
];
const missing = need.filter((f) => !fs.existsSync(path.join(runtime, f)));
if (missing.length) { console.error(`missing from the bundle: ${missing.join(", ")}`); process.exit(1); }
if (process.platform !== "darwin") { console.error(`the bundled Node reports ${process.platform}, not darwin`); process.exit(1); }
if (!fs.existsSync("/usr/bin/sandbox-exec")) { console.error("/usr/bin/sandbox-exec is missing on this Mac"); process.exit(1); }

const work = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(process.env["RUNNER_TEMP"] ?? "/tmp"), "vyre-bundle-check-")));
try {
  const { seatbeltProfile } = await import(pathToFileURL(path.join(runtime, "sandbox/src/seatbelt.ts")).href) as { seatbeltProfile(c: unknown, o: unknown): string };
  const profile = seatbeltProfile({ mounts: [{ host: work, guest: "/work/x", mode: "rw" }], scratch: work }, { proxyPort: 9, programRead: [path.dirname(path.dirname(process.execPath))] });
  const run = (script: string) => spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "--", process.execPath, "-e", script], { cwd: work, encoding: "utf8" });
  const up = run("console.log('up', process.platform)");
  if (up.signal !== null || up.status !== 0 || !/^up darwin/.test(up.stdout)) { console.error(`the bundled Node did not start under the profile: status ${String(up.status)} signal ${String(up.signal)} ${up.stderr}`); process.exit(1); }
  const outside = path.join(path.dirname(work), `outside-${process.pid}.txt`);
  const w = run(`try { require('node:fs').writeFileSync(${JSON.stringify(outside)}, 'x'); console.log('WROTE'); } catch (e) { console.log(e.code); }`);
  if (w.stdout.trim() !== "EPERM" || fs.existsSync(outside)) { console.error(`a write outside the work folder was not refused: ${w.stdout} ${w.stderr}`); process.exit(1); }
  console.log(`bundle ok: ${need.length} paths present, the bundled Node (${process.version}) runs under Seatbelt and a write outside the work folder is refused`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
