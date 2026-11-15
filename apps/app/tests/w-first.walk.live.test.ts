// The walker's first pass, fixed (w-first, 15 Nov 2026): a real browser on a booted team Space presses what the walker pressed: New goal from the sidebar lands in a working goal, an agent is shared from its page,
// Share with everyone opens under its button, no id or permission code is on any Console page or agent tab, the invite link is made from the address the Space is reached at, Quick actions opens the invite sheet,
// a member opens a public channel by its link, a message waiting for an AI account is sent again once an account is added, a new note starts in its title, and Files, New offers only new things. It also takes the
// pictures (dark and light desktop, light phone). The steps live in scripts/shots/first-hour-team.mjs (ids wf-*); this file runs them against the export and fails on any failed step.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const STEPS = [
  "wf-getting-started-fresh",
  "wf-new-goal",
  "wf-agent-share",
  "wf-people-share-everyone",
  "wf-words-scan",
  "wf-console-home-words",
  "wf-invite-link",
  "wf-public-channel",
  "wf-connect-after",
  "wf-pictures",
  "wf-notes-and-files",
];

test("the walker's first pass: every wf step passes in a real browser on a booted Space", { timeout: 900_000 }, () => {
  const dist = process.env["VYRE_APP_DIST"];
  assert.ok(dist, "VYRE_APP_DIST (the web export) is needed");
  const out = process.env["VYRE_TEST_CAPTURE_DIR"] ?? fs.mkdtempSync(path.join(os.tmpdir(), "w-first-"));
  const r = spawnSync(
    process.execPath,
    ["scripts/shots/first-hour.mjs", path.join(out, "w-first"), "--only=team", "--skip-export", `--dist=${dist}`],
    { cwd: REPO, env: { ...process.env, FH_STEPS: STEPS.join(",") }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const lines = `${r.stdout}\n${r.stderr}`.split("\n");
  const failed = lines.filter((l) => /^FAIL /.test(l));
  assert.deepEqual(failed, [], failed.join("\n"));
  for (const id of STEPS) assert.ok(lines.some((l) => l.startsWith(`ok   team/${id}`)), `${id} did not run`);
  assert.equal(r.status, 0, lines.slice(-8).join("\n"));
});
