// Ask an agent in the conversation (owner ruling, 3 Nov 2026): the quiet line under your unanswered message opens the agent picker, "Ask an Agent…" sits in every message's menu and hover
// bar in a channel, and picking an agent posts your reply to that exact message naming it. Keyboard: the line and the bar are buttons, the picker is ui/Menu. The edit path is driven in the last two tests here, the words in askagent.test.ts, and "once"
// and the presser's account in test/chat.ask-agent.test.ts and test/chat.ask-agent.team.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "./Conversation.tsx";
import { HoverBar, menuFor } from "./MessageView.tsx";
import type { MessageActions } from "./MessageView.tsx";
import type { ConversationData } from "./data.tsx";
import type { Message } from "./model.ts";
import { createSample } from "./sample.ts";
import { renderToStaticMarkup } from "react-dom/server";

installComposerForTests(Composer);

type Call = { cap: string; input: Record<string, unknown> };
function rig(): { data: ConversationData; calls: Call[] } {
  const s = createSample("channel");
  const calls: Call[] = [];
  const data: ConversationData = {
    ...s.data,
    async call(cap, input) {
      calls.push({ cap, input: input as Record<string, unknown> });
      if (cap === "agents.list") return { agents: [{ agentId: "agt_docs", name: "Docs", ownerId: "usr_irfad", kind: "agent" }, { agentId: "agt_intake", name: "Intake", ownerId: "usr_maya", kind: "assistant" }] };
      if (cap === "chat.post") return { message: { messageId: "msg_asked", threadSeq: 9 } };
      if (cap === "chat.edit") return { message: {} };
      return s.data.call(cap, input);
    },
  };
  return { data, calls };
}
const walk = (n: Node, out: Node[] = []): Node[] => { out.push(n); for (const c of n.children ?? []) if (typeof c === "object") walk(c, out); return out; };
const idOf = (n: Node): unknown => n.props["data-testid"] ?? n.props.testID;

test("the quiet line under your unanswered message opens the picker, the room's agents; picking one asks it about that exact message as you", async () => {
  const restore = installDom();
  try {
    const { data, calls } = rig();
    const root = await mount(createRoot, <Conversation data={data} />);
    const line = find(root, "no-agent-ask");
    assert.ok(line, "the line is a button under your message");
    assert.ok(textOf(line).includes("No agent will reply. @mention one"));
    await press(line);
    await flush();
    const items = [...new Set(walk(root).map(idOf).filter((id): id is string => typeof id === "string" && id.startsWith("menu-item-") && id !== "menu-item-report"))];
    assert.deepEqual(items, ["menu-item-Docs"], "Maya's Assistant is hers alone and is not offered");
    await press(find(root, "menu-item-Docs"));
    await flush();
    const post = calls.find((c) => c.cap === "chat.post")!;
    assert.equal(post.input["replyTo"], "c2");
    assert.deepEqual(post.input["mentions"], [{ kind: "agent", id: "agt_docs" }]);
    assert.equal(post.input["body"], "@Docs");
    assert.match(String(post.input["clientId"]), /^msg_ask[a-z0-9]+$/);
  } finally { restore(); }
});

test("every message in a channel, yours or someone else's, has Ask an Agent… in its menu and its hover bar; a chat without the action has neither", () => {
  const theirs = { messageId: "c1", threadId: "c1", threadSeq: 1, author: { kind: "person", id: "usr_maya" }, kind: "text", body: "Did it come back?", blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: 1 } as unknown as Message;
  const asked: string[] = [];
  const a = { copy() {}, edit() {}, setPinned() {}, react() {}, openThread() {}, remove() {}, openAgent() {}, openBeside() {}, answer() {}, approvePlan() {}, retryTurn() {}, errorNext() {}, retrySend() {}, discardSend() {}, showMenu() {}, askAgent: (id: string) => { asked.push(id); } } as unknown as MessageActions;
  const labels = (mine: boolean, acts: MessageActions) => menuFor(theirs, mine, acts, () => undefined).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.ok(labels(false, a).includes("Ask an Agent…"));
  assert.ok(labels(true, a).includes("Ask an Agent…"));
  const entry = menuFor(theirs, false, a, () => undefined).find((e) => "label" in e && e.label === "Ask an Agent…") as { onSelect(): void };
  entry.onSelect();
  assert.deepEqual(asked, ["c1"]);
  const { askAgent: _drop, ...without } = a as unknown as Record<string, unknown>;
  assert.ok(!labels(false, without as unknown as MessageActions).includes("Ask an Agent…"));
  const bar = renderToStaticMarkup(<HoverBar m={theirs} mine={false} a={a} onEdit={() => undefined} visible />);
  assert.ok(bar.includes('data-testid="act-ask-c1"') && bar.includes('aria-label="Ask an agent"'), "a button in the bar, reachable by keyboard");
  assert.ok(!bar.includes("pill"));
});

// An edit that adds an @mention asks that agent once (owner decision D4). Driven through the real conversation: hover your message, Edit, type, Save. The edit goes to chat.edit and the
// replica keeps it, so the next edit compares against the words as saved.
async function editMine(root: Node, id: string, text: string): Promise<void> {
  const row = find(root, `msg-${id}`);
  assert.ok(row, "your message is on the page");
  await act(async () => { (row.props["onMouseEnter"] as () => void)(); });
  await press(find(root, `act-edit-${id}`));
  await typeInto(find(root, `edit-field-${id}`), text);
  await press(find(root, `edit-save-${id}`));
  await flush();
}

test("editing your message to add an @mention asks that agent once, as you, and never again on later edits or a re-added mention", async () => {
  const restore = installDom();
  try {
    const s = createSample("channel");
    const calls: Call[] = [];
    const data: ConversationData = {
      ...s.data,
      async call(cap, input) {
        calls.push({ cap, input: input as Record<string, unknown> });
        if (cap === "agents.list") return { agents: [{ agentId: "agt_docs", name: "Docs", ownerId: "usr_irfad", kind: "agent" }, { agentId: "agt_intake", name: "Intake", ownerId: "usr_maya", kind: "agent" }] };
        if (cap === "chat.post") return { message: { messageId: "msg_asked", threadSeq: 9 } };
        return s.data.call(cap, input);
      },
    };
    const root = await mount(createRoot, <Conversation data={data} />);
    const posts = (): Call[] => calls.filter((c) => c.cap === "chat.post");
    const order = (): string[] => calls.filter((c) => c.cap === "chat.edit" || c.cap === "chat.post").map((c) => c.cap);

    // a plain edit names nobody: nothing is asked
    await editMine(root, "c2", "Can someone check the Rivera dates before Wednesday?");
    assert.equal(posts().length, 0, "no mention, no ask");

    // the edit adds @Docs: one ask, after the edit saved, as your reply to that exact message
    await editMine(root, "c2", "@Docs Can someone check the Rivera dates before Wednesday?");
    assert.deepEqual(order(), ["chat.edit", "chat.edit", "chat.post"], "the ask follows the saved edit");
    const ask = posts()[0]!.input;
    assert.deepEqual([ask["replyTo"], ask["body"], ask["mentions"]], ["c2", "@Docs", [{ kind: "agent", id: "agt_docs" }]]);
    assert.match(String(ask["clientId"]), /^msg_ask[a-z0-9]+$/);

    // a later edit that keeps @Docs asks nobody again
    await editMine(root, "c2", "@Docs Can someone check the Rivera dates before Thursday?");
    assert.equal(posts().length, 1, "already named: no second reply");

    // take the mention out and put it back: the fixed message id makes it the same ask, which the server answers with the first message
    await editMine(root, "c2", "Can someone check the Rivera dates before Thursday?");
    await editMine(root, "c2", "@Docs Can someone check the Rivera dates before Thursday?");
    assert.equal(new Set(posts().map((c) => c.input["clientId"])).size, 1, "every ask for Docs on that message is one message id");
    assert.ok(posts().every((c) => c.input["replyTo"] === "c2"));
  } finally { restore(); }
});

test("an edit that names someone who is not in this channel, or a person, asks nobody", async () => {
  const restore = installDom();
  try {
    const s = createSample("channel");
    const calls: Call[] = [];
    const data: ConversationData = { ...s.data, async call(cap, input) { calls.push({ cap, input: input as Record<string, unknown> }); return s.data.call(cap, input); } };
    const root = await mount(createRoot, <Conversation data={data} />);
    await editMine(root, "c2", "@Maya can you check the Rivera dates?");
    await editMine(root, "c2", "@Billing can you check the Rivera dates?");
    assert.ok(calls.some((c) => c.cap === "chat.edit"), "the edits saved");
    assert.equal(calls.filter((c) => c.cap === "chat.post").length, 0);
  } finally { restore(); }
});
