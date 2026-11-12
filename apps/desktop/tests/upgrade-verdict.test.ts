// The update proof's decision on the first start of a new Windows app over the shipped app's profile (ci/upgrade-verdict.ts), from real logs and from a window left blank on purpose.
import test from "node:test";
import assert from "node:assert/strict";
import { rendersAfter, upgradeVerdict } from "../src-tauri/ci/upgrade-verdict.ts";

// run 43109353813 (win32-upgraded-start.log): the removal said twice, then the app drew. The proof of that night read only the text between the two removals and failed.
const DREW_AFTER_TWO_REMOVALS = [
  "vyre-desktop: page serviceworker: removed 1 service worker(s) an earlier version registered; loading again",
  "vyre-desktop: page serviceworker: removed 1 service worker(s) an earlier version registered; loading again",
  "vyre-desktop: update: the page asked before the lock screen: None",
  "vyre-desktop: sidecar ready at http://127.0.0.1:53177",
  "vyre-desktop: page rendered: 132 chars at http://tauri.localhost/chat",
  "",
].join("\n");

// a window left blank on purpose: the worker removed, three loads, still nothing drawn, the shell refuses a fourth and the notice is shown
const BLANK = [
  "vyre-desktop: page serviceworker: removed 1 service worker(s) an earlier version registered; loading again",
  "vyre-desktop: page recover serviceworker (load again, 1 of 3 this start): removed 1 service worker(s) an earlier version registered",
  "vyre-desktop: page rendered: 0 chars at http://tauri.localhost/",
  "vyre-desktop: page blank: drew nothing 8 s after loading: http://tauri.localhost/, readyState complete, title \"Vyre\", 1 element(s) in body, page 120 bytes, served by no worker",
  "vyre-desktop: page recover blank (load again, 2 of 3 this start): drew nothing 8 s after loading",
  "vyre-desktop: page rendered: 0 chars at http://tauri.localhost/",
  "vyre-desktop: page recover blank (load again, 3 of 3 this start): drew nothing 8 s after loading",
  "vyre-desktop: page rendered: 0 chars at http://tauri.localhost/",
  "vyre-desktop: page recover blank refused: the page already loaded itself again 3 times this start: drew nothing 8 s after loading",
  "vyre-desktop: page blank: showed the notice: Vyre did not open properly, with Open again",
  "",
].join("\n");

test("the night's failed run, read again: two removals, then 132 chars, is a pass", () => {
  assert.deepEqual(rendersAfter(DREW_AFTER_TWO_REMOVALS), [132]);
  const v = upgradeVerdict({ removed: true, firstLook: [132], log: DREW_AFTER_TWO_REMOVALS });
  assert.deepEqual(v.failures, []);
  assert.match(v.lines[0]!, /then 132 chars .*removals said 2 time\(s\)/);
});

test("the old reading of that log saw nothing: the piece between the two removals has no render report", () => {
  const old = [...(DREW_AFTER_TWO_REMOVALS.split("page serviceworker")[1] ?? "").matchAll(/page rendered: (\d+) chars/g)];
  assert.equal(old.length, 0);
});

test("a window that stays blank fails the proof, and the proof says what the window showed", () => {
  const v = upgradeVerdict({ removed: true, firstLook: [0, 0, 0], log: BLANK });
  assert.ok(v.failures.includes("upgrade: the app draws nothing after removing the earlier worker"));
  assert.ok(v.failures.includes("upgrade: the page kept loading itself again until the shell refused"));
  const showed = v.lines.find((l) => l.startsWith("what the window showed: "));
  assert.match(showed ?? "", /drew nothing 8 s after loading: http:\/\/tauri\.localhost\/, readyState complete/);
  assert.match(showed ?? "", /showed the notice: Vyre did not open properly/);
});

test("a window that drew and then went blank fails: the last report counts", () => {
  const log = "vyre-desktop: page serviceworker: removed 1 service worker(s) an earlier version registered; loading again\nvyre-desktop: page rendered: 132 chars at http://tauri.localhost/chat\nvyre-desktop: page rendered: 0 chars at http://tauri.localhost/\n";
  assert.ok(upgradeVerdict({ removed: true, firstLook: [132], log }).failures.includes("upgrade: the app draws nothing after removing the earlier worker"));
});

test("no removal seen fails, and with no render report at all the proof says the probe never ran", () => {
  const v = upgradeVerdict({ removed: false, firstLook: [], log: "vyre-desktop: sidecar ready at http://127.0.0.1:1\n" });
  assert.ok(v.failures.includes("upgrade: the earlier version's service worker was not removed"));
  assert.ok(v.failures.includes("upgrade: the app draws nothing after removing the earlier worker"));
});

test("drawn only after the blank recovery passes, with a NOTE that says so", () => {
  const log = "vyre-desktop: page serviceworker: removed 1 service worker(s) an earlier version registered; loading again\nvyre-desktop: page rendered: 0 chars at http://tauri.localhost/\nvyre-desktop: page recover blank (load again, 2 of 3 this start): x\nvyre-desktop: page rendered: 132 chars at http://tauri.localhost/chat\n";
  const v = upgradeVerdict({ removed: true, firstLook: [0], log });
  assert.deepEqual(v.failures, []);
  assert.ok(v.lines.some((l) => /drew only after the shell's blank-window recovery/.test(l)));
});
