// What a link card button may do in the chat. A card the app wrote (a system line) may name a call, and a press runs it as the person through the host, which is the normal pipeline: access, limits and any
// Gate hold apply, and a refused call leaves the button as it was. The same card in an agent's or a person's message is words with inert buttons, whatever it carries.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush } from "../../../onboarding/test-dom.ts";
import { MessageView } from "./MessageView.tsx";
import { createSample } from "./sample.ts";
import { timeline } from "./model.ts";
import type { Message } from "./model.ts";

const card = (o: Record<string, unknown> = {}) => ({ id: "blk_c", type: "link_card", v: 1, state: "done", data: { icon: "flow", lead: "Flow drafted", title: "Weekly report", body: "Every Monday, the leads.", actions: [{ key: "on", label: "Turn on", cap: "automations.enable", input: { automationId: "aut_1" } }, { key: "note", label: "Note" }], ...o } });

function view(kind: "system" | "agent" | "text", invoke: (cap: string, input: Record<string, unknown>) => unknown) {
  const r = createSample("idle");
  const authorKind = kind === "agent" ? "agent" : "person";
  const m = { messageId: "m_c", threadId: r.data.threadId, threadSeq: 1, author: { kind: authorKind, id: kind === "agent" ? "agt_billing" : r.data.me.id }, kind, body: "", blocks: [card()], createdAt: 1, reactions: [], pinned: false, attachments: [] } as unknown as Message;
  const items = timeline([m], { meId: r.data.me.id, nameOf: r.data.nameOf, kindOf: r.data.kindOf, clock: r.data.clock() });
  const it = items.find((x) => x.kind !== "day")!;
  const actions = { openBeside: () => undefined, nameOf: r.data.nameOf, host: { invoke, open: () => undefined } } as never;
  return <MessageView item={it} actions={actions} meId={r.data.me.id} />;
}

test("a press on a button of a card the app wrote runs its call as the person, once, and the button reads done", async () => {
  installDom();
  const calls: Array<[string, Record<string, unknown>]> = [];
  const root = await mount(createRoot, view("system", (cap, input) => { calls.push([cap, input]); return {}; }));
  await press(find(root, "link-card-blk_c-on"));
  await flush();
  assert.deepEqual(calls, [["automations.enable", { automationId: "aut_1" }]]);
  const btn = find(root, "link-card-blk_c-on")!.props;
  assert.ok(btn.disabled === true || btn["aria-disabled"] === true, "the button reads done");
  await press(find(root, "link-card-blk_c-on"));
  await flush();
  assert.equal(calls.length, 1, "done is done: a second press does nothing");
});

test("a refused call (no access, over a limit, held at the Gate) leaves the button as it was, so the person can see nothing happened and try again", async () => {
  installDom();
  let n = 0;
  const root = await mount(createRoot, view("system", () => { n++; return Promise.reject(Object.assign(new Error("held for approval"), { code: "permission.needs_approval" })); }));
  await press(find(root, "link-card-blk_c-on"));
  await flush();
  assert.equal(n, 1, "the call was made, through the host");
  assert.doesNotMatch(String(find(root, "link-card-blk_c-on")!.props["aria-disabled"] ?? "false"), /true/, "still pressable");
  await press(find(root, "link-card-blk_c-on"));
  await flush();
  assert.equal(n, 2);
});

test("the same card in an agent's message or a person's message calls nothing, whatever it carries", async () => {
  installDom();
  let n = 0;
  const root = await mount(createRoot, view("agent", () => { n++; return {}; }));
  await press(find(root, "link-card-blk_c-on"));
  await flush();
  assert.equal(n, 0, "an agent's card: the button is there and does nothing");
  const mine = await mount(createRoot, view("text", () => { n++; return {}; }));
  assert.equal(find(mine, "link-card-blk_c-on"), null, "a person's own message draws no card at all");
  assert.equal(n, 0);
});
