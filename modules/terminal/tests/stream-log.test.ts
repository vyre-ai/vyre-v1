// F65: the live view's log is private, holds only what has not been read, is removed with the session, and the wrapper line is never shown.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  START_SCRIPT,
  READ_SCRIPT,
  STOP_SCRIPT,
  SWEEP_SCRIPT,
  createRunLineFilter,
  parseRead,
  streamFile,
} from "../stream-log.ts";
import { hideRunLine } from "../projections.ts";

// a tmux that only records what it was asked, so the real scripts run as they are
function rig(): { env: NodeJS.ProcessEnv; calls: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-streamlog-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const calls = path.join(dir, "tmux.calls");
  fs.writeFileSync(path.join(bin, "tmux"), `#!/bin/sh\necho "$@" >> '${calls}'\n`, { mode: 0o755 });
  return { env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}` }, calls, dir };
}
const sh = (script: string, args: string[], env: NodeJS.ProcessEnv): string =>
  execFileSync("sh", ["-c", script, "sh", ...args], { env, encoding: "utf8" });
const folder = `/tmp/.vyre-stream-${process.getuid?.() ?? 0}`;

test("the log is in a folder only its user can open, and is a 600 file", () => {
  const r = rig();
  const name = streamFile("vyre-trm_priv");
  try {
    sh(START_SCRIPT, ["vyre-trm_priv", name], r.env);
    assert.equal((fs.statSync(folder).mode & 0o777).toString(8), "700");
    assert.equal((fs.statSync(path.join(folder, name)).mode & 0o777).toString(8), "600");
    assert.match(fs.readFileSync(r.calls, "utf8"), /pipe-pane -t vyre-trm_priv cat >> '.*vyre-trm_priv'/);
  } finally {
    sh(STOP_SCRIPT, ["vyre-trm_priv", name], r.env);
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test("what a read takes is gone from the file, so no history of secrets is kept", () => {
  const r = rig();
  const name = streamFile("vyre-trm_hist");
  try {
    sh(START_SCRIPT, ["vyre-trm_hist", name], r.env);
    const file = path.join(folder, name);
    fs.appendFileSync(file, "export API_KEY=sk-live-1234567890abcdef\n");
    const first = parseRead(sh(READ_SCRIPT, ["0", name], r.env));
    assert.equal(first.bytes.toString(), "export API_KEY=sk-live-1234567890abcdef\n");
    assert.equal(first.emptied, true);
    assert.equal(fs.readFileSync(file, "utf8"), "", "the secret is no longer in the file");
    fs.appendFileSync(file, "more\n");
    assert.equal(parseRead(sh(READ_SCRIPT, ["0", name], r.env)).bytes.toString(), "more\n");
  } finally {
    sh(STOP_SCRIPT, ["vyre-trm_hist", name], r.env);
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test("the log is removed when the session ends, and a sweep removes what a run left", () => {
  const r = rig();
  const a = streamFile("vyre-trm_end");
  const b = streamFile("vyre-trm_left");
  try {
    sh(START_SCRIPT, ["vyre-trm_end", a], r.env);
    sh(START_SCRIPT, ["vyre-trm_left", b], r.env);
    sh(STOP_SCRIPT, ["vyre-trm_end", a], r.env);
    assert.equal(fs.existsSync(path.join(folder, a)), false);
    assert.equal(fs.existsSync(path.join(folder, b)), true);
    sh(SWEEP_SCRIPT, [], r.env);
    assert.equal(fs.existsSync(path.join(folder, b)), false);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

const WRAPPER =
  "$ printf '%s\\n' '__VYRE_BEG_ab12cd__'; { echo hi; }; __vyre_rc=$?; printf '%s\\n' \"__VYRE_END_ab12cd__:$__vyre_rc\"; unset __vyre_rc\r\n";

test("the wrapper line of terminal.run is never shown in the live view, whole or split across frames", () => {
  for (const cut of [WRAPPER.length, 30, 7]) {
    const f = createRunLineFilter(hideRunLine);
    let seen = f.push(WRAPPER.slice(0, cut)) + (cut < WRAPPER.length ? f.push(WRAPPER.slice(cut)) : "");
    seen += f.flush();
    assert.ok(!seen.includes("__VYRE_"), `cut ${cut}: ${JSON.stringify(seen)}`);
    assert.ok(!seen.includes("__vyre_rc"), `cut ${cut}: ${JSON.stringify(seen)}`);
    assert.ok(seen.includes("echo hi"), `the person still sees the command: ${JSON.stringify(seen)}`);
  }
});

test("ordinary output passes through at once", () => {
  const f = createRunLineFilter(hideRunLine);
  assert.equal(f.push("hello\r\n"), "hello\r\n");
  assert.equal(f.push("agent@workspace:~$ "), "agent@workspace:~$ ");
  assert.equal(f.push("ls\r\n"), "ls\r\n");
});
