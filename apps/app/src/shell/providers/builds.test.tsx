// The doors that hand the assistant a connector task (Build a connector, Bring in from your CRM, Edit mapping) go through one hook. A member never gets them; an admin does, with the words that pressing
// also allows the assistant; opening a page grants nothing, even in a Personal Space; a press allows first and a refusal is said, never swallowed. Forcing the gate to "ready" turns this red.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { installDom, mount } from "../../../../../ui/src/testing/dom.ts";
import { useAssistantBuilds } from "./builds.ts";
import type { Builds } from "./builds.ts";
import type { ShellRuntime } from "./runtime.tsx";
import { ALLOW_BUILD_LINE, readyToBuild } from "../../places/vault/itemenv/automations.ts";

installDom();
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

function rtWith(status: { allowed: boolean; canGrant: boolean }, personal = false) {
  const calls: string[] = [];
  const rt = {
    assistant: { id: "agt_a", name: "Assistant" },
    space: { id: "spc_1", kind: personal ? "personal" : "team", name: "S" },
    call: async (cap: string) => {
      calls.push(cap);
      return cap === "access.connector_builder.status" ? status : {};
    },
  } as unknown as ShellRuntime;
  return { rt, calls };
}
async function hook(rt: ShellRuntime): Promise<{ get(): Builds }> {
  let latest: Builds | null = null;
  const Probe = (): ReactElement | null => {
    latest = useAssistantBuilds(rt);
    return null;
  };
  await mount(createRoot, <Probe />);
  await settle();
  return { get: () => latest! };
}

test("a member's assistant gets no door; an admin gets it, with the words that the press also allows the assistant", async () => {
  const member = rtWith({ allowed: false, canGrant: false });
  assert.equal((await hook(member.rt)).get().builds, false);
  const admin = rtWith({ allowed: false, canGrant: true });
  const h = await hook(admin.rt);
  assert.equal(h.get().builds, true);
  assert.equal(h.get().note, ALLOW_BUILD_LINE);
  const ready = rtWith({ allowed: true, canGrant: true });
  const r = await hook(ready.rt);
  assert.equal(r.get().builds, true);
  assert.equal(r.get().note, null, "nothing to say once it is allowed");
});

test("opening a page grants nothing, in a team Space or a Personal one", async () => {
  for (const personal of [false, true]) {
    const w = rtWith({ allowed: false, canGrant: true }, personal);
    await hook(w.rt);
    assert.equal(w.calls.includes("access.connector_builder.grant"), false, `personal=${personal}`);
  }
});

test("a press allows first; a member's press grants nothing and refuses in words", async () => {
  const admin = rtWith({ allowed: false, canGrant: true });
  await hook(admin.rt).then((h) => h.get().prepare());
  assert.ok(admin.calls.includes("access.connector_builder.grant"));
  const member = rtWith({ allowed: false, canGrant: false });
  await assert.rejects(
    hook(member.rt).then((h) => h.get().prepare()),
    /needs permission to build connectors/,
  );
  assert.equal(member.calls.includes("access.connector_builder.grant"), false);
});

test("readyToBuild: grant only for an assistant that can be given the role; never for a member, never when it cannot reach the item", async () => {
  const run = async (st: unknown) => {
    const calls: string[] = [];
    let error = "";
    try {
      await readyToBuild(async (cap) => (calls.push(cap), st), "agt_a", "vit_x");
    } catch (e) {
      error = (e as Error).message;
    }
    return { grants: calls.filter((c) => c.endsWith(".grant")).length, error };
  };
  assert.deepEqual(await run({ allowed: false, canGrant: true, reaches: true }), { grants: 1, error: "" });
  assert.equal((await run({ allowed: false, canGrant: false, reaches: true })).grants, 0);
  assert.match((await run({ allowed: false, canGrant: false, reaches: true })).error, /needs permission/);
  const out = await run({ allowed: false, canGrant: true, reaches: false });
  assert.equal(out.grants, 0);
  assert.match(out.error, /cannot open that Vault item/);
  assert.equal(
    (await run({ allowed: true, canGrant: false, reaches: true })).grants,
    0,
    "already allowed: nothing to give",
  );
});
