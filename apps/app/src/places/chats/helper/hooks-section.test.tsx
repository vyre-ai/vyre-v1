// The hooks section for a place that has only a thread id and the capability door (lane l-hooks): it reads hooks.list for the helper's thread and draws From <lead> and Inherited rows.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { HelperHooksSection } from "./HelperHooks.tsx";

const h = (id: string, scope: string, threadId: string | undefined, line: string) => ({ id, scope, threadId, line, kind: "check", spec: { instruction: "x" }, event: "tool.before", matcher: "", paused: false, madeBy: "agt_a", madeByKind: "agent", helpers: true, timeoutSec: 20, createdAt: 1, updatedAt: 1, mine: false, canChange: false });

test("a helper's hooks are asked for by its thread: its own say From the lead, the rest Inherited; none draws nothing", async () => {
  const off = installDom();
  try {
    const calls: Array<{ cap: string; input: unknown }> = [];
    const call = async (cap: string, input: unknown) => { calls.push({ cap, input }); return { hooks: [h("hok_own", "run", "thr_h", "before a helper acts, ask"), h("hok_run", "run", "thr_p", "before any search, no names"), h("hok_sp", "space", undefined, "before each message, rules"), h("hok_chat", "chat", "thr_p", "before any email, check Contacts")] }; };
    const root = await mount(createRoot, <HelperHooksSection threadId="thr_h" call={call} lead="Research" name="Firms 1-3" />);
    await flush();
    assert.deepEqual(calls, [{ cap: "hooks.list", input: { threadId: "thr_h" } }]);
    assert.match(textOf(find(root, "helper-hooks")), /Hooks for Firms 1-3/);
    assert.match(textOf(find(root, "helper-hook-hok_own")), /From Research/);
    assert.match(textOf(find(root, "helper-hook-hok_run")), /Inherited/);
    assert.match(textOf(find(root, "helper-hook-hok_sp")), /Inherited/);
    assert.match(textOf(find(root, "helper-hook-hok_chat")), /From this chat/, "the chat's own rule binds the helper and says so");
    const none = await mount(createRoot, <HelperHooksSection threadId="thr_h" call={async () => ({ hooks: [] })} lead="Research" name="x" />);
    await flush();
    assert.equal(find(none, "helper-hooks"), null);
  } finally { off(); }
});
