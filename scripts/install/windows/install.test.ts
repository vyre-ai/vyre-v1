// Windows device installer (P-L10_11, spec 3.13, 4.14, lead ruling Q6): the checks that need no Windows machine. The PowerShell tests (install.test.ps1) run here when
// `pwsh` is on the machine (in CI, where it is downloaded when missing, they must run); elsewhere they are skipped by name; the decision they prove (WSL2, else the Space server) is also read from the script text.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const script = fs.readFileSync(path.join(HERE, "install.ps1"), "utf8");

// PowerShell 7 for Linux, pinned by version and SHA-256. A runner without `pwsh` downloads it into a temp folder, so install.test.ps1 always runs under CI (a skip is not a pass there).
const PWSH_VERSION = "7.4.6";
const PWSH_TARBALL: Record<string, { name: string; sha256: string }> = {
  x64: { name: `powershell-${PWSH_VERSION}-linux-x64.tar.gz`, sha256: "6f6015203c47806c5cc444c19d8ed019695e610fbd948154264bf9ca8e157561" },
  arm64: { name: `powershell-${PWSH_VERSION}-linux-arm64.tar.gz`, sha256: "c0159b03e85f44ae1e7697818a011558da6c813d0aae848bf5ac13bf435d8624" },
};
const PWSH_ENV = { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1", POWERSHELL_TELEMETRY_OPTOUT: "1" };
const works = (bin: string): boolean => spawnSync(bin, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8", env: PWSH_ENV }).status === 0;

function findPwsh(): { bin: string; how: string } | null {
  if (works("pwsh")) return { bin: "pwsh", how: "on PATH" };
  const pick = PWSH_TARBALL[os.arch()];
  if (!process.env["CI"] || process.platform !== "linux" || !pick) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-pwsh-"));
  const tgz = path.join(dir, pick.name);
  const got = spawnSync("curl", ["-fsSL", "--retry", "3", "-o", tgz, `https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VERSION}/${pick.name}`], { encoding: "utf8" });
  if (got.status !== 0) return null;
  if (createHash("sha256").update(fs.readFileSync(tgz)).digest("hex") !== pick.sha256) throw new Error(`the PowerShell download does not match its pinned SHA-256 (${pick.name})`);
  fs.mkdirSync(path.join(dir, "ps"));
  if (spawnSync("tar", ["-xzf", tgz, "-C", path.join(dir, "ps")], { encoding: "utf8" }).status !== 0) return null;
  const bin = path.join(dir, "ps", "pwsh");
  fs.chmodSync(bin, 0o755);
  return works(bin) ? { bin, how: `downloaded ${pick.name}` } : null;
}
const found = findPwsh();
const hasPwsh = found !== null;
// In CI the PowerShell tests must run: a missing PowerShell is a failure, never a skip.
const mustRun = Boolean(process.env["CI"]);
const skipPwsh = !hasPwsh && !mustRun ? "no pwsh on this machine" : false;

test("pwsh is available for the PowerShell tests (required in CI)", { skip: !mustRun && "only required in CI" }, () => {
  assert.ok(found, "pwsh is neither on PATH nor downloadable on this CI runner");
  console.log(`# pwsh ${found.how}`);
});

test("the installer is a device installer: no server, no Docker, no Caddy", () => {
  assert.doesNotMatch(script, /docker|caddy|vyre-server/i);
  assert.match(script, /never hosts a Team Space/);
  assert.match(script, /never hosts one/);
});

test("CLI engines go to WSL2 when it is ready, else the Space server; the advice names wsl --install", () => {
  const block = script.match(/# BEGIN engine-route\n[\s\S]*?# END engine-route/);
  assert.ok(block, "engine-route block");
  assert.match(block[0], /if \(\$Wsl2Ready\) \{ return "wsl2" \}\s+if \(\$SpaceServer\) \{ return "space-server" \}\s+return "none"/);
  assert.match(block[0], /default version:\\s\*2/i);
  assert.match(block[0], /wsl --install/);
});

test("trust: one SHA256SUMS line is required and a mismatch throws; the setup code is cleared and never stored", () => {
  assert.match(script, /must list VyreSetup\.exe exactly once/);
  assert.match(script, /SHA-256 mismatch/);
  assert.match(script, /Remove-Item Env:\\VYRE_CODE/);
  assert.doesNotMatch(script, /(Set-Content|Out-File|Add-Content)[^\n]*VYRE_CODE/);
  assert.match(script, /\/rl limited/);
});

test("install.test.ps1 passes under pwsh", { skip: skipPwsh }, () => {
  const r = spawnSync(found!.bin, ["-NoProfile", "-File", path.join(HERE, "install.test.ps1")], { encoding: "utf8", env: PWSH_ENV });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /^not ok/m);
  assert.equal((r.stdout.match(/^ok - /gm) ?? []).length, 11);
});

test("-Plan on this PC prints an engine route and changes nothing", { skip: skipPwsh }, () => {
  const r = spawnSync(found!.bin, ["-NoProfile", "-File", path.join(HERE, "install.ps1"), "-Plan"], { encoding: "utf8", env: PWSH_ENV });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^engine-route: (wsl2|none)$/m);
});
