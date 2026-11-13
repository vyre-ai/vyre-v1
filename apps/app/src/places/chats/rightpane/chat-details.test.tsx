// K9 (13 Nov 2026): a channel's right pane shows the channel (name, topic, who can read it, who is in it); a group chat shows the group. Each person and agent is a row that opens their profile.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { ChatDetails, detailsLine } from "./ChatDetails.tsx";

const NAMES: Record<string, string> = { usr_me: "Olivia Owner", usr_maya: "Maya Lin", agt_dex: "Dex" };
const thread = (kind: string, channelId?: string) => ({ threadId: "thr_1", kind, ...(channelId ? { channelId } : {}), title: kind === "channel" ? "launch-week" : "Email copy", listed: true, planMode: false, createdAt: 1, agents: [], members: [{ kind: "person", id: "usr_me" }, { kind: "person", id: "usr_maya" }, { kind: "agent", id: "agt_dex" }] });

test("a channel's pane says what the channel is: name, topic, who can read it, and the people and agents in it", async () => {
  const restore = installDom();
  try {
    const opened: string[] = [];
    const call = async (cap: string): Promise<unknown> => (cap === "threads.get" ? { thread: thread("channel", "chn_1") } : { channel: { channelId: "chn_1", mainThreadId: "thr_1", name: "launch-week", topic: "Everything for the 3 Dec launch", visibility: "invite", archived: false, members: [], agents: [], unread: 0 } });
    const root = await mount(createRoot as never, <ChatDetails threadId="thr_1" call={call} nameOf={(id) => NAMES[id] ?? id} meId="usr_me" openProfile={(id, asPerson) => opened.push(`${id}:${asPerson}`)} />);
    await flush(); await flush();
    assert.equal(textOf(find(root!, "chat-details-title")), "#launch-week");
    assert.match(textOf(find(root!, "chat-details-line")), /Private channel\. Only the people in it can read it\./);
    assert.equal(textOf(find(root!, "chat-details-topic")), "Everything for the 3 Dec launch");
    assert.match(textOf(find(root!, "chat-details")), /People\s*2/);
    assert.match(textOf(find(root!, "row-chat-person-usr_me")), /You/);
    await press(find(root!, "row-chat-person-usr_maya"));
    await press(find(root!, "row-chat-agent-agt_dex"));
    assert.deepEqual(opened, ["usr_maya:true", "agt_dex:false"]);
  } finally { restore(); }
});

test("a group chat's pane is the group: its name and who is in it, no channel words", async () => {
  const restore = installDom();
  try {
    const call = async (): Promise<unknown> => ({ thread: { ...thread("chat"), title: undefined, members: [{ kind: "person", id: "usr_me" }], agents: [{ agentId: "agt_dex", mode: "lead" }] } });
    const root = await mount(createRoot as never, <ChatDetails threadId="thr_1" call={call} nameOf={(id) => NAMES[id] ?? id} meId="usr_me" openProfile={() => undefined} />);
    await flush(); await flush();
    assert.equal(textOf(find(root!, "chat-details-title")), "Dex", "a group with no name of its own is named by who is in it");
    assert.ok(find(root!, "row-chat-agent-agt_dex"), "an agent on the chat's own list is a row");
    assert.equal(textOf(find(root!, "chat-details-line")), "Group chat");
    assert.equal(find(root!, "chat-details-topic"), null);
    assert.equal(detailsLine({ kind: "channel" as const }, { visibility: "public" }), "Channel. Anyone in the Space can join.");
  } finally { restore(); }
});

test("the tab for what the chat is comes first, before the agent's own tab; without one the agent leads", async () => {
  const { orderedTabs } = await import("./ChatRightPane.tsx");
  const open = { key: "open", title: "Assistant" };
  const maya = { key: "profile:usr_maya", title: "Maya" }, face = { key: "profile:agt_dex", title: "Dex" };
  assert.deepEqual(orderedTabs(open, { first: maya.key, tabs: [face, maya] }).map((t) => t.title), ["Maya", "Assistant", "Dex"]);
  assert.deepEqual(orderedTabs(open, { tabs: [face, maya] }).map((t) => t.title), ["Assistant", "Dex", "Maya"]);
  assert.deepEqual(orderedTabs(open, { first: "gone", tabs: [face] }).map((t) => t.title), ["Assistant", "Dex"]);
  assert.deepEqual(orderedTabs(open, undefined).map((t) => t.title), ["Assistant"]);
});

// B (review, 13 Nov): nothing about who can read a channel until the channel has been read; a failed read is an error, never the public sentence.
test("a private channel is never described as open: no access line while its read is out, and an error when it fails", async () => {
  const restore = installDom();
  try {
    assert.equal(detailsLine({ kind: "channel" as const }, null), null, "no channel read, no access line");
    let release: (v: unknown) => void = () => undefined;
    const slow = (cap: string): Promise<unknown> => (cap === "threads.get" ? Promise.resolve({ thread: thread("channel", "chn_1") }) : new Promise((r) => { release = r; }));
    const waiting = await mount(createRoot as never, <ChatDetails threadId="thr_1" call={slow} nameOf={(id) => NAMES[id] ?? id} meId="usr_me" openProfile={() => undefined} />);
    await flush();
    assert.equal(find(waiting!, "chat-details-line"), null, "nothing is said while the channel read is out");
    assert.doesNotMatch(textOf(waiting!), /Anyone in the Space/);
    release({ channel: { channelId: "chn_1", mainThreadId: "thr_1", name: "launch-week", visibility: "invite", archived: false, members: [], agents: [], unread: 0 } });
    await flush();
    assert.match(textOf(find(waiting!, "chat-details-line")), /Private channel/);
    const broken = async (cap: string): Promise<unknown> => { if (cap === "threads.get") return { thread: thread("channel", "chn_1") }; throw Object.assign(new Error("The server is busy."), { code: "internal.error" }); };
    const failed = await mount(createRoot as never, <ChatDetails threadId="thr_1" call={broken} nameOf={(id) => NAMES[id] ?? id} meId="usr_me" openProfile={() => undefined} />);
    await flush(); await flush();
    assert.ok(find(failed!, "chat-details-failed"), "a failed read shows the pane's error state");
    assert.doesNotMatch(textOf(failed!), /Anyone in the Space/);
    assert.ok(find(failed!, "state-retry"), "a read that can work later keeps Retry");
  } finally { restore(); }
});

test("the You row is one line: the name, then a quiet You after it", async () => {
  const restore = installDom();
  try {
    const call = async (): Promise<unknown> => ({ thread: thread("chat") });
    const root = await mount(createRoot as never, <ChatDetails threadId="thr_1" call={call} nameOf={(id) => NAMES[id] ?? id} meId="usr_me" openProfile={() => undefined} />);
    await flush(); await flush();
    const me = find(root!, "row-chat-person-usr_me")!;
    assert.ok(find(me, "row-chat-person-usr_me-suffix"), "You is the title's suffix");
    assert.equal(textOf(find(me, "row-chat-person-usr_me-suffix")), "You");
  } finally { restore(); }
});
