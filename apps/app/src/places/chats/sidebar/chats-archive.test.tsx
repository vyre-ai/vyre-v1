// The Chats list after rc.8: the row menu offers Archive or Unarchive and Leave chat or Delete chat; an archived chat leaves its day group for a collapsed Archived section with a count; a deleted chat
// is gone at once with an Undo that brings it back. Click paths over the sample Space, not markup.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { ChatsSidebar, UNDO_MS } from "./ChatsSidebar.tsx";
import { chatMenuEntries } from "./chat-menu.ts";
import { archivedRows, buildEntries, groupRecent, rowOf } from "./model.ts";
import type { ChatRow, SidebarInput } from "./model.ts";
import { createSampleSidebar, northwind } from "./sample.ts";

const row = (o: Partial<ChatRow> = {}): ChatRow => ({ threadId: "thr_1", title: "Rivera intake", who: "Intake", kind: "agent", unread: 0, working: false, starred: false, lastAt: 1, local: false, ...o });
const labels = (r: ChatRow): string[] => chatMenuEntries(r, noop).flatMap((e) => ("label" in e ? [e.label] : []));
const noop = { open() {}, star() {}, markRead() {}, archive() {}, unarchive() {}, leaveChat() {}, deleteChat() {} };

test("the menu: Archive for a chat in my list, Unarchive for an archived one; Delete chat for a chat with agents, Leave chat for one with people, neither for a row the server does not know yet", () => {
  assert.deepEqual(labels(row()), ["Open", "Star", "Archive", "Delete chat"]);
  assert.deepEqual(labels(row({ unread: 2, starred: true, archived: true })), ["Open", "Remove Star", "Mark as Read", "Unarchive", "Delete chat"]);
  assert.deepEqual(labels(row({ withPeople: true })), ["Open", "Star", "Archive", "Leave chat"]);
  assert.deepEqual(labels(row({ local: true })), ["Open", "Star", "Archive"], "a local row has no chat on the server to delete");
  const danger = chatMenuEntries(row(), noop).filter((e) => "danger" in e && e.danger === true).map((e) => ("label" in e ? e.label : ""));
  assert.deepEqual(danger, ["Delete chat"]);
});

test("the Archived section is the foot of the Chats list, collapsed with a count, and opens to its rows", () => {
  const base: SidebarInput = { needs: [], needsTotal: 0, faces: [], workingAgents: new Set(), groups: [], channels: [], filter: "all", closed: new Set() };
  const archived = [row({ threadId: "thr_a", archived: true }), row({ threadId: "thr_b", archived: true })];
  const closed = buildEntries({ ...base, archived });
  const head = closed.find((e) => e.key === "h:archived");
  assert.ok(head && head.type === "head" && head.count === 2 && head.open === false && head.label === "Archived");
  assert.ok(!closed.some((e) => e.type === "chat"), "collapsed: no rows");
  const open = buildEntries({ ...base, archived, archivedOpen: true });
  assert.deepEqual(open.filter((e) => e.type === "chat").map((e) => e.key), ["c:thr_a", "c:thr_b"]);
  assert.ok(open.findIndex((e) => e.key === "h:archived") > open.findIndex((e) => e.key === "h:recent"), "after the Chats section");
  assert.ok(!buildEntries(base).some((e) => e.key === "h:archived"), "nothing archived, no section");
});

test("archivedRows reads the archived list and tolerates a server that sends none; the day groups never hold an archived chat", () => {
  const item = (id: string) => ({ threadId: id, kind: "chat" as const, title: id, agents: [], unread: 0, working: false, starred: false, lastAt: 5 });
  const recent = { starred: [], today: [item("t1")], yesterday: [], earlier: [], archived: [item("a1")], nextUnread: null };
  assert.deepEqual(archivedRows(recent as never, (x) => x).map((r) => [r.threadId, r.archived]), [["a1", true]]);
  assert.deepEqual(groupRecent(recent as never, [], (x) => x).flatMap((g) => g.rows.map((r) => r.threadId)), ["t1"]);
  const old = { starred: [], today: [], yesterday: [], earlier: [], nextUnread: null };
  assert.deepEqual(archivedRows(old as never, (x) => x), []);
  assert.equal(rowOf(item("p"), (x) => x).withPeople, true, "a chat with no agent is with a person");
});

const ids = (n: Node | string, out: string[] = []): string[] => { if (typeof n === "string") return out; const t = n.props["data-testid"]; if (typeof t === "string") out.push(t); (n.children ?? []).forEach((c) => ids(c, out)); return out; };

test("archiving a chat moves it out of Chats into a collapsed Archived section; opening the section shows it; unarchive puts it back", async () => {
  installDom();
  const s = createSampleSidebar(northwind);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={{ start: 0, end: 500 }} />);
  assert.ok(ids(root).includes("row-c:c1") && !ids(root).includes("head-archived"));
  await act(async () => { await s.data.call("threads.archive", { threadId: "c1" }); });
  await flush();
  assert.ok(!ids(root).includes("row-c:c1"), "gone from the day group");
  assert.ok(ids(root).includes("head-archived") && ids(root).includes("count-archived"), "the Archived head carries a count");
  await press(find(root, "toggle-archived"));
  await flush();
  assert.ok(ids(root).includes("row-c:c1"), "open: the archived chat is there");
  await act(async () => { await s.data.call("threads.unarchive", { threadId: "c1" }); });
  await flush();
  assert.ok(ids(root).includes("row-c:c1") && !ids(root).includes("head-archived"), "back in the list, no section");
});

test("Delete chat from the row menu hides the chat now and shows an Undo that brings it back; the Undo goes away by itself", async () => {
  installDom();
  const s = createSampleSidebar(northwind);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={{ start: 0, end: 500 }} />);
  // the row's wrapper carries the right-click and long-press that open its menu
  const chain = (n: Node, id: string, up: Node[] = []): Node[] | null => { if (n.props["data-testid"] === id) return up; for (const c of n.children ?? []) if (typeof c !== "string") { const f = chain(c, id, [...up, n]); if (f) return f; } return null; };
  const wrapper = [...chain(root, "row-c:c1")!].reverse().find((n) => typeof n.props.onContextMenu === "function")!;
  assert.ok(wrapper, "an ancestor of the row opens the menu");
  await act(async () => { (wrapper.props.onContextMenu as (e: unknown) => void)({ preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} }); });
  await flush();
  assert.ok(find(root, "menu-item-Archive") && find(root, "menu-item-Delete chat"), "the menu offers both");
  await press(find(root, "menu-item-Delete chat"));
  await flush();
  assert.ok(!ids(root).includes("row-c:c1"), "gone at once");
  assert.ok(find(root, "chat-deleted"), "the Undo bar");
  assert.deepEqual(s.calls.filter((c) => c.cap === "threads.delete").map((c) => c.input), [{ threadId: "c1" }]);
  await press(find(root, "undo-delete"));
  await flush();
  assert.ok(ids(root).includes("row-c:c1"), "Undo brought it back");
  assert.equal(find(root, "chat-deleted"), null);
  assert.ok(UNDO_MS >= 5_000 && UNDO_MS <= 10_000, "about eight seconds");
});
