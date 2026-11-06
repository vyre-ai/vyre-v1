// Codex inside Vyre's sandbox (lane l-codex, 6 Nov 2026): where Codex's own sandbox cannot start inside ours, a writable run is told its own sandbox is off, and nothing else changes.
import test from "node:test";
import assert from "node:assert/strict";
import { codexInWall, nestedSandboxWorks } from "../sandbox.ts";

const WRITABLE = ["/home/x/.local/bin/codex", "exec", "--json", "-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="never"', "-"];
const READONLY = WRITABLE.map((a) => (a === 'sandbox_mode="workspace-write"' ? 'sandbox_mode="read-only"' : a));

test("a nested sandbox works as a normal user on Linux and in WSL, not as root there and not on a Mac", () => {
  assert.equal(nestedSandboxWorks("bwrap", 1000), true);
  assert.equal(nestedSandboxWorks("bwrap", 0), false);
  assert.equal(nestedSandboxWorks("seatbelt", 501), false);
  assert.equal(nestedSandboxWorks("wsl", null), true);
  assert.equal(nestedSandboxWorks("bwrap", null), true);
});

test("where it cannot, a writable Codex run turns its own sandbox off and stays inside Vyre's; a read-only run is left read-only", () => {
  assert.deepEqual(codexInWall(WRITABLE, false), WRITABLE.map((a) => (a === 'sandbox_mode="workspace-write"' ? 'sandbox_mode="danger-full-access"' : a)));
  assert.deepEqual(codexInWall(READONLY, false), READONLY);
});

test("where it can, nothing changes; and no other program is touched", () => {
  assert.deepEqual(codexInWall(WRITABLE, true), WRITABLE);
  const other = ["claude", "-p", "-c", 'sandbox_mode="workspace-write"'];
  assert.deepEqual(codexInWall(other, false), other);
  assert.deepEqual(codexInWall(["C:\\bin\\codex.exe", "exec", 'sandbox_mode="workspace-write"'], false), ["C:\\bin\\codex.exe", "exec", 'sandbox_mode="danger-full-access"']);
});
