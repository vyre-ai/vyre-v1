// An agent's message to a teammate for its person (lane l-agentdm), as the teammate reads it: "<Person> (Agent)" with the person's face, a quiet line to mute that person's agents for today, the same
// in the message menu; the person who sent it sees the credit and no mute; the server's own blocks never draw as cards.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageView, menuFor } from "./MessageView.tsx";
import { onBehalfOf, timeline } from "./model.ts";
import type { Message } from "./model.ts";
import { wantsPhrase, heldOf } from "./approval-model.ts";

const NAMES: Record<string, string> = { usr_dana: "Dana Reyes", usr_maya: "Maya Chen", agt_intake: "Intake" };
const nameOf = (id: string): string => NAMES[id] ?? id;
const kindOf = (id: string): "person" | "agent" => (id.startsWith("agt_") ? "agent" : "person");
const clock = { now: Date.UTC(2025, 9, 9, 10, 0), zone: "UTC" } as never;
const m: Message = {
  messageId: "msg_dm1", threadId: "thr_dm", threadSeq: 1, author: { kind: "agent", id: "agt_intake" }, kind: "agent", body: "The Rivera draft is ready for you.",
  blocks: [{ id: "blk_ob", type: "on_behalf", v: 1, state: "done", data: { person: "usr_dana", agentId: "agt_intake", teammate: "usr_maya" } }] as never,
  depth: 0, attachments: [], reactions: [], pinned: false, createdAt: Date.UTC(2025, 9, 9, 9, 0),
} as unknown as Message;
const clean = (h: string): string => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

function view(me: string): { html: string; muted: string[]; menu: string[] } {
  const muted: string[] = [];
  const actions = { nameOf, agentMute: { me, mute: (p: string) => muted.push(p) }, copy: () => undefined, openThread: () => undefined, setPinned: () => undefined, react: () => undefined, remove: () => undefined, openAgent: () => undefined, showMenu: () => undefined };
  const items = timeline([m], { meId: me, nameOf, kindOf, clock });
  const html = clean(items.map((it) => renderToStaticMarkup(<MessageView item={it} actions={actions as never} meId={me} />)).join(""));
  const menu = menuFor(m, false, actions as never, () => undefined).flatMap((e) => ("label" in e && typeof e.label === "string" ? [e.label] : []));
  return { html, muted, menu };
}

test("Maya reads it as Dana (Agent), wearing Dana's face, with a quiet line and a menu entry to mute Dana's agents for today", () => {
  assert.deepEqual(onBehalfOf(m), { person: "usr_dana", agentId: "agt_intake", teammate: "usr_maya" });
  const item = timeline([m], { meId: "usr_maya", nameOf, kindOf, clock }).find((i) => i.kind === "other");
  assert.deepEqual(item && "who" in item ? item.who : null, { id: "agt_intake", name: "Dana Reyes (Agent)", kind: "agent", face: "usr_dana", forPerson: "usr_dana" });
  const maya = view("usr_maya");
  assert.match(maya.html, /Dana Reyes \(Agent\)/);
  assert.ok(!/Intake/.test(maya.html), "never the agent's own name");
  assert.match(maya.html, /Mute agent messages from Dana for today/);
  assert.ok(!/on behalf|on_behalf/.test(maya.html), "the block is not drawn as a card");
  assert.ok(maya.menu.includes("Mute Agent Messages From Dana for Today"), maya.menu.join(", "));
});

test("Dana sees the same credit and no mute; a message with no block is the agent's own", () => {
  const dana = view("usr_dana");
  assert.match(dana.html, /Dana Reyes \(Agent\)/);
  assert.ok(!/Mute agent messages/.test(dana.html));
  assert.ok(!dana.menu.some((l) => l.startsWith("Mute Agent")));
  const plain = { ...m, blocks: [] } as unknown as Message;
  assert.equal(onBehalfOf(plain), null);
  assert.equal(onBehalfOf({ ...m, author: { kind: "person", id: "usr_leo" } } as Message), null, "only an agent's message can speak for someone");
});

test("the ask-first card says whom it goes to; a teammate's plain approval runs nothing as them", () => {
  assert.equal(wantsPhrase("chat.message_person", "Maya Chen"), "send this to Maya Chen");
  assert.equal(wantsPhrase("chat.message_person"), "send a message to a teammate");
  const held = heldOf([{ type: "table", data: { cap: "", act: "", plain: true, ask: { what: "approve the 10% Rivera discount" }, text: "Renews Monday." } }]);
  assert.deepEqual([held.plain, held.what, held.detail], [true, "approve the 10% Rivera discount", "Renews Monday."]);
});
