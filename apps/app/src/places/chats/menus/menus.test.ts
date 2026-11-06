// The row menus of Chats: what each kind offers for each state, in what order, with which key, and that every item calls what it says. A menu has an item only when it works for this person.
import test from "node:test";
import assert from "node:assert/strict";
import { agentMenu, channelMenu, chatMenu, keyLabel, personMenu, shortcutFor, tidy } from "./kinds.ts";
import type { AgentDo, AgentFacts, ChannelDo, ChatDo, ChatFacts, PersonDo } from "./kinds.ts";
import { createMenuApi, muteKey } from "./actions.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

const rows = (e: readonly MenuEntry[]): MenuItem[] => e.filter((x): x is MenuItem => !("separator" in x) && !("head" in x));
const labels = (e: readonly MenuEntry[]): string[] => e.map((x) => ("separator" in x ? "-" : "head" in x ? `# ${x.head}` : x.label));
const calls: string[] = [];
const rec = (n: string) => (...a: unknown[]): void => { calls.push(a.length ? `${n}:${a.join(",")}` : n); };
const agentDo: AgentDo = { message: rec("message"), openProfile: rec("profile"), openComputer: rec("opencomp"), wake: rec("wake"), sleep: rec("sleep"), giveComputer: rec("give"), pause: rec("pause"), resume: rec("resume"), star: rec("star"), mute: rec("mute"), remove: rec("remove") };
const agent = (o: Partial<AgentFacts> = {}): AgentFacts => ({ name: "Mira", assistant: false, starred: false, status: "awake", hasComputer: true, computer: { computerId: "cmp_1", asleep: false }, muted: false, manage: true, provision: true, ...o });

test("agent: an admin sees the whole menu, in groups, danger last and alone", () => {
  const e = agentMenu(agent(), agentDo);
  assert.deepEqual(labels(e), ["Message Mira", "Open Profile", "-", "Open Its Computer", "Sleep Its Computer", "-", "Pause", "-", "Star", "Mute", "-", "Delete Agent…"]);
  const last = rows(e).at(-1)!;
  assert.equal(last.danger, true);
  assert.equal(rows(e).filter((x) => x.danger).length, 1);
  assert.equal(rows(e)[0]!.hint, "Enter");
  assert.equal(last.hint, "⌘⌫");
});

test("agent: the words follow the state; a member loses Pause, Give a Computer and Delete", () => {
  assert.ok(labels(agentMenu(agent({ status: "paused", starred: true, muted: true, computer: { computerId: "c", asleep: true } }), agentDo)).join("|").includes("Resume|-|Remove star|Unmute"));
  assert.ok(labels(agentMenu(agent({ computer: { computerId: "c", asleep: true } }), agentDo)).includes("Wake Its Computer"));
  const m = labels(agentMenu(agent({ manage: false }), agentDo));
  assert.ok(!m.some((x) => /^(Pause|Resume|Delete|Wake|Sleep|Give)/.test(x)), m.join("|"));
  assert.ok(m.includes("Message Mira") && m.includes("Star") && m.includes("Open Its Computer"));
  const none = labels(agentMenu(agent({ hasComputer: false, computer: undefined }), agentDo));
  assert.ok(none.includes("Give It a Computer") && !none.includes("Open Its Computer"));
  assert.ok(!labels(agentMenu(agent({ hasComputer: false, manage: false, provision: false }), agentDo)).includes("Give It a Computer"));
  assert.ok(!labels(agentMenu(agent({ hasComputer: false, provision: false }), agentDo)).includes("Give It a Computer"), "setting up a computer needs its own permission");
  const unknown = labels(agentMenu(agent({ computer: undefined }), agentDo));
  assert.ok(!unknown.some((x) => /^(Wake|Sleep)/.test(x)), "a computer whose state is not known offers neither");
  const own = labels(agentMenu(agent({ assistant: true, hasComputer: false }), agentDo));
  assert.ok(!own.some((x) => /^(Pause|Delete|Give)/.test(x)), "your own assistant cannot be paused or deleted from here");
});

test("agent: every item does what it says", () => {
  calls.length = 0;
  for (const x of rows(agentMenu(agent(), agentDo))) x.onSelect?.();
  assert.deepEqual(calls, ["message", "profile", "opencomp", "sleep", "pause", "star:true", "mute:true", "remove"]);
});

const personDo: PersonDo = { message: rec("message"), markRead: rec("read"), markUnread: rec("unread"), mute: rec("mute") };
test("person: Message, then read state and Mute, with the words of the state", () => {
  assert.deepEqual(labels(personMenu({ name: "Sara", dm: true, unread: true, muted: false }, personDo)), ["Message Sara", "-", "Mark as Read", "Mute"]);
  assert.deepEqual(labels(personMenu({ name: "Sara", dm: true, unread: false, muted: true }, personDo)), ["Message Sara", "-", "Mark as Unread", "Unmute"]);
  assert.deepEqual(labels(personMenu({ name: "Sara", dm: false, unread: false, muted: false }, personDo)), ["Message Sara", "-", "Mute"], "no chat with them yet: nothing to mark");
  calls.length = 0;
  for (const x of rows(personMenu({ name: "Sara", dm: true, unread: true, muted: false }, personDo))) x.onSelect?.();
  assert.deepEqual(calls, ["message", "read", "mute:true"]);
});

const chatDo: ChatDo = { open: rec("open"), openTab: rec("tab"), rename: rec("rename"), star: rec("star"), markRead: rec("read"), markUnread: rec("unread"), mute: rec("mute"), archive: rec("archive"), unarchive: rec("unarchive"), leave: rec("leave"), remove: rec("remove") };
const chat = (o: Partial<ChatFacts> = {}): ChatFacts => ({ starred: false, unread: false, local: false, archived: false, withPeople: false, muted: false, ...o });
test("chat: open, change, archive, then leave or delete last", () => {
  assert.deepEqual(labels(chatMenu(chat(), chatDo)), ["Open", "Open in New Tab", "-", "Rename", "Star", "Mark as Unread", "Mute", "-", "Archive", "-", "Delete chat"]);
  assert.deepEqual(labels(chatMenu(chat({ withPeople: true, unread: true, starred: true, archived: true, muted: true }), chatDo)), ["Open", "Open in New Tab", "-", "Rename", "Remove star", "Mark as Read", "Unmute", "-", "Unarchive", "-", "Leave chat"]);
  assert.deepEqual(labels(chatMenu(chat({ local: true }), chatDo)), ["Open", "Open in New Tab", "-", "Star", "-", "Archive"], "a row the server does not know yet has nothing to rename, mark, mute or delete");
  assert.ok(!labels(chatMenu(chat(), { ...chatDo, openTab: undefined })).includes("Open in New Tab"));
  const hints = Object.fromEntries(rows(chatMenu(chat(), chatDo)).map((x) => [x.label, x.hint]));
  assert.deepEqual(hints, { Open: "Enter", "Open in New Tab": "⌘↵", Rename: "F2", Star: "S", "Mark as Unread": "U", Mute: undefined, Archive: "E", "Delete chat": "⌘⌫" });
});

const channelDo: ChannelDo = { open: rec("open"), markRead: rec("read"), markUnread: rec("unread"), star: rec("star"), mute: rec("mute"), copyLink: rec("link"), leave: rec("leave"), archive: rec("archive") };
test("channel: read state, star, mute, copy link; an admin may archive, a member may leave", () => {
  const f = { name: "launch", unread: true, starred: false, muted: false, member: true, admin: true };
  assert.deepEqual(labels(channelMenu(f, channelDo)), ["Open", "-", "Mark as Read", "Star", "Mute", "-", "Copy link", "-", "Archive Channel", "Leave Channel"]);
  assert.deepEqual(labels(channelMenu({ ...f, unread: false, starred: true, muted: true, admin: false }, channelDo)), ["Open", "-", "Mark as Unread", "Remove star", "Unmute", "-", "Copy link", "-", "Leave Channel"]);
  assert.deepEqual(labels(channelMenu({ ...f, member: false, admin: false }, channelDo)), ["Open", "-", "Mark as Read", "Star", "Mute", "-", "Copy link"], "someone who is not in it can only look");
  assert.equal(rows(channelMenu(f, channelDo)).at(-1)!.danger, true);
});

test("tidy: an item left out leaves no empty group and no separator at either end", () => {
  const a = { label: "A", onSelect: () => undefined };
  assert.deepEqual(labels(tidy([{ separator: true }, a, { separator: true }, null, { separator: true }, { label: "B" }, { separator: true }])), ["A", "-", "B"]);
});

test("keys: S, U, E, F2, Cmd+Enter, Cmd+Backspace run the item that shows them; Enter and unknown keys do not", () => {
  const e = chatMenu(chat(), chatDo);
  const press = (k: string, mods: object = {}): string => { calls.length = 0; const x = shortcutFor(e, { key: k, ...mods }); x?.onSelect?.(); return calls[0] ?? "-"; };
  assert.equal(press("s"), "star:true");
  assert.equal(press("S"), "star:true");
  assert.equal(press("u"), "unread");
  assert.equal(press("e"), "archive");
  assert.equal(press("F2"), "rename");
  assert.equal(press("Enter", { metaKey: true }), "tab");
  assert.equal(press("Backspace", { ctrlKey: true }), "remove");
  assert.equal(press("Enter"), "-", "plain Enter is the row's own open");
  assert.equal(press("x"), "-");
  assert.equal(press("s", { shiftKey: true }), "-");
  assert.equal(keyLabel({ key: "i", metaKey: true }), "⌘I");
  assert.equal(press("z", { metaKey: true }), "-");
});

test("the writes: each item is one capability with its own input", async () => {
  const sent: { cap: string; input: unknown }[] = [];
  const api = createMenuApi({ call: async (cap, input) => { sent.push({ cap, input }); if (cap === "stars.list") return { stars: [{ resource: { type: "agent", id: "agt_1" }, title: "Mira", at: 0 }] }; if (cap === "notifications.mute.list") return { mutes: [{ target: { kind: "agent", id: "agt_1" }, until: 0 }, { target: { kind: "channel", id: "chn_1" }, until: 0 }] }; if (cap === "computers.list") return { computers: [{ computerId: "cmp_9", agentId: "agt_1", state: "asleep" }, { computerId: "cmp_8", agentId: "agt_2", state: "working" }] }; return {}; } });
  assert.deepEqual([...await api.mutes()].sort(), ["agent:agt_1", "channel:chn_1"]);
  assert.equal(muteKey("person", "usr_1"), "person:usr_1");
  const pcs = await api.computers();
  assert.deepEqual(pcs.get("agt_1"), { computerId: "cmp_9", asleep: true });
  assert.deepEqual(pcs.get("agt_2"), { computerId: "cmp_8", asleep: false });
  assert.equal(pcs.get("agt_3"), undefined);
  assert.deepEqual([...await api.stars()], ["agent:agt_1"]);
  sent.length = 0;
  await api.setMute("person", "usr_1", true); await api.setMute("thread", "thr_1", false);
  await api.wake("cmp_1"); await api.sleep("cmp_1"); await api.provision("agt_1");
  await api.pause("agt_1"); await api.resume("agt_1"); await api.deleteAgent("agt_1");
  await api.renameThread("thr_1", "New name"); await api.leaveChannel("chn_1"); await api.archiveChannel("chn_1");
  assert.deepEqual(sent, [
    { cap: "notifications.mute.set", input: { target: { kind: "person", id: "usr_1" } } },
    { cap: "notifications.mute.clear", input: { target: { kind: "thread", id: "thr_1" } } },
    { cap: "computers.wake", input: { computerId: "cmp_1" } },
    { cap: "computers.sleep", input: { computerId: "cmp_1" } },
    { cap: "computers.provision", input: { agentId: "agt_1", idempotencyKey: "pc_agt_1" } },
    { cap: "agents.pause", input: { agentId: "agt_1" } },
    { cap: "agents.resume", input: { agentId: "agt_1" } },
    { cap: "agents.delete", input: { agentId: "agt_1" } },
    { cap: "threads.update", input: { threadId: "thr_1", title: "New name" } },
    { cap: "channels.leave", input: { channelId: "chn_1" } },
    { cap: "channels.archive", input: { channelId: "chn_1" } },
  ]);
});

test("the extra items come with what the sidebar can do: Poke, Add to a Chat, Share, Edit Instructions for an agent; Call, Add to a Chat, Copy @name for a person; Add People, Copy link, Notifications for a chat and a channel", () => {
  calls.length = 0;
  const more = { poke: rec("poke"), addToChat: rec("addchat"), share: rec("share"), editInstructions: rec("instr") };
  const a = agentMenu(agent(), { ...agentDo, ...more });
  assert.deepEqual(labels(a), ["Message Mira", "Open Profile", "Poke", "-", "Add to a Chat\u2026", "Share\u2026", "-", "Open Its Computer", "Sleep Its Computer", "-", "Edit Instructions", "Pause", "-", "Star", "Mute", "-", "Delete Agent\u2026"]);
  for (const x of rows(a)) x.onSelect?.();
  assert.deepEqual(calls.filter((c) => ["poke", "addchat", "share", "instr"].includes(c)), ["poke", "addchat", "share", "instr"]);
  const member = labels(agentMenu(agent({ manage: false }), { ...agentDo, ...more }));
  assert.ok(member.includes("Poke") && member.includes("Add to a Chat\u2026") && !member.includes("Share\u2026") && !member.includes("Edit Instructions"), "sharing and editing an agent need Manage");
  const p = personMenu({ name: "Sara", dm: true, unread: false, muted: false }, { ...personDo, call: rec("call"), addToChat: rec("addchat"), copyHandle: rec("copy") });
  assert.deepEqual(labels(p), ["Message Sara", "Call", "-", "Add to a Chat\u2026", "Copy @name", "-", "Mark as Unread", "Mute"]);
  const c = chatMenu(chat(), { ...chatDo, addPeople: rec("addpeople"), copyLink: rec("link"), notifications: rec("notif") });
  assert.deepEqual(labels(c), ["Open", "Open in New Tab", "-", "Rename", "Star", "Mark as Unread", "Mute", "Notifications\u2026", "-", "Add People\u2026", "Copy link", "-", "Archive", "-", "Delete chat"]);
  assert.ok(!labels(chatMenu(chat({ local: true }), { ...chatDo, addPeople: rec("x"), copyLink: rec("x"), notifications: rec("x") })).some((x) => /Add People|Copy link|Notifications/.test(x)), "a chat the server does not know has none of these");
  const ch = channelMenu({ name: "launch", unread: false, starred: false, muted: false, member: true, admin: false }, { ...channelDo, invite: rec("invite"), notifications: rec("notif") });
  assert.deepEqual(labels(ch), ["Open", "-", "Mark as Unread", "Star", "Mute", "Notifications\u2026", "-", "Invite\u2026", "Copy link", "-", "Leave Channel"]);
  assert.ok(!labels(channelMenu({ name: "x", unread: false, starred: false, muted: false, member: false, admin: false }, { ...channelDo, invite: rec("invite") })).includes("Invite\u2026"), "only a member invites");
});

test("the writes of the extra items: poke, add an agent or a person to a chat, mute for a while", async () => {
  const sent: { cap: string; input: unknown }[] = [];
  const api = createMenuApi({ call: async (cap, input) => { sent.push({ cap, input }); return {}; } });
  await api.poke("thr_1", "agt_1"); await api.addAgentToChat("thr_1", "agt_1"); await api.addPersonToChat("thr_1", "usr_1");
  await api.setMute("thread", "thr_1", true, 60); await api.setMute("thread", "thr_1", true); await api.setMute("thread", "thr_1", false, 60);
  assert.deepEqual(sent, [
    { cap: "threads.poke", input: { threadId: "thr_1", agentId: "agt_1" } },
    { cap: "threads.add_agent", input: { threadId: "thr_1", agentId: "agt_1" } },
    { cap: "threads.members.add", input: { threadId: "thr_1", personId: "usr_1" } },
    { cap: "notifications.mute.set", input: { target: { kind: "thread", id: "thr_1" }, minutes: 60 } },
    { cap: "notifications.mute.set", input: { target: { kind: "thread", id: "thr_1" } } },
    { cap: "notifications.mute.clear", input: { target: { kind: "thread", id: "thr_1" } } },
  ]);
});
