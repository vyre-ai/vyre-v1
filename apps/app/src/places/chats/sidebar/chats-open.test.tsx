// The selected row in the Chats list is the page the middle shows, however it was opened: a press here, a tab switch, a link or Cmd-K (the last three all reach the place as a route). A page
// with no row selects nothing, and the keyboard cursor is a separate focus that goes back to the open row when the page changes. Then the Imported rows: their menu (right-click and the "..."),
// Rename in the row, Archive into the Archived section and back, Delete with a plain confirm that leaves the continued chat, and the day a continued session shows. Click paths, not markup.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush, textOf, typeInto } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { ChatsSidebar } from "./ChatsSidebar.tsx";
import { importedDeleteConfirm, importedMenuEntries } from "./chat-menu.ts";
import { buildEntries, openEntry } from "./model.ts";
import type { Channel, SidebarInput } from "./model.ts";
import { createSampleSidebar, northwind } from "./sample.ts";
import type { SampleImported } from "./sample.ts";
import { importedRows } from "../imported/model.ts";
import { START, fromHash, openKeyOf, step } from "../mounts/route.ts";

const D = (m: number, d: number, h = 9): number => Date.UTC(2025, m - 1, d, h, 0, 0);
const IMPORTED: SampleImported[] = [
  { conversationId: "isc_a", provider: "claude_code", title: "Fix the login", startedAt: D(10, 20), importedAt: D(10, 21) },
  // continued in the chat "October invoices" (c3), last active 24 Oct
  { conversationId: "isc_b", provider: "codex", title: "Release work", startedAt: D(9, 1), importedAt: D(9, 2), continuedThreadId: "c3" },
];

/** Row ids only, not the slots inside a row. */
const rowIds = (root: Node, prefix: string): string[] => ids(root).filter((i) => i.startsWith(prefix) && !i.endsWith("-leading") && !i.endsWith("-trailing"));
const ids = (n: Node | string, out: string[] = []): string[] => { if (typeof n === "string") return out; const t = n.props["data-testid"]; if (typeof t === "string") out.push(t); (n.children ?? []).forEach((c) => ids(c, out)); return out; };
/** The rows drawn selected, by their entry key. */
const selectedRows = (root: Node): string[] => {
  const out: string[] = [];
  const walk = (n: Node | string): void => { if (typeof n === "string") return; const t = n.props["data-testid"]; if (typeof t === "string" && t.startsWith("row-") && n.props["aria-selected"] === true) out.push(t.slice(4)); (n.children ?? []).forEach(walk); };
  walk(root);
  return out;
};
const chainTo = (n: Node, id: string, up: Node[] = []): Node[] | null => { if (n.props["data-testid"] === id) return up; for (const c of n.children ?? []) if (typeof c !== "string") { const f = chainTo(c, id, [...up, n]); if (f) return f; } return null; };
/** Right-click on a row: the nearest ancestor that opens its menu. */
const rightClick = async (root: Node, rowId: string): Promise<void> => {
  const w = [...(chainTo(root, rowId) ?? [])].reverse().find((n) => typeof n.props.onContextMenu === "function");
  assert.ok(w, `${rowId} opens a menu on right-click`);
  await act(async () => { (w.props.onContextMenu as (e: unknown) => void)({ preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} }); });
  await flush();
};

/** The sidebar drawn with what the middle shows; `show` changes that the way a tab, a link or Cmd-K does (the place re-renders it with the new open key). */
async function drawn(o: { imported?: SampleImported[]; open?: string | null; artifacts?: boolean } = {}) {
  installDom();
  const s = createSampleSidebar(northwind, o.imported ? { imported: o.imported } : {});
  const news: string[] = [];
  const data = { ...s.data, nav: { ...s.data.nav, openImported: (id: string) => void s.opened.push(`imported:${id}`), openNew: () => void news.push("new"), ...(o.artifacts ? { openArtifacts: () => void s.opened.push("artifacts") } : {}) } };
  const r = createRoot();
  const el = (open: string | null): ReactElement => <ChatsSidebar data={data} window={{ start: 0, end: 500 }} open={open} />;
  await act(async () => { r.render(el(o.open ?? null)); });
  await flush();
  const root = r.container as unknown as Node;
  const show = async (open: string | null): Promise<void> => { await act(async () => { r.render(el(open)); }); await flush(); };
  return { s, root, show, news };
}

/* ---------- what is open, as a key ---------- */

test("every page the place can show has its open key, from a tab, a link or Cmd-K alike; a page with no row has none", () => {
  assert.equal(openKeyOf(fromHash("subject=thread:c2").route), "t:c2", "a chat's tab");
  assert.equal(openKeyOf(fromHash("screen=chats.conversation&threadId=c2").route), "t:c2", "a link to a chat");
  assert.equal(openKeyOf(fromHash("subject=channel:th_general").route), "t:th_general", "a channel is its thread");
  assert.equal(openKeyOf(fromHash("screen=tasks.my-work").route), "tasks");
  assert.equal(openKeyOf(fromHash("screen=chats.threads").route), "threads");
  assert.equal(openKeyOf(fromHash("screen=chats.artifacts").route), "artifacts");
  assert.equal(openKeyOf(fromHash("screen=chats.agent-page&agentId=agt_docs").route), "a:agt_docs", "Cmd-K to an agent");
  assert.equal(openKeyOf(fromHash("screen=chats.agent-form&agentId=agt_docs").route), "a:agt_docs");
  assert.equal(openKeyOf(step(START, { t: "imported", conversationId: "isc_a" }).route), "i:isc_a");
  for (const none of [START, fromHash("screen=chats.agent-form"), fromHash("subject=task:tsk_1"), fromHash("screen=tasks.needs-you"), fromHash("screen=chats.helper-chat&threadId=h1"), step(START, { t: "search", q: "x" })]) {
    assert.equal(openKeyOf(none.route), null, JSON.stringify(none.route));
  }
});

test("the open row is the chat, else the channel of its thread, else the imported session continued in it; an agent's page is its face; nothing when it has no row", () => {
  const chan = { channelId: "general", mainThreadId: "th_general", name: "general", visibility: "public", archived: false, members: [], agents: [], unread: 0, createdAt: 1 } as unknown as Channel;
  const row = { threadId: "c1", title: "Rivera intake", who: "Intake", kind: "agent" as const, unread: 0, working: false, starred: false, lastAt: 1, local: false };
  const input: SidebarInput = {
    faces: [{ agentId: "agt_docs", name: "Docs" } as never], workingAgents: new Set(), groups: [{ key: "today", label: "Today", rows: [row] }], channels: [chan], filter: "all", closed: new Set(),
    imported: importedRows([{ conversationId: "isc_a", title: "A", startedAt: 2 }, { conversationId: "isc_b", title: "B", startedAt: 1, continuedThreadId: "thr_gone" }]),
  };
  const entries = buildEntries(input);
  assert.equal(openEntry(entries, "t:c1"), "c:c1");
  assert.equal(openEntry(entries, "t:th_general"), "ch:general");
  assert.equal(openEntry(entries, "t:thr_gone"), "i:isc_b", "a continued chat with no row of its own lights its imported session");
  assert.equal(openEntry(entries, "i:isc_a"), "i:isc_a");
  assert.equal(openEntry(entries, "a:agt_docs"), "f:agt_docs");
  assert.equal(openEntry(entries, "tasks"), "nav:tasks");
  assert.equal(openEntry(entries, "threads"), "nav:threads");
  assert.equal(openEntry(entries, "artifacts"), "artifacts");
  assert.equal(openEntry(entries, "t:c9"), null, "a chat with no row");
  assert.equal(openEntry(entries, "a:agt_none"), null);
  assert.equal(openEntry(entries, "i:isc_none"), null);
  assert.equal(openEntry(entries, null), null);
  assert.equal(openEntry(buildEntries({ ...input, closed: new Set(["imported" as const]) }), "i:isc_a"), null, "a folded group shows no row to select");
});

/* ---------- the drawn list follows the page ---------- */

test("selection follows the open page across a tab switch, a link and Cmd-K for every row type, and nothing is selected when the page has no row", async () => {
  const { root, show } = await drawn({ imported: IMPORTED, open: "t:c1", artifacts: true });
  assert.deepEqual(selectedRows(root), ["c:c1"], "the open chat");
  const channel = rowIds(root, "row-ch:")[0]!.slice("row-ch:".length);
  await show(`t:th_${channel}`);
  assert.deepEqual(selectedRows(root), [`ch:${channel}`], "a tab switch to a channel moves it; the chat it left is not selected");
  const face = rowIds(root, "row-f:").find((i) => i !== "row-f:agt_assistant")!.slice("row-".length);
  await show(`a:${face.slice(2)}`);
  assert.deepEqual(selectedRows(root), [face], "a link to an agent's page selects its face");
  await show("tasks");
  assert.deepEqual(selectedRows(root), ["nav:tasks"]);
  await show("threads");
  assert.deepEqual(selectedRows(root), ["nav:threads"]);
  await show("artifacts");
  assert.deepEqual(selectedRows(root), ["artifacts"]);
  await show("i:isc_a");
  assert.deepEqual(selectedRows(root), ["i:isc_a"], "an imported transcript");
  await show("t:c3");
  assert.deepEqual(selectedRows(root), ["c:c3"], "Cmd-K to another chat: the imported row is no longer lit while you are not in it");
  await show(null);
  assert.deepEqual(selectedRows(root), [], "a new chat has no row: nothing is selected");
  await show("t:thr_nowhere");
  assert.deepEqual(selectedRows(root), [], "a chat with no row in the list: nothing");
});

test("a press opens the page but the selection waits for it: a row stays unselected until the place shows it", async () => {
  const { s, root, show } = await drawn({ imported: IMPORTED, open: "t:c1" });
  await press(find(root, "row-i:isc_a"));
  await flush();
  assert.deepEqual(s.opened.slice(-1), ["imported:isc_a"], "the press asks the place to open the transcript");
  assert.deepEqual(selectedRows(root), ["c:c1"], "the open page has not changed yet");
  await show("i:isc_a");
  assert.deepEqual(selectedRows(root), ["i:isc_a"]);
});

test("the arrow keys move a cursor of their own; it goes back to the open row when the page changes", async () => {
  const { root, show } = await drawn({ imported: IMPORTED, open: "t:c1" });
  const list = (): Node => find(root, "chats-sidebar")!;
  assert.equal(list().props["aria-activedescendant"], "row-c:c1", "the cursor starts on the open row");
  await act(async () => { (list().props.onKeyDown as (e: { key: string; preventDefault(): void }) => void)({ key: "ArrowDown", preventDefault() {} }); });
  await flush();
  const moved = String(list().props["aria-activedescendant"]);
  assert.notEqual(moved, "row-c:c1", "the arrow moved the cursor");
  assert.deepEqual(selectedRows(root), ["c:c1"], "the selection stays on the open page");
  assert.ok(find(root, moved), `the cursor is on a drawn row (${moved})`);
  assert.notEqual(find(root, moved)?.props["aria-selected"], true, "the cursor row is not drawn selected");
  await show("t:c3");
  assert.equal(list().props["aria-activedescendant"], "row-c:c3", "a new page puts the cursor on its row");
});

/* ---------- the Imported rows ---------- */

test("an imported row's menu is Open, Rename, Archive or Unarchive, and Delete session; delete asks first and says the chat stays when there is one", () => {
  const noop = { open() {}, rename() {}, archive() {}, unarchive() {}, deleteSession() {} };
  const [a, b] = importedRows(IMPORTED);
  const labels = (r: typeof a): string[] => importedMenuEntries(r!, noop).flatMap((e) => ("label" in e ? [e.label] : []));
  assert.deepEqual(labels(a), ["Open", "Rename", "Archive", "Delete session"]);
  assert.deepEqual(labels({ ...a!, archived: true }), ["Open", "Rename", "Unarchive", "Delete session"]);
  assert.deepEqual(importedMenuEntries(a!, noop).filter((e) => "danger" in e && e.danger === true).map((e) => ("label" in e ? e.label : "")), ["Delete session"]);
  const continued = IMPORTED[1]!.continuedThreadId ? b! : a!;
  assert.deepEqual(importedDeleteConfirm(continued, () => undefined).map((e) => ("head" in e ? e.head : "label" in e ? e.label : "-")), ["Delete this imported session? Its chat stays.", "Delete session", "Cancel"]);
  assert.equal((importedDeleteConfirm(a!, () => undefined)[0] as { head: string }).head, "Delete this imported session?");
});

test("a continued session shows its chat's last day, not the word Chat; one never continued shows the day it started", async () => {
  const { root } = await drawn({ imported: IMPORTED, open: null });
  assert.equal(textOf(find(root, "imported-day-isc_b")).trim(), "Oct 24", "the day October invoices was last active");
  assert.equal(textOf(find(root, "imported-day-isc_a")).trim(), "Oct 20");
  assert.ok(!textOf(find(root, "imported-row-isc_b")).includes("Chat"));
});

test("right-click and the row's ... open the same menu; Rename edits the title in the row and keeps it", async () => {
  const { s, root } = await drawn({ imported: IMPORTED, open: "i:isc_a" });
  // the "..." shows while the pointer is on the row
  const hot = [...(chainTo(root, "row-i:isc_a") ?? [])].reverse().find((n) => typeof n.props.onMouseEnter === "function");
  assert.ok(hot, "the row reacts to the pointer");
  await act(async () => { (hot.props.onMouseEnter as () => void)(); });
  await flush();
  await press(find(root, "more-i:isc_a"));
  await flush();
  assert.ok(find(root, "menu-item-Rename") && find(root, "menu-item-Archive") && find(root, "menu-item-Delete session") && find(root, "menu-item-Open"), "the ... opens the menu");
  await rightClick(root, "row-i:isc_a");
  await press(find(root, "menu-item-Rename"));
  await flush();
  const field = find(root, "imported-rename-isc_a");
  assert.ok(field, "the title becomes a field in the row");
  await typeInto(field, "Login fix, round two");
  await act(async () => { (find(root, "imported-rename-isc_a")!.props.onBlur as (e: unknown) => void)({ nativeEvent: {}, target: { value: "Login fix, round two" } }); });
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "sessions.rename").map((c) => c.input), [{ conversationId: "isc_a", title: "Login fix, round two" }]);
  assert.equal(find(root, "imported-rename-isc_a"), null, "the field closes");
  assert.equal(find(root, "row-i:isc_a")?.props["aria-label"], "Login fix, round two", "the row has the new name");
  const kept = await s.data.call("sessions.list", {}) as { sessions: { conversationId: string; title: string }[] };
  assert.equal(kept.sessions.find((x) => x.conversationId === "isc_a")?.title, "Login fix, round two", "the name persists where the list is read from");
  assert.deepEqual(s.rejected, [], "every call inside the contract");
});

test("Escape, or leaving the name as it was, renames nothing", async () => {
  const { s, root } = await drawn({ imported: IMPORTED });
  await rightClick(root, "row-i:isc_a");
  await press(find(root, "menu-item-Rename"));
  await flush();
  await act(async () => { (find(root, "imported-rename-isc_a")!.props.onBlur as (e: unknown) => void)({ nativeEvent: {}, target: { value: "Fix the login" } }); });
  await flush();
  assert.equal(s.calls.filter((c) => c.cap === "sessions.rename").length, 0);
  assert.equal(find(root, "row-i:isc_a")?.props["aria-label"], "Fix the login");
});

test("Archive moves an imported session into the Archived section, and Unarchive puts it back", async () => {
  const { s, root } = await drawn({ imported: IMPORTED });
  await rightClick(root, "row-i:isc_a");
  await press(find(root, "menu-item-Archive"));
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "sessions.archive").map((c) => c.input), [{ conversationId: "isc_a" }]);
  assert.ok(!ids(root).includes("row-i:isc_a"), "gone from Imported");
  assert.ok(ids(root).includes("head-archived") && textOf(find(root, "count-archived")).trim() === "1", "the Archived head counts it");
  await press(find(root, "toggle-archived"));
  await flush();
  assert.ok(ids(root).includes("row-i:isc_a"), "it is in the Archived section");
  await rightClick(root, "row-i:isc_a");
  assert.ok(find(root, "menu-item-Unarchive") && !find(root, "menu-item-Archive"));
  await press(find(root, "menu-item-Unarchive"));
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "sessions.archive").map((c) => c.input), [{ conversationId: "isc_a" }, { conversationId: "isc_a", unarchive: true }]);
  assert.ok(!ids(root).includes("head-archived"), "nothing archived, no section");
  assert.ok(ids(root).includes("row-i:isc_a"), "back under Imported");
  assert.deepEqual(s.rejected, []);
});

test("Delete asks in the menu, removes the imported copy, keeps the chat it was continued in, and leaves its open transcript", async () => {
  const { s, root, news } = await drawn({ imported: IMPORTED, open: "i:isc_b" });
  await rightClick(root, "row-i:isc_b");
  await press(find(root, "menu-item-Delete session"));
  await flush();
  assert.ok(textOf(root).includes("Delete this imported session? Its chat stays."), "a plain confirm in the menu");
  assert.equal(s.calls.filter((c) => c.cap === "sessions.delete").length, 0, "nothing is deleted before the confirm");
  await press(find(root, "menu-item-Delete session"));
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "sessions.delete").map((c) => c.input), [{ conversationId: "isc_b" }]);
  assert.ok(!ids(root).includes("row-i:isc_b"), "the imported row is gone");
  assert.ok(ids(root).includes("row-c:c3"), "the chat it was continued in stays");
  assert.equal(s.calls.filter((c) => c.cap.startsWith("threads.")).length, 0, "no chat is touched");
  assert.deepEqual(news, ["new"], "the transcript that was open goes: the place shows a new chat");
  assert.deepEqual(s.rejected, []);
});

test("Cancel in the delete confirm deletes nothing", async () => {
  const { s, root } = await drawn({ imported: IMPORTED });
  await rightClick(root, "row-i:isc_a");
  await press(find(root, "menu-item-Delete session"));
  await flush();
  await press(find(root, "menu-item-Cancel"));
  await flush();
  assert.equal(s.calls.filter((c) => c.cap === "sessions.delete").length, 0);
  assert.ok(ids(root).includes("row-i:isc_a"));
});

test("a sidebar drawn alone, with no page beside it, keeps the row last pressed selected", async () => {
  installDom();
  const s = createSampleSidebar(northwind);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={{ start: 0, end: 500 }} />);
  assert.deepEqual(selectedRows(root), []);
  await press(find(root, "row-c:c3"));
  await flush();
  assert.deepEqual(selectedRows(root), ["c:c3"]);
});
