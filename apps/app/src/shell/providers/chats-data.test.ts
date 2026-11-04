// The Chats sidebar's doors from the real runtime (lane l-chrome2a): a project row opens its page through the shell's one door. The unit tests of the sidebar use a sample; this is the real wiring, which a
// real-browser walk found missing.
import test from "node:test";
import assert from "node:assert/strict";
import { sidebarData } from "./chats-data.ts";

test("the sidebar's nav opens a project by subject through rt.open", () => {
  const opened: unknown[] = [];
  const rt = { open: (t: unknown) => opened.push(t), call: async () => ({}), me: { id: "u", name: "U" }, space: { id: "s", kind: "team", name: "N" }, assistant: { id: "agt_a", name: "A" }, clock: () => ({ now: 1, offsetMin: 0 }), principals: { getSnapshot: () => ({ status: "ready", data: [] }), subscribe: () => () => undefined }, screens: { query: () => ({ getSnapshot: () => ({ status: "loading" }), subscribe: () => () => undefined }) }, connection: { get: () => "online", subscribe: () => () => undefined }, isDeferred: () => false } as never;
  const data = sidebarData(rt, { openThread: () => undefined, openAgentChat: () => undefined, togglePane: () => undefined } as never);
  assert.equal(typeof data.nav.openProject, "function", "the sidebar can open a project");
  data.nav.openProject!("prj_1");
  assert.deepEqual(opened, [{ subject: { type: "project", id: "prj_1" } }]);
});
