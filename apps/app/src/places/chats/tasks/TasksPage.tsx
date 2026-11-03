// Tasks (spec "Tasks"): one list ordered for you, across Mine, Given by you, Everyone and any project, as a List, a Board, a Timeline or a Month. It opens painted from what this device holds, reads the list only when a
// task changed, and draws what fits the window, so 5,000 tasks feel like ten. Status has one path from every door. Keys: C new, J K move, Enter open, S status, A assign, X select, 1 to 6 status, / search.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { QueryState } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { DeferredComposer as Composer } from "../../../../../../ui/src/Composer/Deferred.tsx";
import type { ComposerSend } from "../../../../../../ui/src/Composer/index.tsx";
import { DropZone, HeldFiles } from "../../../../../../ui/src/FileDrop/index.tsx";
import type { DroppedFile } from "../../../../../../ui/src/FileDrop/index.tsx";
import { postWithFiles, uploadAttachments, uploadDeps } from "../conversation/actions.ts";
import { realAssistant } from "../landing/model.ts";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Segmented } from "../../../../../../ui/src/Segmented/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { TASK_STATES } from "../../../../../../ui/src/TaskPage/model.ts";
import type { TaskState } from "../../../../../../ui/src/TaskPage/model.ts";
import { StatusDot } from "../../../../../../ui/src/TaskPage/StatusDot.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { Glyph } from "../conversation/parts.tsx";
import { nameOr } from "../names.ts";
import { useLive } from "../mounts/live.ts";
import { QuickField } from "./QuickField.tsx";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import type { ActEnv } from "./actions.ts";
import { bulkAssign, bulkDelete, bulkDue, bulkLabel, bulkMove, bulkPriority, bulkStatus, dueEntries, failure, keepQuiet, letGo, priorityEntries, setStatus, snoozeQuiet } from "./actions.ts";
import { Board } from "./Board.tsx";
import { buildEntries, DAY, filterRows, GROUPS, heightOf, holderOf, isFiltered, NO_FILTER, SORTS } from "./model.ts";
import type { Entry, Filter, GroupKey, IndexOut, NeedItem, ScopeKind, SortKey, TaskRow, ViewKind, Who } from "./model.ts";
import { faceKind, NeedLine, rowStyles, TaskLine, TextMenu } from "./parts.tsx";
import type { RowEnv } from "./parts.tsx";
import { parseQuick } from "./quick.ts";
import type { QuickPerson } from "./quick.ts";
import { storeFor } from "./store.ts";
import { CalendarView, Timeline } from "./Timeline.tsx";
import { offered } from "../../../shell/session/private-agents.ts";

export const TASKS_SCREEN = "tasks.my-work";
type NeedsOut = CapMap["tasks.needs_you"]["out"];
type ProjectRow = { projectId: string; recordId: string; title: string };
type ViewRow = CapMap["views.list"]["out"]["views"][number];
type Scope = { kind: ScopeKind } | { kind: "project"; recordId: string; title: string };

const VIEWS = [{ id: "list", label: "List" }, { id: "board", label: "Board" }, { id: "timeline", label: "Timeline" }, { id: "calendar", label: "Month" }] as const;
const newKey = (): string => `task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
const NO_ROWS: readonly TaskRow[] = [];
const NO_NEEDS: readonly NeedItem[] = [];

export interface TasksPageProps {
  rt: ShellRuntime;
  openTask(taskId: string): void;
  openAgent(agentId: string): void;
  openChat(text: string): void;
  /** Pins which rows are drawn (tests and screenshots draw them all). */
  window?: VirtualWindow;
}

export function TasksPage({ rt, openTask, openAgent, openChat, window }: TasksPageProps): ReactElement {
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < 720;
  const menu = useMenu();
  const [scope, setScope] = useState<Scope>({ kind: "mine" });
  const [view, setView] = useState<ViewKind>("list");
  const [group, setGroup] = useState<GroupKey>("smart");
  const [sort, setSort] = useState<SortKey>("smart");
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [line, setLine] = useState<{ text: string; undo?: () => void } | null>(null);
  const [doneRows, setDoneRows] = useState<readonly TaskRow[] | null>(null);
  const [quietOpen, setQuietOpen] = useState(false);
  const [quick, setQuick] = useState("");
  // files dropped or pasted on quick add: held beside the field, stored the way a chat stores its uploads, and made the new task's attachments
  const [quickFiles, setQuickFiles] = useState<readonly DroppedFile[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const addRef = useRef<TextInput | null>(null);
  const searchRef = useRef<TextInput | null>(null);

  const say = useCallback((text: string, undo?: () => void): void => setLine(undo ? { text, undo } : { text }), []);
  useEffect(() => { if (!line) return undefined; const t = setTimeout(() => setLine(null), line.undo ? 8000 : 4000); return () => clearTimeout(t); }, [line]);

  /* ---------- the list, from this device, read again when a task changed ---------- */
  const key = useMemo(() => (scope.kind === "project" ? { scope: "everyone" as const, recordId: scope.recordId } : { scope: scope.kind }), [scope]);
  const store = useMemo(() => storeFor(rt, rt.call, key), [rt, key]);
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get);
  const rev = useLive<{ rev: string }>(rt.screens, TASKS_SCREEN, "rev", {});
  const revValue = rev.status === "ready" ? rev.data.rev : undefined;
  useEffect(() => { store.refresh(revValue); }, [store, revValue]);
  useEffect(() => { setDoneRows(null); setSelected(new Set()); setCursor(-1); }, [store]);
  const needsQ = useLive<NeedsOut>(rt.screens, TASKS_SCREEN, "needs", { limit: 200 });
  const needs = needsQ.status === "ready" ? needsQ.data.items : NO_NEEDS;
  const people = useSyncExternalStore(rt.principals.subscribe, rt.principals.getSnapshot, rt.principals.getSnapshot) as QueryState<Array<{ id: string; name: string; kind: string; username?: string }>>;
  const list = people.status === "ready" ? people.data : [];
  const byId = useMemo(() => new Map(list.map((p) => [p.id, p] as const)), [list]);
  const [projects, setProjects] = useState<readonly ProjectRow[]>([]);
  const [savedViews, setSavedViews] = useState<readonly ViewRow[]>([]);
  const readViews = useCallback((): void => { void rt.call("views.list", { type: "task" }).then((o) => setSavedViews((o as CapMap["views.list"]["out"]).views), () => setSavedViews([])); }, [rt]);
  useEffect(() => { void rt.call("projects.list", {}).then((o) => setProjects((o as { projects: ProjectRow[] }).projects), () => setProjects([])); readViews(); }, [rt, readViews]);
  const projectName = useMemo(() => new Map(projects.map((p) => [p.recordId, p.title] as const)), [projects]);
  const keys = useMemo(() => new Map(snap.rows.map((r) => [r.id, r.key] as const)), [snap.rows]);
  const nameOf = useCallback((id: string): string => (id === rt.me.id ? "You" : id === rt.assistant.id ? rt.assistant.name : nameOr(byId.get(id)?.name, id)), [byId, rt.me.id, rt.assistant.id, rt.assistant.name]);
  const clock = rt.clock();
  const dayOfNow = Math.floor(clock.now / 60_000);   // the list is ordered by the minute: a repaint does not reorder it under the pointer
  const now = dayOfNow * 60_000;

  const act: ActEnv = useMemo(() => ({ call: rt.call, say, store, newKey, now: () => rt.clock().now, offsetMin: rt.clock().offsetMin }), [rt, say, store]);

  /* ---------- status: one path from every door ---------- */
  const statusMenu = useCallback((row: TaskRow, at: { x: number; y: number }): void => {
    const items: MenuEntry[] = [];
    for (const [i, s] of TASK_STATES.entries()) items.push({ label: s.title, leading: <StatusDot state={s.key} size={14} />, checked: s.key === row.state, count: i + 1, onSelect: () => void setStatus(act, row, s.key) });
    menu.show(items, at.x, at.y, "other", { label: "Status" });
  }, [act, menu]);

  const assignMenu = useCallback((ids: readonly string[], at: { x: number; y: number }): void => {
    const entries: MenuEntry[] = [];
    for (const p of list) if (p.kind === "person" || p.kind === "agent") entries.push({ label: p.id === rt.me.id ? "You" : p.name, leading: <Avatar name={p.name} seedId={p.id} kind={faceKind({ kind: p.kind as Who["kind"], id: p.id })} size={16} />, onSelect: () => void bulkAssign(act, ids, { kind: p.kind as Who["kind"], id: p.id }, p.id === rt.me.id ? "you" : p.name) });
    menu.show(entries, at.x, at.y, "other", { label: "Assign" }, { search: "Find someone" });
  }, [act, list, menu, rt.me.id]);

  const labelsIn = useMemo(() => { const s = new Set<string>(); for (const r of snap.rows) for (const l of r.labels) s.add(l); return [...s].sort(); }, [snap.rows]);
  const labelMenu = useCallback((ids: readonly string[], at: { x: number; y: number }): void => {
    const on = (l: string): boolean => ids.every((id) => store.byId(id)?.labels.includes(l));
    menu.show(labelsIn.length === 0 ? [{ head: "No labels yet. Add one with #word when you make a task." }] : labelsIn.map((l) => ({ label: `#${l}`, checked: on(l), onSelect: () => void bulkLabel(act, ids, l, !on(l)) })), at.x, at.y, "other", { label: "Labels" });
  }, [act, labelsIn, menu, store]);
  const moveMenu = useCallback((ids: readonly string[], at: { x: number; y: number }): void => {
    menu.show(projects.length === 0 ? [{ head: "No projects yet." }] : projects.map((p) => ({ label: p.title, onSelect: () => void bulkMove(act, ids, p.recordId, p.title) })), at.x, at.y, "other", { label: "Move to a project" });
  }, [act, menu, projects]);
  const dueMenu = useCallback((ids: readonly string[], at: { x: number; y: number }): void => menu.show(dueEntries(act, (when, words) => void bulkDue(act, ids, when, words)), at.x, at.y, "other", { label: "Due" }), [act, menu]);

  const pick = useCallback((id: string, _range: boolean): void => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const rowMenu = useCallback((row: TaskRow, at: { x: number; y: number }): void => {
    const ids = selected.has(row.id) ? [...selected] : [row.id];
    const items: MenuEntry[] = [
      { label: "Open", onSelect: () => openTask(row.id) },
      { label: selected.has(row.id) ? "Deselect" : "Select", onSelect: () => pick(row.id, false) },
      { separator: true },
      { label: "Status…", onSelect: () => statusMenu(row, at) },
      { label: "Assign…", onSelect: () => assignMenu(ids, at) },
      { label: "Due…", onSelect: () => dueMenu(ids, at) },
      { label: "Priority…", onSelect: () => menu.show(priorityEntries(row.priority, (k, w) => void bulkPriority(act, ids, k, w)), at.x, at.y, "other", { label: "Priority" }) },
      { label: "Labels…", onSelect: () => labelMenu(ids, at) },
      { label: "Move to a project…", onSelect: () => moveMenu(ids, at) },
      { separator: true },
      { label: "Duplicate", onSelect: () => void rt.call("tasks.create", { title: `${row.title} (copy)`, assigned: row.assigned, labels: row.labels, ...(row.due !== undefined ? { due: row.due } : {}), ...(row.priority ? { priority: row.priority } : {}), ...(row.recordId ? { recordId: row.recordId } : {}), idempotencyKey: newKey() }).then(() => say("Duplicated"), (e: unknown) => say(failure(e, "It could not be copied."))) },
      { label: "Delete", danger: true, onSelect: () => void bulkDelete(act, ids) },
    ];
    menu.show(items, at.x, at.y, "context", { label: row.title });
  }, [act, assignMenu, dueMenu, labelMenu, menu, moveMenu, openTask, pick, rt, say, selected, statusMenu]);

  const actNeed = useCallback((item: NeedItem, key: string): void => {
    void rt.call("tasks.act", { taskId: item.task.id, action: key }).then(() => say(`Approved: ${item.task.title}`), (e: unknown) => say(failure(e, "That could not be done.")));
  }, [rt, say]);

  const openProfile = useCallback((who: Who): void => { if (who.kind === "agent") openAgent(who.id); else rt.open({ subject: { type: "contact", id: who.id } }); }, [openAgent, rt]);

  const env: RowEnv = useMemo(() => ({
    now, offsetMin: clock.offsetMin, me: rt.me.id, turns: rt.turns, nameOf, project: (id) => projectName.get(id), keyOf: (id) => keys.get(id),
    open: openTask, openProfile, status: statusMenu, menu: rowMenu, pick, act: actNeed,
  }), [now, clock.offsetMin, rt.me.id, rt.turns, nameOf, projectName, keys, openTask, openProfile, statusMenu, rowMenu, pick, actNeed]);

  /* ---------- what is drawn ---------- */
  const scopeKind = scope.kind;
  const entries = useMemo(() => buildEntries({
    rows: snap.rows, needs, me: rt.me.id, now, offsetMin: clock.offsetMin, scope: scopeKind, group, sort, filter, doneRows, doneCount: snap.doneThisWeek, quietOff: false,
    names: { name: nameOf, project: (id) => projectName.get(id) },
  }), [snap.rows, snap.doneThisWeek, needs, rt.me.id, now, clock.offsetMin, scopeKind, group, sort, filter, doneRows, nameOf, projectName]);
  const taskIndex = useMemo(() => { const out: number[] = []; for (const [i, e] of entries.entries()) if (e.kind === "task") out.push(i); return out; }, [entries]);
  const currentRow = useMemo((): TaskRow | undefined => { const e = entries[taskIndex[cursor] ?? -1]; return e?.kind === "task" ? e.row : undefined; }, [entries, taskIndex, cursor]);

  // the board's last column: what finished, read again whenever a task changed
  const [boardDone, setBoardDone] = useState<readonly TaskRow[]>(NO_ROWS);
  useEffect(() => {
    if (view !== "board") return;
    void rt.call("tasks.index", { scope: key.scope, ...(key.recordId ? { recordId: key.recordId } : {}), done: true }).then((o) => setBoardDone((o as IndexOut).rows), (e: unknown) => say(failure(e, "Couldn't read what is done.")));
  }, [view, key, rt, say, snap.rev]);

  const toggleDone = useCallback((): void => {
    if (doneRows) { setDoneRows(null); return; }
    void rt.call("tasks.index", { scope: key.scope, ...(key.recordId ? { recordId: key.recordId } : {}), done: true }).then((o) => setDoneRows((o as IndexOut).rows), (e: unknown) => say(failure(e, "Couldn't read what is done.")));
  }, [doneRows, key, rt, say]);

  const addTask = useCallback((): void => {
    const q = parseQuick(quick, list.filter(offered) as readonly QuickPerson[], rt.clock().now, rt.clock().offsetMin);
    const files = quickFiles;
    // a file dropped with no words names the task after itself
    const title = q.title !== "" ? q.title : files[0]?.name ?? "";
    if (title === "") return;
    const assigned: Who = q.assignee ? { kind: q.assignee.kind as Who["kind"], id: q.assignee.id } : { kind: "person", id: rt.me.id };
    setQuick("");
    setQuickFiles([]);
    const key = newKey();
    const stored = files.length > 0 ? uploadAttachments(uploadDeps(rt), files.map((f) => ({ name: f.name, file: f, ...(f.type ? { mime: f.type } : {}) })), `task-files:${key}`) : Promise.resolve([]);
    void stored.then((fileIds) => rt.call("tasks.create", { title, assigned, labels: q.labels, ...(q.due !== undefined ? { due: q.due } : {}), ...(q.priority ? { priority: q.priority } : {}), ...(scope.kind === "project" ? { recordId: scope.recordId } : {}), ...(fileIds.length > 0 ? { fileIds } : {}), idempotencyKey: key })).then(
      () => store.refresh(),
      (e: unknown) => { setQuick(quick); setQuickFiles(files); say(failure(e, "The task could not be made.")); },
    );
  }, [list, quick, quickFiles, rt, say, scope, store]);

  // the Ask line under the list: words open a chat with the assistant; with files, the chat is started here so the files go with the first message
  const askAssistant = useCallback((p: ComposerSend): void => {
    if (p.files.length === 0) { openChat(p.text); return; }
    const text = p.text.trim();
    const key = newKey();
    void realAssistant(rt.assistant.id, (cap, input) => rt.call(cap as never, input as never)).then((agentId) => {
      if (agentId === null) throw new Error("no assistant yet");
      return rt.call("chat.start", { kind: "chat", agentIds: [agentId], title: (text || p.files[0]!.name).split(/\s+/).slice(0, 6).join(" "), idempotencyKey: key });
    }).then(async (out) => {
      const id = (out as CapMap["chat.start"]["out"]).thread.threadId;
      await postWithFiles(uploadDeps(rt), id, text, p.files, `tasks-ask:${key}`);
      rt.open({ subject: { type: "thread", id } });
    }).catch((e: unknown) => say(failure(e, "Could not start the chat with those files.")));
  }, [openChat, rt, say]);

  /* ---------- keys ---------- */
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const g = globalThis as unknown as { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void };
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.isContentEditable === true || /INPUT|TEXTAREA/.test(target?.tagName ?? "")) return;
      const at = (): { x: number; y: number } => { const d = (globalThis as unknown as { document: Document }).document.querySelector(`[data-tk="${currentRow?.id ?? ""}"]`)?.getBoundingClientRect(); return { x: d?.left ?? 240, y: (d?.bottom ?? 160) + 4 }; };
      const ids = selected.size > 0 ? [...selected] : currentRow ? [currentRow.id] : [];
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(taskIndex.length - 1, c + 1)); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (e.key === "Enter" && currentRow) openTask(currentRow.id);
      else if (e.key === "x" && currentRow) pick(currentRow.id, false);
      else if (e.key === "c") { e.preventDefault(); setView("list"); addRef.current?.focus(); }
      else if (e.key === "/") { e.preventDefault(); setSearching(true); searchRef.current?.focus(); }
      else if (e.key === "s" && currentRow) statusMenu(currentRow, at());
      else if (e.key === "a" && ids.length > 0) assignMenu(ids, at());
      else if (e.key === "Escape") setSelected(new Set());
      else if (/^[1-6]$/.test(e.key) && ids.length > 0) { e.preventDefault(); void bulkStatus(act, ids, TASK_STATES[Number(e.key) - 1]!.key); }
    };
    g.addEventListener("keydown", onKey);
    return () => g.removeEventListener("keydown", onKey);
  }, [act, assignMenu, currentRow, openTask, pick, selected, statusMenu, taskIndex.length]);

  /* ---------- the bar ---------- */
  const scopeTitle = savedName ?? (scope.kind === "mine" ? "Mine" : scope.kind === "given" ? "Given by you" : scope.kind === "everyone" ? "Everyone" : scope.title);
  const applySaved = (v: ViewRow): void => {
    const c = (v.config ?? {}) as { scope?: Scope; view?: ViewKind; sort?: SortKey; filter?: Filter };
    if (c.scope) setScope(c.scope);
    if (c.view) setView(c.view);
    setGroup((v.group as GroupKey | undefined) ?? "smart");
    setSort(c.sort ?? "smart");
    setFilter(c.filter ?? NO_FILTER);
    setSavedName(v.title);
  };
  const scopeMenu = (at: { x: number; y: number }): void => {
    const choose = (s: Scope): void => { setScope(s); setSavedName(null); };
    const items: MenuEntry[] = [
      { label: "Mine", checked: scope.kind === "mine", onSelect: () => choose({ kind: "mine" }) },
      { label: "Given by you", checked: scope.kind === "given", onSelect: () => choose({ kind: "given" }) },
      { label: "Everyone", checked: scope.kind === "everyone", onSelect: () => choose({ kind: "everyone" }) },
    ];
    if (projects.length > 0) { items.push({ head: "Projects" }); for (const p of projects.slice(0, 30)) items.push({ label: p.title, checked: scope.kind === "project" && scope.recordId === p.recordId, onSelect: () => choose({ kind: "project", recordId: p.recordId, title: p.title }) }); }
    if (savedViews.length > 0) { items.push({ head: "Saved views" }); for (const v of savedViews) items.push({ label: v.title, checked: savedName === v.title, onSelect: () => applySaved(v) }); }
    items.push({ separator: true }, { label: "Save this view…", onSelect: () => setSaving("") });
    const current = savedViews.find((v) => v.title === savedName);
    if (current) {
      items.push({ label: current.shared ? "Make personal" : "Share with everyone", onSelect: () => void rt.call("views.publish", { viewId: current.viewId, shared: !current.shared }).then(() => { readViews(); say(current.shared ? "Only you see this view now" : "Everyone can use this view"); }, (e: unknown) => say(failure(e, "That could not be changed."))) });
      items.push({ label: "Delete this view", danger: true, onSelect: () => void rt.call("views.delete", { viewId: current.viewId }).then(() => { setSavedName(null); readViews(); say("View deleted"); }, (e: unknown) => say(failure(e, "It could not be deleted."))) });
    }
    menu.show(items, at.x, at.y, "other", { label: "Show" }, { width: 240 });
  };
  const saveView = (title: string): void => {
    setSaving(null);
    if (title.trim() === "") return;
    void rt.call("views.save", { type: "task", kind: view, title: title.trim(), group, config: { scope, view, sort, filter }, idempotencyKey: newKey() }).then(() => { setSavedName(title.trim()); readViews(); say("View saved"); }, (e: unknown) => say(failure(e, "The view could not be saved.")));
  };
  const arrange = (at: { x: number; y: number }): void => {
    const items: MenuEntry[] = [];
    // only the list groups and sorts; every view filters
    if (view === "list") {
      items.push({ head: "Group by" });
      for (const g of GROUPS) items.push({ label: g.title, checked: group === g.key, onSelect: () => setGroup(g.key) });
      items.push({ head: "Sort by" });
      for (const s of SORTS) items.push({ label: s.title, checked: sort === s.key, onSelect: () => setSort(s.key) });
    }
    items.push({ head: "Show only" });
    items.push({ label: "Waiting on something", checked: filter.waiting, onSelect: () => setFilter((f) => ({ ...f, waiting: !f.waiting })) });
    for (const l of labelsIn.slice(0, 12)) items.push({ label: `#${l}`, checked: filter.label === l, onSelect: () => setFilter((f) => ({ ...f, label: f.label === l ? null : l })) });
    const holders = new Map<string, string>();
    for (const r of snap.rows) { const h = holderOf(r); if (h && holders.size < 12) holders.set(h.id, nameOf(h.id)); }
    for (const [id, n] of holders) items.push({ label: n, checked: filter.person === id, onSelect: () => setFilter((f) => ({ ...f, person: f.person === id ? null : id })) });
    menu.show(items, at.x, at.y, "other", { label: "Arrange" }, { width: 240 });
  };

  const renderItem = useCallback((e: Entry): ReactElement => {
    switch (e.kind) {
      case "head": return <View style={st.wrap}><View style={st.head}><Text style={rowStyles.headText}>{e.title}</Text><Text style={rowStyles.headCount}>{e.count}</Text></View></View>;
      case "need": return <NeedLine item={e.item} env={env} />;
      case "task": { const cur = e.row.id === currentRow?.id; return <TaskLine row={e.row} env={env} selected={selected.has(e.row.id)} current={cur} />; }
      case "quiet": return <QuietLine rows={e.rows} open={quietOpen} onToggle={() => setQuietOpen((o) => !o)} assistant={rt.assistant} act={act} />;
      case "add": return <View style={st.wrap}><DropZone testID="task-quick-drop" onFiles={(f) => setQuickFiles((cur) => [...cur, ...f])} style={QUICK_DROP} radius={8}><View style={st.addRow}><View style={st.addDot} /><QuickField ref={addRef} testID="task-quick-add" label="Add a task" placeholder="Add a task: Call Omar friday @sara #portal" value={quick} onChangeText={setQuick} onSubmit={addTask} people={list.filter(offered) as readonly QuickPerson[]} style={rowStyles.add} /><HeldFiles testID="task-quick-files" files={quickFiles} onRemove={(i) => setQuickFiles((cur) => cur.filter((_, j) => j !== i))} /></View></DropZone></View>;
      case "done": return <View style={st.wrap}><Pressable accessibilityRole="button" accessibilityLabel={`${e.count} done this week`} accessibilityState={{ expanded: e.open }} testID="tasks-done" onPress={toggleDone} style={st.done}><Text style={st.doneText}>{e.open ? "Hide what is done" : `${e.count} done this week`}</Text></Pressable></View>;
      case "empty": return <View style={st.wrap}><Text style={st.empty}>{e.text}</Text></View>;
    }
  }, [act, addTask, currentRow?.id, env, quick, quickFiles, quietOpen, rt.assistant, selected, toggleDone]);

  const body = snap.status === "failed" && snap.rows.length === 0 ? <States kind="error" message="Couldn't load your tasks" cause={snap.error ?? ""} retryable onRetry={() => store.refresh()} />
    : view === "board" ? <Board rows={workOnly(sortedBy(snap.rows, filter))} doneRows={sortedBy(boardDone, filter)} env={env} onDrop={(row, to) => void setStatus(act, row, to)} {...(window ? { window } : {})} />
    : view === "timeline" ? <Timeline rows={workOnly(sortedBy(snap.rows, filter))} env={env} {...(window ? { window } : {})} />
    : view === "calendar" ? <CalendarView rows={sortedBy(snap.rows, filter)} env={env} />
    : <View testID="tasks-list" style={{ flex: 1, minHeight: 0 }}>
      {/* ui-rows-lint: not a list (the items are heads, TaskLine and NeedLine rows; each has a status control, a selection box and its own presses) */}
      <VirtualList data={entries} rowHeight="measure" heightOf={heightOf} keyOf={(e) => e.key} renderItem={renderItem} reveal={taskIndex[cursor] ?? -1} {...(window ? { window } : {})} />
    </View>;

  return <View testID="tasks-page" style={st.root}>
    <View style={[st.bar, view === "list" && st.barList]}>
      <Text accessibilityRole="header" style={st.h1}>Tasks</Text>
      <View style={{ flex: 1 }} />
      {searching || filter.query !== "" ? <TextInput ref={searchRef} autoFocus testID="tasks-search" accessibilityLabel="Search tasks" placeholder="Search" placeholderTextColor="var(--ink-3)" value={filter.query} onChangeText={(q) => setFilter((f) => ({ ...f, query: q }))} onBlur={() => setSearching(false)} style={st.search} /> : <Pressable accessibilityRole="button" accessibilityLabel="Search tasks (/)" testID="tasks-search-open" onPress={() => setSearching(true)} style={st.icon}><Glyph name="search" size={14} /></Pressable>}
      <TextMenu label={view === "list" ? `Group: ${GROUPS.find((g) => g.key === group)?.title ?? "Smart"}` : "Show"} onPress={arrange} testID="tasks-arrange" />
      <TextMenu label={scopeTitle} onPress={scopeMenu} testID="tasks-scope" />
      {narrow ? null : <Segmented label="View" options={VIEWS} value={view} onChange={(v) => setView(v)} testID="tasks-view" />}
    </View>
    {isFiltered(filter) ? <View style={st.showing}><Text style={st.showingText}>{`Showing ${filter.query ? `"${filter.query}"` : filter.waiting ? "what is waiting" : filter.label ? `#${filter.label}` : filter.person ? nameOf(filter.person) : "a filter"}`}</Text><Pressable accessibilityRole="button" accessibilityLabel="Show all" onPress={() => setFilter(NO_FILTER)}><Text style={st.showAll}>Show all</Text></Pressable></View> : null}
    {saving !== null ? <View style={st.showing}><TextInput autoFocus testID="tasks-save-name" accessibilityLabel="Name this view" placeholder="Name this view" placeholderTextColor="var(--ink-3)" value={saving} onChangeText={setSaving} onSubmitEditing={() => saveView(saving)} onBlur={() => setSaving(null)} style={st.search} /></View> : null}
    <View style={{ flex: 1, minHeight: 0 }}>{body}
    {selected.size > 0 ? <BulkBar ids={[...selected]} act={act} onStatus={(at) => { const ids = [...selected]; const items: MenuEntry[] = []; for (const s of TASK_STATES) items.push({ label: s.title, leading: <StatusDot state={s.key as TaskState} size={14} />, onSelect: () => void bulkStatus(act, ids, s.key).then(() => setSelected(new Set())) }); menu.show(items, at.x, at.y, "other", { label: "Status" }); }} onAssign={(at) => assignMenu([...selected], at)} onDue={(at) => dueMenu([...selected], at)} onLabels={(at) => labelMenu([...selected], at)} onMove={(at) => moveMenu([...selected], at)} onDelete={() => { void bulkDelete(act, [...selected]); setSelected(new Set()); }} onClear={() => setSelected(new Set())} /> : null}
    </View>
    {line ? <View accessibilityLiveRegion="polite" testID="tasks-line" style={st.lineBox}><Text style={st.lineText}>{line.text}</Text>{line.undo ? <Pressable accessibilityRole="button" accessibilityLabel="Undo" testID="tasks-undo" onPress={() => { line.undo?.(); setLine(null); }}><Text style={st.undo}>Undo</Text></Pressable> : null}</View> : null}
    <View style={st.composer}><Composer testID="tasks-composer" whoWillAnswer={rt.assistant.name} placeholder={`Ask ${rt.assistant.name}, or type /`} hideWho symbols={["slash"]} onSubmit={askAssistant} /></View>
    {menu.element}
  </View>;
}

/** The board and the dated views show every open row the filter lets through. */
const sortedBy = (rows: readonly TaskRow[], f: Filter): readonly TaskRow[] => filterRows(rows, f);
/** A request is answered, not dragged through statuses: boards and timelines hold work. */
const workOnly = (rows: readonly TaskRow[]): readonly TaskRow[] => rows.filter((r) => r.kind === "work");

function BulkBar({ ids, onStatus, onAssign, onDue, onLabels, onMove, onDelete, onClear }: { ids: readonly string[]; act: ActEnv; onStatus(at: { x: number; y: number }): void; onAssign(at: { x: number; y: number }): void; onDue(at: { x: number; y: number }): void; onLabels(at: { x: number; y: number }): void; onMove(at: { x: number; y: number }): void; onDelete(): void; onClear(): void }): ReactElement {
  return <View testID="tasks-bulk" accessibilityRole="toolbar" style={st.bulk}>
    <Text style={st.bulkCount}>{`${ids.length} selected`}</Text>
    <TextMenu label="Status" onPress={onStatus} testID="bulk-status" />
    <TextMenu label="Assign" onPress={onAssign} testID="bulk-assign" />
    <TextMenu label="Due" onPress={onDue} testID="bulk-due" />
    <TextMenu label="Labels" onPress={onLabels} testID="bulk-labels" />
    <TextMenu label="Move" onPress={onMove} testID="bulk-move" />
    <Pressable accessibilityRole="button" accessibilityLabel="Delete" testID="bulk-delete" onPress={onDelete} style={st.bulkBtn}><Text style={st.bulkDanger}>Delete</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Clear the selection" testID="bulk-clear" onPress={onClear} style={st.bulkBtn}><Text style={st.bulkText}>Clear</Text></Pressable>
  </View>;
}

/** Things do not pile up: the tasks nobody has moved fold into one line from Assistant, with keep, snooze and let go, for all of them or one at a time. */
function QuietLine({ rows, open, onToggle, assistant, act }: { rows: readonly TaskRow[]; open: boolean; onToggle(): void; assistant: { id: string; name: string }; act: ActEnv }): ReactElement {
  const ids = rows.map((r) => r.id);
  const month = (): number => act.now() + 30 * DAY;
  return <View style={st.wrap}><View testID="tasks-quiet" style={st.quiet}>
    <Avatar name={assistant.name} seedId={assistant.id} kind="assistant" size={22} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={st.quietTitle}>{`${rows.length} ${rows.length === 1 ? "task has" : "tasks have"} not moved in weeks`}</Text>
      <Text numberOfLines={1} style={st.quietSub}>{open ? rows.slice(0, 3).map((r) => r.title).join(", ") : "Keep them, snooze them, or let them go"}</Text>
    </View>
    {open ? <>
      <QuietBtn label="Keep" testID="quiet-keep" onPress={() => void keepQuiet(act, ids)} />
      <QuietBtn label="Snooze a month" testID="quiet-snooze" onPress={() => void snoozeQuiet(act, ids, month(), "for a month")} />
      <QuietBtn label="Let go" testID="quiet-letgo" onPress={() => void letGo(act, ids)} />
    </> : <QuietBtn label="Go through them" testID="quiet-open" onPress={onToggle} />}
  </View></View>;
}
function QuietBtn({ label, onPress, testID }: { label: string; onPress(): void; testID: string }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [st.quietBtn, hovered === true && st.quietOver]}><Text style={st.quietBtnText}>{label}</Text></Pressable>;
}

const QUICK_DROP = { minWidth: 0 };

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 34, paddingBottom: 10, paddingHorizontal: 24 },
  barList: { width: "100%", maxWidth: 700, alignSelf: "center", paddingHorizontal: 26 },
  h1: { fontSize: 28, fontWeight: "600", letterSpacing: -0.5, lineHeight: 34, color: "var(--ink)" as string },
  icon: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  search: { width: 180, height: 28, paddingHorizontal: 9, borderRadius: 9, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--sunk)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  showing: { flexDirection: "row", alignItems: "center", gap: 10, width: "100%", maxWidth: 700, alignSelf: "center", paddingHorizontal: 26, height: 28 },
  showingText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  showAll: { fontSize: 12.5, color: "var(--accent)" as string },
  wrap: { width: "100%", maxWidth: 700, alignSelf: "center", paddingHorizontal: 16 },
  head: { flexDirection: "row", alignItems: "flex-end", height: 44, paddingBottom: 8, paddingLeft: 10 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingLeft: 26, paddingRight: 10 },
  addDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderStyle: "dashed", borderColor: "var(--line-2)" as string },
  done: { height: 36, justifyContent: "center", paddingLeft: 26 },
  doneText: { fontSize: 13, color: "var(--ink-3)" as string },
  empty: { paddingTop: 30, textAlign: "center", fontSize: 13.5, color: "var(--ink-3)" as string },
  quiet: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, minHeight: 58, paddingHorizontal: 14, borderRadius: 16, backgroundColor: "var(--sunk)" as string },
  quietTitle: { fontSize: 14, color: "var(--ink)" as string },
  quietSub: { fontSize: 12.5, color: "var(--ink-3)" as string },
  quietBtn: { height: 30, justifyContent: "center", paddingHorizontal: 11, borderRadius: 9 },
  quietOver: { backgroundColor: "var(--hover)" as string },
  quietBtnText: { fontSize: 13, color: "var(--ink)" as string },
  bulk: { position: "absolute", bottom: 10, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 5, paddingLeft: 14, paddingRight: 7, borderRadius: 14, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" } as object,
  bulkCount: { marginRight: 8, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  bulkBtn: { height: 28, justifyContent: "center", paddingHorizontal: 9, borderRadius: 9 },
  bulkText: { fontSize: 13, color: "var(--ink-3)" as string },
  bulkDanger: { fontSize: 13, color: "var(--danger)" as string },
  lineBox: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 4 },
  lineText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  undo: { fontSize: 12.5, color: "var(--accent)" as string },
  composer: { alignItems: "center", paddingHorizontal: 24, paddingBottom: 16 },
});
