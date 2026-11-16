// Shared by the w-first walk files: runs some wf-* steps of scripts/shots/first-hour-team.mjs (the owner's browser on a booted team Space, a second member) against the web export and fails on any failed step.
// Without the export or a Chromium the walk SKIPS with its reason, as the other browser walks do (browserOrSkip); VYRE_REQUIRE_CHROME=1 turns that into a failure.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { browserOrSkip } from "./support/mail-browser.ts";

const REPO = fileURLToPath(new URL("..", import.meta.url));

export async function runWalk(t: TestContext, steps: readonly string[]): Promise<void> {
  const b = await browserOrSkip();
  if (typeof b === "string") {
    t.skip(b);
    return;
  }
  const out = process.env["VYRE_TEST_CAPTURE_DIR"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "w-first-"));
  const r = spawnSync(
    process.execPath,
    [
      "scripts/shots/first-hour.mjs",
      path.join(out, `w-first-${steps[0]}`),
      "--only=team",
      "--skip-export",
      `--dist=${b.dist}`,
    ],
    {
      cwd: REPO,
      env: { ...process.env, FH_STEPS: steps.join(","), CHROME_BIN: b.exe },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const lines = `${r.stdout}\n${r.stderr}`.split("\n");
  const failed = lines.filter((l) => /^FAIL /.test(l));
  assert.deepEqual(failed, [], failed.join("\n"));
  for (const id of steps)
    assert.ok(
      lines.some((l) => l.startsWith(`ok   team/${id}`)),
      `${id} did not run`,
    );
  assert.equal(r.status, 0, lines.slice(-8).join("\n"));
}
