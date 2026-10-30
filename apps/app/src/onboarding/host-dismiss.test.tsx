// The host opens onboarding by itself on a first claim, "Finish later" takes it away and marks it seen, and a Space already seen never opens it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, mount } from "./test-dom.ts";
import { Text } from "react-native";
import { OnboardingHost } from "./OnboardingHost.tsx";
import type { CapCall } from "../shell/session/caps.ts";

function fake(seen: boolean) {
  const calls: string[] = [];
  const call = (async (cap: string) => {
    calls.push(cap);
    if (cap === "spaces.switcher") return { role: "Owner" };
    if (cap === "spaces.onboarding.flow") return { seen, steps: [] };
    if (cap === "spaces.onboarding.get") return { dismissed: false, steps: [] };
    if (cap === "providers.list") return { providers: [] };
    return { ok: true };
  }) as unknown as CapCall;
  return { calls, call };
}
const open = async (seen: boolean) => {
  const restore = installDom();
  const f = fake(seen);
  const root = await mount(createRoot, <OnboardingHost call={f.call} space={{ kind: "team", name: "Fresh Co" }}><Text testID="shell-body">shell</Text></OnboardingHost>);
  await flush(); await flush();
  return { ...f, root, restore };
};

test("onboarding opens over the shell on a first claim, and Finish later removes it and marks it seen", async () => {
  const t = await open(false);
  try {
    assert.ok(find(t.root, "onboarding"), "opened by itself");
    assert.ok(find(t.root, "shell-body"), "the shell is mounted under it");
    const seenBefore = t.calls.filter((c) => c === "spaces.onboarding.seen").length;
    await press(find(t.root, "onboarding-close"));
    await flush();
    assert.equal(find(t.root, "onboarding"), null, "Finish later removes it");
    assert.equal(find(t.root, "onboarding-rail"), null, "no rail left over the shell");
    assert.ok(find(t.root, "shell-body"));
    assert.ok(t.calls.filter((c) => c === "spaces.onboarding.seen").length > seenBefore, "closing marks it seen");
  } finally { t.restore(); }
});

test("a Space the person has already seen does not open onboarding over the shell", async () => {
  const t = await open(true);
  try {
    assert.equal(find(t.root, "onboarding"), null);
    assert.ok(find(t.root, "shell-body"));
  } finally { t.restore(); }
});
