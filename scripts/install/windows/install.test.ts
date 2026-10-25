// Windows device installer (P-L10_11, spec 3.13, 4.14, lead ruling Q6): the checks that need no Windows machine. The PowerShell tests (install.test.ps1) run here when
// `pwsh` is on the machine and are skipped by name otherwise; the decision they prove (WSL2, else the Space server) is also read from the script text.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const script = fs.readFileSync(path.join(HERE, "install.ps1"), "utf8");
const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
const hasPwsh = pwsh.status === 0;

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

test("install.test.ps1 passes under pwsh", { skip: !hasPwsh && "no pwsh on this machine" }, () => {
  const r = spawnSync("pwsh", ["-NoProfile", "-File", path.join(HERE, "install.test.ps1")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /^not ok/m);
  assert.equal((r.stdout.match(/^ok - /gm) ?? []).length, 11);
});

test("-Plan on this PC prints an engine route and changes nothing", { skip: !hasPwsh && "no pwsh on this machine" }, () => {
  const r = spawnSync("pwsh", ["-NoProfile", "-File", path.join(HERE, "install.ps1"), "-Plan"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^engine-route: (wsl2|none)$/m);
});
