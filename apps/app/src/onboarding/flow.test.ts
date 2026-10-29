import test from "node:test";
import assert from "node:assert/strict";
import { counts, flowFor, isStepKey, nextAfter, resumeAt, shouldAutoOpen, stepsOf } from "./flow.ts";

test("each flow has unique step keys and the owner flowchart order", () => {
  for (const f of ["personal", "team", "member"] as const) assert.equal(new Set(stepsOf(f).map((s) => s.key)).size, stepsOf(f).length);
  assert.deepEqual(stepsOf("personal").map((s) => s.key), ["ai", "interview", "sessions", "folders", "chrome", "phone", "win", "team"]);
  assert.equal(stepsOf("team").length, 9, "the nine team steps");
  assert.equal(stepsOf("member")[1]!.card, "connect_ai", "a member's own AI account");
});

test("resume opens the first open step, then the first put off, then nothing", () => {
  assert.equal(resumeAt("personal", {}), "ai");
  assert.equal(resumeAt("personal", { ai: "done", interview: "later" }), "sessions");
  const all = Object.fromEntries(stepsOf("member").map((s) => [s.key, "done" as const]));
  assert.equal(resumeAt("member", all), null);
  assert.equal(resumeAt("member", { ...all, apps: "later" }), "apps");
});

test("skipping moves on and the skipped step stays on the rail as later", () => {
  const p = { ai: "later" as const };
  assert.equal(nextAfter("personal", p, "ai"), "interview");
  assert.deepEqual(counts("personal", p), { done: 0, later: 1, total: 8 });
  assert.equal(nextAfter("personal", { ...Object.fromEntries(stepsOf("personal").map((s) => [s.key, "done"])), ai: "later" }, "team"), "ai", "wraps to a step put off");
});

test("which flow, and when it opens by itself", () => {
  assert.equal(flowFor({ kind: "personal" }, true), "personal");
  assert.equal(flowFor({ kind: "team" }, true), "team");
  assert.equal(flowFor({ kind: "team" }, false), "member");
  assert.equal(shouldAutoOpen("member", {}, false), true);
  assert.equal(shouldAutoOpen("member", {}, true), false, "seen once: only the checklist reopens it");
  assert.equal(isStepKey("team", "org"), true);
  assert.equal(isStepKey("team", "nope"), false);
});
