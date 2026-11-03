// The sudo an engine finds first on Windows (lane l-winfix): cmd.exe and PowerShell look for sudo.cmd, Git Bash for the script without an extension; both say how to hand the command to the person.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SUDO_CMD_SHIM, withSudoShim } from "../session.ts";
import { workFolder } from "../sandbox.ts";
import { engineAccess } from "../../../sandbox/src/index.ts";

test("Windows gets sudo.cmd and doas.cmd beside the scripts, first on PATH; a Mac or Linux gets the scripts alone", () => {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sudo-")));
  const cwd = workFolder(data, "usr_dana", "thr_1");
  const a = engineAccess({ where: "own", home: "C:\\Users\\Dana", dataDir: data, platform: "win32", exists: () => false });
  const w = withSudoShim(a, data, cwd, "win32");
  const bin = w.pathAdd[0]!;
  assert.deepEqual(fs.readdirSync(bin).sort(), ["doas", "doas.cmd", "sudo", "sudo.cmd"]);
  assert.equal(fs.readFileSync(path.join(bin, "sudo.cmd"), "utf8"), SUDO_CMD_SHIM);
  assert.match(SUDO_CMD_SHIM, /\r\nexit \/b 126\r\n$/);
  const data2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sudo-")));
  const p = withSudoShim(engineAccess({ where: "own", home: "/home/dana", dataDir: data2, platform: "linux", exists: () => false }), data2, workFolder(data2, "usr_dana", "thr_1"), "linux");
  assert.deepEqual(fs.readdirSync(p.pathAdd[0]!).sort(), ["doas", "sudo"]);
});
