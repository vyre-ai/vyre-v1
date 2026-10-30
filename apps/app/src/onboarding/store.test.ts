import test from "node:test";
import assert from "node:assert/strict";
import { flowOfSession, loadFlow, markSeen, markStep, openOnboarding, registerOnboardingOpener, usedChecklistBefore } from "./store.ts";
import type { CapCall } from "../shell/session/caps.ts";

const fake = (answers: Record<string, unknown>): { call: CapCall; calls: Array<[string, unknown]> } => {
  const calls: Array<[string, unknown]> = [];
  return { calls, call: (async (cap: string, input: unknown) => { calls.push([cap, input]); return answers[cap]; }) as unknown as CapCall };
};

test("progress loads as a map and marks go to the Space", async () => {
  const f = fake({ "spaces.onboarding.flow": { seen: true, steps: [{ key: "ai", state: "done" }, { key: "phone", state: "later" }] } });
  assert.deepEqual(await loadFlow(f.call, "personal"), { seen: true, progress: { ai: "done", phone: "later" } });
  await markStep(f.call, "team", "org", "done");
  await markSeen(f.call, "member");
  assert.deepEqual(f.calls.slice(1), [["spaces.onboarding.mark", { flow: "team", step: "org", state: "done" }], ["spaces.onboarding.seen", { flow: "member" }]]);
});

test("the flow follows the Space kind and the role", async () => {
  assert.equal(await flowOfSession(fake({}).call, "personal"), "personal");
  assert.equal(await flowOfSession(fake({ "spaces.switcher": { role: "Owner" } }).call, "team"), "team");
  assert.equal(await flowOfSession(fake({ "spaces.switcher": { role: "Member" } }).call, "team"), "member");
});

test("the opener reaches the host while it is mounted and stops after", () => {
  assert.equal(openOnboarding("ai"), false);
  const seen: Array<string | undefined> = [];
  const off = registerOnboardingOpener((s) => seen.push(s));
  assert.equal(openOnboarding("phone"), true);
  off();
  assert.equal(openOnboarding(), false);
  assert.deepEqual(seen, ["phone"]);
});

test("a person who used the old checklist is not greeted by the screen", async () => {
  assert.equal(await usedChecklistBefore(fake({ "spaces.onboarding.get": { dismissed: false, steps: [{ done: false }] } }).call), false);
  assert.equal(await usedChecklistBefore(fake({ "spaces.onboarding.get": { dismissed: true, steps: [] } }).call), true);
  assert.equal(await usedChecklistBefore(fake({ "spaces.onboarding.get": { dismissed: false, steps: [{ done: true }] } }).call), true);
});
