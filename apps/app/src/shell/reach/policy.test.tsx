// The link policy and the rows that read it (lane l-chrome2a, owner 4 Nov): every link on screen is asked about in one call, and renders right before it is pressed: live, or plain text with no
// pointer, so there is no click that goes nowhere. The door reads the same answers.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press } from "../../../../../ui/src/testing/dom.ts";
import { LinkPolicyProvider } from "../../../../../ui/src/reach/index.tsx";
import { ReachRow } from "../../../../../ui/src/Row/ReachRow.tsx";
import { createLinkPolicy, keyOf } from "./policy.ts";
import { judge } from "./target.ts";
import type { Judge } from "./target.ts";

type Level = "none" | "view" | "manage";
const fakeCall = (levels: Record<string, Level>, calls: Array<{ cap: string; input: { items: Array<{ type: string; id: string }> } }>) => async (cap: string, input: unknown) => {
  const i = input as { items: Array<{ type: string; id: string }> };
  calls.push({ cap, input: i });
  return { items: i.items.map((x) => ({ type: x.type, id: x.id, level: levels[`${x.type}:${x.id}`] ?? "view" })) };
};

test("every link on screen is asked about in one call, and a thing the person cannot open draws plain", async () => {
  const calls: Array<{ cap: string; input: { items: Array<{ type: string; id: string }> } }> = [];
  const p = createLinkPolicy({ call: fakeCall({ "task:tsk_2": "none", "thread:thr_9": "none" }, calls) });
  p.prefetch([{ type: "task", id: "tsk_1" }, { type: "task", id: "tsk_2" }, { type: "chat", id: "thr_9" }, { type: "file", id: "fil_1" }, { type: "goal", id: "gl_1" }]);
  assert.deepEqual(p.stateOf({ type: "task", id: "tsk_2" }), { state: "live" }, "not known yet: live, and asked");
  await p.settled();
  assert.equal(calls.length, 1, "one call for all of them");
  assert.deepEqual(calls[0]!.input.items.map((x) => `${x.type}:${x.id}`).sort(), ["file:fil_1", "task:tsk_1", "task:tsk_2", "thread:thr_9"], "a goal is not judged by the Space's access; a chat is a thread");
  assert.deepEqual(p.stateOf({ type: "task", id: "tsk_2" }), { state: "plain" });
  assert.deepEqual(p.stateOf({ type: "chat", id: "thr_9" }), { state: "plain" }, "a chat and a thread are the same thing");
  assert.deepEqual(p.stateOf({ type: "task", id: "tsk_1" }), { state: "live" });
  assert.deepEqual(p.stateOf({ type: "goal", id: "gl_1" }), { state: "live" });
  p.prefetch([{ type: "task", id: "tsk_1" }, { type: "task", id: "tsk_2" }]);
  await p.settled();
  assert.equal(calls.length, 1, "what is known is not asked again");
});

test("a Space that does not answer leaves links live and asks again the next time they are seen", async () => {
  let n = 0;
  const p = createLinkPolicy({ call: async () => { n++; if (n === 1) throw new Error("down"); return { items: [{ type: "task", id: "tsk_1", level: "none" }] }; } });
  p.prefetch([{ type: "task", id: "tsk_1" }]);
  await p.settled();
  assert.deepEqual(p.stateOf({ type: "task", id: "tsk_1" }), { state: "live" });
  p.prefetch([{ type: "task", id: "tsk_1" }]);
  await p.settled();
  assert.deepEqual(p.stateOf({ type: "task", id: "tsk_1" }), { state: "plain" });
});

test("a row for a thing the person cannot open is plain text: no pointer, no press, and nothing fires", async () => {
  const restore = installDom();
  try {
    const calls: Array<{ cap: string; input: { items: Array<{ type: string; id: string }> } }> = [];
    const p = createLinkPolicy({ call: fakeCall({ "file:fil_no": "none" }, calls) });
    let opened = 0;
    const tree = (
      <LinkPolicyProvider value={p}>
        <ReachRow id="no" title="Private deed" subject={{ type: "file", id: "fil_no" }} onPress={() => { opened++; }} />
        <ReachRow id="yes" title="Shared deed" subject={{ type: "file", id: "fil_yes" }} onPress={() => { opened++; }} />
      </LinkPolicyProvider>
    );
    const root = await mount(createRoot, tree);
    await p.settled();
    await flush();
    assert.equal(calls.length, 1, "both rows asked in one call");
    const no = find(root, "row-no")!;
    const yes = find(root, "row-yes")!;
    assert.equal(no.props.onClick, undefined, "the refused row has nothing to press");
    assert.equal(no.props.role, "listitem");
    assert.equal(String((no.props.style as { cursor?: string }).cursor), "default");
    assert.equal(no.props.className, "vyre-row-plain", "no hover paint");
    await press(yes);
    assert.equal(opened, 1, "the allowed row opens");
  } finally { restore(); }
});

test("a click reads the answer the link was drawn from: nothing is read a second time", async () => {
  const calls: Array<{ cap: string; input: { items: Array<{ type: string; id: string }> } }> = [];
  const links = createLinkPolicy({ call: fakeCall({ "task:tsk_x": "none" }, calls) });
  links.prefetch([{ type: "task", id: "tsk_x" }, { type: "task", id: "tsk_ok" }]);
  await links.settled();
  let reads = 0;
  const j: Judge = { viewer: () => ({ id: "u" }), consolePages: async () => new Set(), call: async () => { reads++; return {}; }, memo: new Map(), links };
  assert.equal((await judge({ subject: { type: "task", id: "tsk_x" } }, j)).to, "none");
  assert.equal((await judge({ subject: { type: "task", id: "tsk_ok" } }, j)).to, "open");
  assert.equal(reads, 0);
  assert.equal(keyOf({ type: "chat", id: "a" }), "thread:a");
});
