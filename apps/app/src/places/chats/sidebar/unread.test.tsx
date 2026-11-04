// Unread everywhere a conversation shows (owner report, rc.14: "unread messages dont get a dot next to people on Chats"). The People rows never had a count: the list came from the Space's
// people, and nothing joined it to the direct message with each one. Now the mapping is pure and tested here: a direct message counts on its person's row, an agent's own chat on its face, a
// thread I am in on the Threads row, and anything at all lights the rail's Chats dot. The row menus offer Mark as Read or Mark as Unread.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatsSidebar } from "./ChatsSidebar.tsx";
import type { ChatsSidebarData } from "./data.tsx";
import { createSidebarApi } from "./actions.ts";
import { chatMenuEntries } from "./chat-menu.ts";
import { agentUnread, anyUnread, buildEntries, dmPerson, dmThreads, groupRecent, peopleWithUnread, personUnread, rowOf } from "./model.ts";
import type { ChatRow, RecentItem, RecentOut } from "./model.ts";
import { createShellHub } from "../../../shell/spaces/hub.ts";
import { SEED_DEFS } from "../../../shell/spaces/model.ts";

const ANA = "usr_ana", BEN = "usr_ben", SCOUT = "agt_scout";
const item = (o: Partial<RecentItem> & { people?: string[] }): RecentItem => ({ threadId: "thr_x", kind: "chat", title: "New chat", agents: [], unread: 0, working: false, starred: false, lastAt: 1_700_000_000_000, ...o }) as RecentItem;
const recentOf = (today: RecentItem[], o: { archived?: RecentItem[]; threadsUnread?: number } = {}): RecentOut =>
  ({ starred: [], today, yesterday: [], earlier: [], archived: o.archived ?? [], nextUnread: null, ...(o.threadsUnread !== undefined ? { threadsUnread: o.threadsUnread } : {}) }) as RecentOut;
const names = (id: string): string => ({ [ANA]: "Ana Ruiz", [BEN]: "Ben Cole", [SCOUT]: "Scout" })[id] ?? id;

test("a direct message is with the one other person in it; a chat with an agent, with two people, or from an older server names nobody", () => {
  assert.equal(dmPerson(item({ people: [ANA] })), ANA);
  assert.equal(dmPerson(item({ people: [ANA], agents: [SCOUT] })), null);
  assert.equal(dmPerson(item({ people: [ANA, BEN] })), null);
  assert.equal(dmPerson(item({})), null, "an older server sends no people");
  assert.equal(dmPerson(item({ kind: "channel", people: [ANA] })), null);
});

test("each person's row carries the unread of the direct message with them, and those with something new come first so N more never hides one", () => {
  const recent = recentOf([item({ threadId: "thr_dm_ben", people: [BEN], unread: 2 }), item({ threadId: "thr_dm_ana", people: [ANA], unread: 0 }), item({ threadId: "thr_scout", agents: [SCOUT], unread: 5 })], { archived: [item({ threadId: "thr_old", people: [ANA], unread: 9 })] });
  const by = personUnread(recent);
  assert.equal(by.get(BEN), 2);
  assert.equal(by.get(ANA), undefined, "nothing new with Ana: an archived chat is quiet until it comes back");
  const people = peopleWithUnread([{ id: ANA, name: "Ana Ruiz" }, { id: "usr_cy", name: "Cy" }, { id: "usr_di", name: "Di" }, { id: BEN, name: "Ben Cole" }], by);
  assert.deepEqual(people.map((p) => [p.id, p.unread]), [[BEN, 2], [ANA, 0], ["usr_cy", 0], ["usr_di", 0]]);
  const entries = buildEntries({ faces: [], workingAgents: new Set(), groups: [], channels: [], filter: "all", closed: new Set(), people });
  const ben = entries.find((e) => e.key === `p:${BEN}`);
  assert.ok(ben && ben.type === "person" && ben.unread === 2, "Ben's row is drawn, with his unread, inside the three shown");
  assert.deepEqual(dmThreads(recent).get(BEN), "thr_dm_ben", "his row's menu marks that chat");
});

test("a direct message reads as the person's name, not New chat, and its face is theirs; a title someone gave still wins", () => {
  const row = rowOf(item({ threadId: "thr_dm", people: [ANA], unread: 1 }), names, names);
  assert.deepEqual([row.title, row.who, row.whoId, row.kind, row.withPeople], ["Ana Ruiz", "Ana Ruiz", ANA, "person", true]);
  assert.equal(rowOf(item({ people: [ANA], title: "Rivera handoff" }), names, names).title, "Rivera handoff");
  assert.equal(groupRecent(recentOf([item({ threadId: "thr_dm", people: [ANA], unread: 1 })]), [], names, names)[0]!.rows[0]!.unread, 1, "Recent keeps the server's count");
});

test("an agent's face carries the unread of its own chats; there is no Threads row", () => {
  const recent = recentOf([item({ threadId: "thr_s1", agents: [SCOUT], unread: 1 }), item({ threadId: "thr_s2", agents: [SCOUT], unread: 2 }), item({ threadId: "thr_two", agents: [SCOUT, "agt_b"], unread: 4 }), item({ threadId: "thr_mixed", agents: [SCOUT], people: [ANA], unread: 8 })], { threadsUnread: 3 });
  const by = agentUnread(recent);
  assert.equal(by.get(SCOUT), 3, "a group chat or one with a person is not the agent's own");
  const scout = { agentId: SCOUT, name: "Scout", status: "idle" } as never;
  const entries = buildEntries({ faces: [scout], workingAgents: new Set(), groups: [], channels: [], filter: "all", closed: new Set(), agentUnread: by });
  const face = entries.find((e) => e.key === `f:${SCOUT}`);
  assert.ok(face && face.type === "face" && face.unread === 3);
  assert.equal(entries.find((e) => e.key === "nav:threads"), undefined);
});

test("the rail's Chats dot: on for any unread chat, channel or thread; off when all is read; archived chats stay quiet", () => {
  assert.equal(anyUnread(recentOf([item({ unread: 1 })]), []), true);
  assert.equal(anyUnread(recentOf([item({ unread: 0 })]), [{ unread: 2 }]), true);
  assert.equal(anyUnread(recentOf([], { threadsUnread: 1 }), []), true);
  assert.equal(anyUnread(recentOf([item({ unread: 0 })], { archived: [item({ threadId: "thr_old", unread: 5 })] }), [{ unread: 0 }]), false);
  assert.equal(anyUnread(null, []), false, "nothing read yet: no dot");
  const hub = createShellHub({ spaces: SEED_DEFS, openId: "nw", personId: "irfad", deviceId: "mac", storage: null, skeletonMs: 0 });
  hub.go("records");
  hub.count("chats", 0);
  let drew = 0;
  hub.subscribe(() => { drew += 1; });
  const dot = (): boolean => [...hub.rail().top, ...hub.rail().bottom].find((e) => e.place === "chats")?.dot === true;
  hub.dot("chats", true);
  assert.equal(dot(), true);
  const once = drew;
  hub.dot("chats", true);
  assert.equal(drew, once, "the same state draws nothing: nothing blinks");
  hub.dot("chats", false);
  assert.equal(dot(), false);
});

test("Mark as Read on an unread chat, Mark as Unread on a read one; both call the read cursor", async () => {
  const row: ChatRow = { threadId: "thr_dm", title: "Ana Ruiz", who: "Ana Ruiz", kind: "person", unread: 0, working: false, starred: false, lastAt: 1, local: false, withPeople: true };
  const noop = (): void => undefined;
  const labels = (r: ChatRow): string[] => chatMenuEntries(r, { open: noop, star: noop, markRead: noop, markUnread: noop, archive: noop, unarchive: noop, leaveChat: noop, deleteChat: noop }).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.ok(labels(row).includes("Mark as Unread") && !labels(row).includes("Mark as Read"));
  assert.ok(labels({ ...row, unread: 3 }).includes("Mark as Read") && !labels({ ...row, unread: 3 }).includes("Mark as Unread"));
  assert.ok(!labels({ ...row, local: true }).includes("Mark as Unread"), "a row the server does not know yet has nothing to mark");
  const calls: Array<[string, unknown]> = [];
  const api = createSidebarApi({ call: async (cap: string, input: unknown) => { calls.push([cap, input]); return {}; } } as unknown as ChatsSidebarData, noop, noop);
  await api.markUnread("thr_dm");
  await api.markRead("thr_dm");
  assert.deepEqual(calls, [["threads.mark_read", { threadId: "thr_dm", unread: true }], ["threads.mark_read", { threadId: "thr_dm" }]]);
});

test("drawn: the person you have an unread message from has the dot on their row; a chat with new replies is bold with their count", () => {
  const recent = recentOf([item({ threadId: "thr_dm_ana", people: [ANA], unread: 2 }), item({ threadId: "thr_dm_ben", people: [BEN], unread: 0 })], { threadsUnread: 1 });
  const snaps: Record<string, unknown> = {
    recent: { status: "ready", data: recent },
    channels: { status: "ready", data: { channels: [] } },
    agents: { status: "ready", data: { agents: [] } },
    needs: { status: "ready", data: { items: [], total: 0 } },
    count: { status: "ready", data: { count: 0 } },
  };
  const noop = (): void => undefined;
  const data = {
    screens: { query: (_s: string, name: string) => ({ subscribe: () => noop, getSnapshot: () => snaps[name] }) },
    call: async () => ({}),
    connection: { get: () => "online" as const, subscribe: () => noop },
    space: { name: "Team", otherNeedsYou: false, assistant: { agentId: "agt_asst", name: "Assistant" } },
    nav: { openChat: noop, openAgentChat: noop, openChannel: noop, openNeedsYou: noop, openAllAgents: noop, openSearch: noop, openSpaceSwitcher: noop, openNewChannel: noop, openTasks: noop },
    people: [{ id: BEN, name: "Ben Cole" }, { id: ANA, name: "Ana Ruiz" }],
    me: { id: "usr_me" },
    clock: () => ({ now: 1_700_000_000_000, offsetMin: 0 }),
  } as unknown as ChatsSidebarData;
  const rowHtml = (out: string, key: string): string => {
    const i = out.indexOf(`data-testid="row-${key}"`);
    assert.ok(i >= 0, `row ${key} is drawn`);
    // up to the next row (its own leading and trailing parts are row-<key>-...)
    let next = out.indexOf('data-testid="row-', i + 10);
    while (next >= 0 && out.startsWith(`data-testid="row-${key}-`, next)) next = out.indexOf('data-testid="row-', next + 10);
    return out.slice(i, next < 0 ? undefined : next);
  };
  const out = renderToStaticMarkup(<ChatsSidebar data={data} window={{ start: 0, end: 200 }} open={null} />);
  assert.ok(rowHtml(out, `p:${ANA}`).includes('data-testid="unread-dot"'), "Ana wrote: her row has the dot");
  assert.ok(!rowHtml(out, `p:${BEN}`).includes('data-testid="unread-dot"'), "nothing new from Ben");
  assert.ok(out.indexOf(`row-p:${ANA}`) < out.indexOf(`row-p:${BEN}`), "Ana rises above Ben");
  assert.ok(!out.includes("row-nav:threads"), "no Threads row");
});
