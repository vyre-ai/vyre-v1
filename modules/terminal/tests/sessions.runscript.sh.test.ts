// The run script's own shell logic, run by a real sh against a stand-in tmux that prints a canned pane (lane r42-computer, review of 19 Nov): the end mark ends a run only as a whole line of its own.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunScript, RUN_SCRIPT } from "../impl.ts";

function runWith(pane: string, rc = "", deadlineMs = 1000): { status: string; screen: string } {
  const dir = mkdtempSync(join(tmpdir(), "vyre-rs-"));
  writeFileSync(join(dir, "pane"), pane);
  writeFileSync(
    join(dir, "tmux"),
    '#!/bin/sh\ncase "$*" in\n *capture-pane*) cat "$PANE"; case "$*" in *display-message*) printf \'__VYRE_X__%s|%s\' "$RCV" "";; esac;;\nesac\nexit 0\n',
  );
  chmodSync(join(dir, "tmux"), 0o755);
  const r = spawnSync(
    "sh",
    ["-c", RUN_SCRIPT, "sh", "sess", "line", "END_abc", "@rc", "100", String(deadlineMs), "@cx"],
    {
      env: { PATH: `${dir}:${process.env["PATH"] ?? ""}`, PANE: join(dir, "pane"), RCV: rc },
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  const p = parseRunScript(r.stdout);
  assert.ok(p, `the script's output parses: ${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}`);
  return { status: p.status, screen: p.screen };
}

test("the end mark ends a run only as a whole line of its own", { skip: process.platform === "win32" }, () => {
  assert.equal(runWith("$ cmd\nout\nEND_abc:7\n$ \n").status, "done", "a line of its own ends the run");
  assert.equal(
    runWith("$ echo hi; echo END_abc:1\nhi END_abc:1\n").status,
    "timeout",
    "the mark in the middle of a line does not",
  );
  assert.equal(runWith("out\nEND_abc:1 and more\n").status, "timeout", "more after the digits does not");
  assert.equal(runWith("out\nEND_abc:\n").status, "timeout", "no digits does not");
  assert.equal(runWith("out\nEND_abcX:1\n").status, "timeout", "another mark does not");
  assert.equal(runWith("no mark yet\n", "3").status, "done", "the stored exit code still ends it");
});
