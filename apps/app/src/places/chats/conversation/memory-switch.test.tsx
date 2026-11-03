// "Don't remember this chat" (owner decision D11, 3 Nov 2026): off by default, one switch in the composer, its state read from and written to memory's own store
// (memory.chat_learning.get and .set), and one quiet line while it is on. That a turn then has no learning pass is lane l-memlearn's shouldLearn, tested there.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { find, flush, installDom, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import { MemorySwitch, QUIET_LINE, SWITCH_LABEL, rememberOf } from "./memory-switch.tsx";

test("off by default: a chat memory cannot answer for is remembered, and nothing quiet is shown", () => {
  assert.equal(rememberOf(undefined), true);
  assert.equal(rememberOf({ remember: true }), true);
  assert.equal(rememberOf({ remember: false }), false);
  const out = renderToStaticMarkup(<MemorySwitch threadId="thr_1" call={() => new Promise(() => undefined)} say={() => undefined} />).replaceAll("&#x27;", "'");
  assert.ok(out.includes(`aria-label="${SWITCH_LABEL}"`) && out.includes('aria-checked="false"'));
  assert.ok(!out.includes(QUIET_LINE));
  assert.ok(!out.includes("pill"));
});

test("turning it on writes remember: false to memory and shows the quiet line; pressing again remembers the chat", async () => {
  const restore = installDom();
  try {
    const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
    let remember = true;
    const call = async (cap: string, input: unknown): Promise<unknown> => {
      const i = input as Record<string, unknown>;
      calls.push({ cap, input: i });
      if (cap === "memory.chat_learning.set") remember = i["remember"] === true;
      return { threadId: "thr_1", remember };
    };
    const said: string[] = [];
    const root = await mount(createRoot, <MemorySwitch threadId="thr_1" call={call} say={(l) => said.push(l)} />);
    assert.deepEqual(calls[0], { cap: "memory.chat_learning.get", input: { threadId: "thr_1" } }, "the state is read from memory");
    await press(find(root, "memory-switch"));
    await flush();
    assert.deepEqual(calls.at(-1), { cap: "memory.chat_learning.set", input: { threadId: "thr_1", remember: false } });
    assert.ok(textOf(find(root, "memory-off-line")).includes(QUIET_LINE));
    assert.equal(find(root, "memory-switch")?.props["aria-checked"], true);
    await press(find(root, "memory-switch"));
    await flush();
    assert.deepEqual(calls.at(-1), { cap: "memory.chat_learning.set", input: { threadId: "thr_1", remember: true } });
    assert.equal(find(root, "memory-off-line"), null);
    assert.deepEqual(said, ["Nothing from this chat will be remembered", "This chat is remembered again"]);
  } finally { restore(); }
});

test("a chat memory already holds as not remembered opens with the quiet line; a refused change puts the switch back", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <MemorySwitch threadId="thr_2" call={async (cap) => { if (cap === "memory.chat_learning.set") throw new Error("no"); return { remember: false }; }} say={() => undefined} />);
    assert.ok(find(root, "memory-off-line"));
    await press(find(root, "memory-switch"));
    await flush();
    assert.ok(find(root, "memory-off-line"), "still not remembered");
  } finally { restore(); }
});
