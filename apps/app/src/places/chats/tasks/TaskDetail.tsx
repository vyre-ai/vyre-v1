// One task page, in a tab. The head says what it is, where it came from and whose turn it is, with the one action that is yours. The blocks are filled by its kind and source (Work: brief, done means, outputs and
// subtasks; Answer: the question; Approve: what is held; Review: what to check; Unblock: what it needs). Activity is the chat feed and composer of the task's own thread, with the status changes and hand-offs woven in.
// The rail holds every field. Every change is one capability call; the page reads the task again from the live query.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { QuickField } from "./QuickField.tsx";
import { parseQuick } from "./quick.ts";
import type { QuickPerson } from "./quick.ts";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { deliverableOf, fixesFromText, fixesOf, isBaton, myMove, stepsOf } from "../../../../../../ui/src/TaskPage/baton.ts";
import { StatusDot, stateTitle } from "../../../../../../ui/src/TaskPage/StatusDot.tsx";
import { TASK_STATES } from "../../../../../../ui/src/TaskPage/model.ts";
import type { TaskState, TaskView } from "../../../../../../ui/src/TaskPage/model.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { uploadAttachments, uploadDeps } from "../conversation/actions.ts";
import { DropZone } from "../../../../../../ui/src/FileDrop/index.tsx";
import type { DroppedFile } from "../../../../../../ui/src/FileDrop/index.tsx";
import type { ConversationData } from "../conversation/data.tsx";
import type { Message } from "../conversation/model.ts";
import { Glyph } from "../conversation/parts.tsx";
import { useLive } from "../mounts/live.ts";
import { accessRequestOf, blockView } from "../needsyou/model.ts";
import { TaskBlock } from "../needsyou/NeedsYou.tsx";
import { heldMail } from "../needsyou/heldmail.ts";
import { HeldMailCard } from "../needsyou/HeldMail.tsx";
import { giveWithCare } from "./guest.ts";
import { dueEntries, failure, priorityEntries, withVersion } from "./actions.ts";
import { ConflictCard } from "./Conflict.tsx";
import { clashFrom, keptPatch, leftOut, mergeClash } from "./conflict.ts";
import type { Clash } from "./conflict.ts";
import { dueLabel, holderOf, isOpenState, KIND_TITLE, planOrder, PRIORITIES } from "./model.ts";
import type { IndexOut, TaskFull, TaskRow, Who } from "./model.ts";
import { faceKind, LiveWords, TextMenu, useLiveTurn, webProps } from "./parts.tsx";
import { activityOf } from "./activity.ts";
import { partOf } from "../goals/model.ts";
import type { ActivityShow } from "./activity.ts";
import { offered } from "../../../shell/session/private-agents.ts";
import { canRelease, canTake, handInLabel, movesFor } from "./moves.ts";
import type { Move } from "./moves.ts";
import { useTaskPeople } from "./people.ts";
import type { Seat } from "./people.ts";

type History = CapMap["tasks.history"]["out"];
type TaskOut = CapMap["tasks.get"]["out"];
const newKey = (): string => `task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
const parseList = (v: string | undefined): string[] => { try { const p = JSON.parse(v ?? "[]") as unknown; return Array.isArray(p) ? p.map(String) : []; } catch { return []; } };
const parseTicks = (v: string | undefined): number[] => { try { const p = JSON.parse(v ?? "[]") as unknown; return Array.isArray(p) ? p.filter((x): x is number => typeof x === "number") : []; } catch { return []; } };
/** Notes the page draws as blocks; the rest are the working notes anyone on the task reads and writes. */
const OWN_NOTE = /^(brief|done_means|done_ticks|output_schema|outputs|summary|fixes|asked|answer|baton\..*|thread\.origin|run\.resumed|run\.step|plan\..*|worker\..*|crew\..*|quiet\..*)$/;
const NOTES_KEY = "notes";

export interface TaskDetailProps {
  rt: ShellRuntime;
  taskId: string;
  /** The chat wiring for this task's thread: the same conversation data any chat has. */
  conversationFor(threadId: string): ConversationData;
  openTask(id: string): void;
  openAgent(id: string): void;
  openChat(threadId: string): void;
  /** Off where the page sits in a side pane: the rail folds in under the head. */
  rail?: boolean;
  /** In a side pane: open the task on its own page. */
  openFull?(id: string): void;
  /** On its own page: back to the list it was opened from. */
  back?(): void;
}

/** What the person is typing for a move: the hand-in summary, the fixes, the reason, what blocks them. */
type Mode = "" | "submit" | "fixes" | "reject" | "block";
const MODE_OF: Record<string, Mode> = { summary: "submit", fixes: "fixes", reason: "reject" };

export function TaskDetail({ rt, taskId, conversationFor, openTask, openAgent, openChat, rail = true, openFull, back }: TaskDetailProps): ReactElement {
  const q = useLive<TaskOut>(rt.screens, "tasks.page", "task", { route: { taskId } });
  const history = useLive<History>(rt.screens, "tasks.page", "activity", { route: { taskId } });
  const width = useWindowDimensions().width;
  const who = useTaskPeople(rt);
  const list = who.list;
  const nameOf = who.nameOf;
  const [mode, setMode] = useState<Mode>("");
  const [show, setShow] = useState<ActivityShow>("all");
  const [railOpen, setRailOpen] = useState(rail && width >= 980);
  const [line, setLine] = useState("");
  const [override, setOverride] = useState<TaskFull | null>(null);
  // someone else changed the task while this person was editing: their words wait on a card, field by field, until they save or take the current ones
  const [clash, setClash] = useState<Clash | null>(null);
  const [left, setLeft] = useState("");
  const [saving, setSaving] = useState(false);
  const [kids, setKids] = useState<readonly TaskRow[]>([]);
  const menu = useMenu();
  const task = (q.status === "ready" ? q.data.task : null);
  const shown = override && task && override.updatedAt >= task.updatedAt ? override : task;
  const versionRef = useRef<number | undefined>(undefined);
  versionRef.current = shown?.version;
  useEffect(() => { setOverride(null); setLine(""); setMode(""); setClash(null); setLeft(""); }, [taskId]);
  const readKids = useCallback((): void => {
    void rt.call("tasks.index", { scope: "everyone", parentTaskId: taskId }).then((o) => setKids((o as IndexOut).rows.filter((r) => r.kind === "work").sort(planOrder)), () => setKids([]));
  }, [rt, taskId]);
  // the breakdown is live: a child that moves changes the Space's task revision, and the children are read again
  const rev = useLive<{ rev: string }>(rt.screens, "tasks.my-work", "rev", {});
  const revValue = rev.status === "ready" ? rev.data.rev : "";
  useEffect(() => { readKids(); }, [readKids, task?.updatedAt, revValue]);

  const run = useCallback(async (cap: string, input: Record<string, unknown>): Promise<boolean> => {
    setLine("");
    try {
      const out = await rt.call(cap, { taskId, ...withVersion(cap, input, versionRef.current) }) as { task?: TaskFull };
      if (out.task) setOverride(out.task);
      return true;
    } catch (e) {
      setOverride(null);
      const c = cap === "tasks.update" ? clashFrom(e, input) : null;
      if (c) { if (c.rows.length > 0) { setClash((prev) => mergeClash(prev, c)); setLeft(""); } return false; }
      setLine(failure(e, "That could not be changed.")); return false;
    }
  }, [rt, taskId]);
  const saveClash = useCallback(async (): Promise<void> => {
    if (!clash) return;
    const patch = keptPatch(clash);
    const clock = rt.clock();
    const said = leftOut(clash, clock.now, clock.offsetMin);
    if (Object.keys(patch).length === 0) { setClash(null); setLeft(said); return; }
    setSaving(true);
    const ok = await run("tasks.update", { ...patch, expectedVersion: clash.version });
    setSaving(false);
    if (ok) { setClash(null); setLeft(said); }
  }, [clash, rt, run]);

  // a task with no thread yet (a planned child before it starts) gets one when someone opens it: comments need somewhere to go
  const threadId = shown?.threadId;
  useEffect(() => {
    if (!shown || threadId) return;
    void rt.call("chat.start", { kind: "chat", agentIds: [], scopeType: "task", scopeId: taskId, title: shown.title, idempotencyKey: `task-thread:${taskId}` }).then((o) => {
      const id = (o as { thread?: { threadId?: string } }).thread?.threadId;
      if (id) return rt.call("tasks.update", { taskId, threadId: id });
      return undefined;
    }).catch(() => undefined);
  }, [rt, taskId, threadId, shown]);

  const conv = useMemo(() => (threadId ? conversationFor(threadId) : null), [conversationFor, threadId]);
  const entries = history.status === "ready" ? history.data.entries : NO_ENTRIES;
  const assignedId = shown?.assigned.id;
  const events = useMemo((): readonly Message[] => (threadId ? activityOf(entries, threadId, nameOf, assignedId) : []), [entries, threadId, nameOf, assignedId]);

  if (!shown) {
    const failed = q.status === "loading" ? q.error : undefined;
    return <View testID="task-detail-loading" style={st.root}>{failed ? <States kind="error" message="This task is not available" cause={failed.message} /> : <Text style={st.quiet}>Opening task…</Text>}</View>;
  }
  // a move picked from a status menu that needs words opens the box for them under the head
  const begin = (m: Move): void => { if (m.ask && MODE_OF[m.ask]) { setMode(MODE_OF[m.ask]!); return; } void run(m.cap, m.input); };
  const head = <TaskHead task={shown} rt={rt} nameOf={nameOf} run={run} line={line} menu={menu} kids={kids} openTask={openTask} openAgent={openAgent} openChat={openChat} onKids={readKids} list={list} seats={who.seats} railOpen={railOpen} onRail={rail ? () => setRailOpen((o) => !o) : undefined} show={show} onShow={setShow} mode={mode} setMode={setMode} begin={begin} clash={clash} left={left} saving={saving} setClash={setClash} saveClash={saveClash} {...(openFull ? { openFull } : {})} {...(back ? { back } : {})} />;
  const feed = conv
    ? <Conversation key={threadId} compact data={{ ...conv, head, activity: { events, show }, placeholder: "Comment, or @ someone" }} />
    : <ScrollView contentContainerStyle={st.col}>{head}</ScrollView>;
  return <View testID="task-detail" style={st.row}>
    <View style={st.main}>{feed}</View>
    {railOpen ? <SidePane paneKey="task-details" toggle={{ open: true, onPress: () => setRailOpen(false) }} title="Details" tabs={[{ key: "details", title: "Details" }]} activeTab="details" defaultWidth={340} onCloseTab={() => setRailOpen(false)}>
      <Rail task={shown} rt={rt} nameOf={nameOf} run={run} menu={menu} seats={who.seats} openTask={openTask} kidsCount={kids.length} begin={begin} />
    </SidePane> : null}
    {menu.element}
  </View>;
}
const NO_ENTRIES: History["entries"] = [];

type Menu = ReturnType<typeof useMenu>;
const pointAt = (e: unknown): { x: number; y: number } => { const t = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.(); return { x: t?.left ?? 8, y: (t?.bottom ?? 48) + 4 }; };

/** The status menu: only the moves this person's seat allows, in the words of the move. Take and Give back for a team task. */
function statusEntries(task: TaskFull, me: string, run: (cap: string, input: Record<string, unknown>) => Promise<boolean>, begin: (m: Move) => void): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (canTake(task)) items.push({ label: "Take it", onSelect: () => void run("tasks.take", {}) });
  for (const m of movesFor(task, me)) items.push({ label: m.label, ...(m.to ? { leading: <StatusDot state={m.to} size={14} /> } : {}), ...(m.danger ? { danger: true } : {}), onSelect: () => begin(m) });
  if (canRelease(task, me)) items.push({ separator: true }, { label: "Give it back", onSelect: () => void run("tasks.release", {}) });
  if (items.length === 0) items.push({ head: `${stateTitle(task.state as TaskState)}. Nothing here is yours to move.` });
  return items;
}

interface HeadProps {
  task: TaskFull; rt: ShellRuntime; nameOf(id: string): string; run(cap: string, input: Record<string, unknown>): Promise<boolean>; line: string; menu: Menu; kids: readonly TaskRow[]; list: ReadonlyArray<{ id: string; name: string; kind: string }>; seats: readonly Seat[];
  openTask(id: string): void; openAgent(id: string): void; openChat(id: string): void; onKids(): void; railOpen: boolean; onRail: (() => void) | undefined; show: ActivityShow; onShow(s: ActivityShow): void;
  mode: Mode; setMode(m: Mode): void; begin(m: Move): void; openFull?(id: string): void; back?(): void;
  clash: Clash | null; left: string; saving: boolean; setClash(c: Clash): void; saveClash(): Promise<void>;
}

/** The head and every block, above the feed, scrolling with it. */
function TaskHead({ task, rt, nameOf, run, line, menu, kids, list, seats, openTask, openAgent, openChat, onKids, railOpen, onRail, show, onShow, mode, setMode, begin, openFull, back, clash, left, saving, setClash, saveClash }: HeadProps): ReactElement {
  const [title, setTitle] = useState(task.title);
  const [titleH, setTitleH] = useState(34);
  useEffect(() => setTitle(task.title), [task.title]);
  // a refused title is kept on the conflict card; the field shows what the task holds, so it never looks saved when it was not
  useEffect(() => { if (clash) setTitle(task.title); }, [clash]);   // eslint-disable-line react-hooks/exhaustive-deps
  const view = task as unknown as TaskView;
  const turn = useLiveTurn(rt.turns, task.workerThread ?? task.threadId);
  const parent = useLive<TaskOut>(rt.screens, "tasks.page", "task", task.parentTaskId ? { route: { taskId: task.parentTaskId } } : null);
  const parentTitle = parent.status === "ready" ? parent.data.task.title : undefined;
  // a task of a goal says so, and opens the goal; the goal's own parent task opens the goal too
  const notes = task.workingNotes as Record<string, string>;
  const goal = partOf(notes) ?? (notes["goal.root"] === "1" && notes["goal.id"] ? { goalId: notes["goal.id"], title: notes["goal.title"] ?? task.title } : null);
  const onDigit = useRef((_: string): void => undefined);
  // 1 to 6 pick a state, and only a move this person can make reaches it
  onDigit.current = (k): void => { const s = TASK_STATES[Number(k) - 1]; const m = s ? movesFor(task, rt.me.id).find((x) => x.to === s.key) : undefined; if (m) begin(m); };
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const g = globalThis as unknown as { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void };
    const f = (e: KeyboardEvent): void => { const t = e.target as { tagName?: string; isContentEditable?: boolean } | null; if (!e.metaKey && !e.ctrlKey && !e.altKey && !t?.isContentEditable && !/INPUT|TEXTAREA/.test(t?.tagName ?? "") && /^[1-6]$/.test(e.key)) onDigit.current(e.key); };
    g.addEventListener("keydown", f);
    return () => g.removeEventListener("keydown", f);
  }, []);
  // the title is saved against the version it was started on, so a change someone else made meanwhile is told, not overwritten
  const titleBase = useRef<number | undefined>(undefined);
  const saveTitle = (): void => { const t = title.trim(); const base = titleBase.current; titleBase.current = undefined; if (t === "" || t === task.title) { setTitle(task.title); return; } void run("tasks.update", { title: t, ...(base !== undefined ? { expectedVersion: base } : {}) }); };
  const steps = isBaton(view) || task.reviewer || task.approver ? stepsOf(view) : [];
  const labels: ReactElement[] = [];
  for (const l of (task.labels ?? []).slice(0, 4)) labels.push(<Text key={l} style={st.label}>{`#${l}`}</Text>);
  return <View testID="task-head" style={st.col}>
    <View style={st.crumbs}>
      {back ? <Pressable accessibilityRole="link" accessibilityLabel="Back to Tasks" testID="task-back" onPress={back} style={({ hovered }: { hovered?: boolean }) => [st.chip, hovered === true && { backgroundColor: "var(--hover)" as string }]}><Text style={st.chipText}>Tasks</Text></Pressable> : null}
      {task.key ? <Text style={st.key}>{task.key}</Text> : null}
      {goal ? <Chip label={`Part of ${goal.title}`} onPress={() => rt.open({ subject: { type: "goal", id: goal.goalId } })} /> : task.parentTaskId ? <Chip label={parentTitle ?? "Parent task"} onPress={() => openTask(task.parentTaskId!)} /> : <SourceChip task={task} rt={rt} openChat={openChat} />}
      {task.parentTaskId ? <SourceChip task={task} rt={rt} openChat={openChat} /> : null}
      {labels}
      <View style={{ flex: 1 }} />
      {openFull ? <Pressable accessibilityRole="button" accessibilityLabel="Open the full page" testID="task-open-full" onPress={() => openFull(task.id)} style={st.iconBtn}><Glyph name="link" size={14} /></Pressable> : null}
      {onRail && !railOpen ? <Pressable accessibilityRole="button" accessibilityLabel="Show details" testID="task-rail-toggle" onPress={onRail} style={st.iconBtn}><Glyph name="pane" size={14} /></Pressable> : null}
    </View>
    <View style={st.titleRow}>
      <View style={{ marginTop: 7 }}><StatusDot state={task.state} size={24} live={turn !== undefined} onPress={(at) => menu.show(statusEntries(task, rt.me.id, run, begin), at.x, at.y, "other", { label: "Status" })} testID="task-status" /></View>
      {/* the title wraps to as many lines as it needs (a phone, the side pane); Enter saves it, it never holds a line break */}
      <TextInput accessibilityLabel="Task title" testID="task-title" value={title} onFocus={() => { titleBase.current = task.version; }} onChangeText={(v) => setTitle(v.replace(/\n/g, ""))} onBlur={saveTitle} onSubmitEditing={saveTitle} multiline blurOnSubmit scrollEnabled={false} onContentSizeChange={(e) => setTitleH(Math.max(34, Math.ceil(e.nativeEvent.contentSize.height)))} style={[st.h1, { height: titleH }]} />
    </View>
    {steps.length > 2 ? <BatonPath steps={steps} nameOf={nameOf} /> : null}
    {turn ? <View style={st.liveLine}><LiveWords turn={turn} turns={rt.turns} name={nameOf(turn.agentId)} /></View> : null}
    <YourAction task={task} view={view} me={rt.me.id} run={run} menu={menu} list={list} mode={mode} setMode={setMode} nameOf={nameOf} />
    {line ? <Text accessibilityRole="alert" testID="task-line" style={st.error}>{line}</Text> : null}
    {clash ? <ConflictCard clash={clash} by={clash.by ? nameOf(clash.by) : "Someone"} now={rt.clock().now} offsetMin={rt.clock().offsetMin} busy={saving} onChange={setClash} onSave={() => void saveClash()} /> : left ? <Text testID="task-conflict-left" style={st.waiting}>{left}</Text> : null}
    <TaskBody task={task} rt={rt} nameOf={nameOf} run={run} kids={kids} people={list.filter(offered)} openTask={openTask} openAgent={openAgent} onKids={onKids} />
    <View style={st.feedHead}>
      <Text style={st.blockTitle}>Activity</Text>
      <TextMenu label={show === "all" ? "Everything" : show === "comments" ? "Comments" : "Updates"} testID="task-activity-filter" onPress={(at) => menu.show([
        { label: "Everything", checked: show === "all", onSelect: () => onShow("all") }, { label: "Comments", checked: show === "comments", onSelect: () => onShow("comments") }, { label: "Updates", checked: show === "updates", onSelect: () => onShow("updates") },
      ], at.x, at.y, "other", { label: "Activity" })} />
    </View>
  </View>;
}

function Chip({ label, onPress, icon }: { label: string; onPress(): void; icon?: "task" | "chat" | "flow" | "lock" }): ReactElement {
  return <Pressable accessibilityRole="link" accessibilityLabel={label} testID="task-chip" onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [st.chip, hovered === true && { backgroundColor: "var(--hover)" as string }]}>
    {icon === "chat" ? <Glyph name="reply" size={12} /> : icon === "flow" ? <Glyph name="fork" size={12} /> : icon === "lock" ? <Glyph name="lock" size={12} /> : null}
    <Text numberOfLines={1} style={st.chipText}>{label}</Text>
  </Pressable>;
}

/** Where the task came from, and the way back to it: the chat, the Run and its step, the held act, the meeting. */
function SourceChip({ task, rt, openChat }: { task: TaskFull; rt: ShellRuntime; openChat(id: string): void }): ReactElement | null {
  const s = task.source;
  const [name, setName] = useState("");
  useEffect(() => {
    if (!s) return;
    if (s.kind === "run") void rt.call("runs.get", { runId: s.id }).then((o) => {
      const run = (o as { run?: { name?: string; automation?: string; steps?: Array<{ id?: string; stepId?: string }> } }).run;
      const step = task.workingNotes["run.step"];
      const at = step && run?.steps ? run.steps.findIndex((x) => (x.stepId ?? x.id) === step) : -1;
      setName(`${run?.name ?? run?.automation ?? "An automation"}${at >= 0 ? ` · step ${at + 1}` : ""}`);
    }, () => setName("An automation"));
    if (s.kind === "chat") void rt.call("threads.get", { threadId: s.id }).then((o) => setName((o as { thread?: { title?: string } }).thread?.title ?? "A chat"), () => setName("A chat"));
    // a goal's plan and a meeting's follow-ups name where they come from (lanes l-goals and l-meetings add the sources)
    if (s.kind === "goal") void rt.call("goals.get", { goalId: s.id }).then((o) => setName((o as { goal?: { title?: string } }).goal?.title ?? ""), () => setName(""));
    if (s.kind === "meeting") void rt.call("meetings.closeout.get", { meetingId: s.id }).then((o) => setName((o as { title?: string }).title ?? ""), () => setName(""));
  }, [rt, s?.kind, s?.id, task.workingNotes["run.step"]]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || s.kind === "manual") return null;
  if (s.kind === "run") return <Chip label={name || "An automation"} icon="flow" onPress={() => rt.open({ subject: { type: "run", id: s.id } })} />;
  if (s.kind === "chat") return <Chip label={name || "A chat"} icon="chat" onPress={() => openChat(s.id)} />;
  if (s.kind === "gate") return <Chip label="Held before sending" icon="lock" onPress={() => rt.open({ subject: { type: "task", id: task.id } })} />;
  if (s.kind === "goal") return <Chip label={name ? `Part of ${name}` : "Part of a goal"} icon="flow" onPress={() => rt.open({ subject: { type: "goal", id: s.id } })} />;
  // a task from a meeting close-out says which meeting, and opens its close-out in the Inbox's Meetings tab
  if (s.kind === "meeting") return <Chip label={name ? `From ${name}` : "From a meeting"} icon="task" onPress={() => rt.open({ subject: { type: "meeting", id: s.id } })} />;
  return <Chip label="From a journey" icon="flow" onPress={() => rt.open({ subject: { type: "journey", id: s.id } })} />;
}

/** Whose hands it passes through: faces and names, the holder lit. */
function BatonPath({ steps, nameOf }: { steps: ReturnType<typeof stepsOf>; nameOf(id: string): string }): ReactElement {
  const out: ReactElement[] = [];
  for (const [i, s] of steps.entries()) {
    if (i > 0) out.push(<View key={`j${i}`} style={st.pathLine} />);
    const title = s.key === "assigned" ? "Assigned" : s.key === "review" ? "Reviewer" : s.key === "approve" ? "Approver" : "Done";
    out.push(<View key={s.key} testID={`baton-step-${s.key}`} {...webProps({ title: s.who ? `${title}: ${nameOf(s.who.id)}` : title })} style={[st.path, s.lit === "now" ? null : s.lit === "past" ? { opacity: 0.8 } : { opacity: 0.5 }]}>
      {s.who ? <Avatar name={nameOf(s.who.id)} seedId={s.who.id} kind={faceKind(s.who)} size={24} /> : <View style={st.pathDone}><Glyph name="check" size={12} /></View>}
      <View><Text style={st.pathTitle}>{title}</Text>{s.who ? <Text style={st.pathName}>{nameOf(s.who.id)}</Text> : null}</View>
    </View>);
  }
  return <View testID="baton-path" style={st.pathRow}>{out}</View>;
}

/** The one action that is yours: what your seat does next. Take for a team task nobody took. Nothing when it is not your move. */
function YourAction({ task, view, me, run, menu, list, mode, setMode, nameOf }: { task: TaskFull; view: TaskView; me: string; run(cap: string, input: Record<string, unknown>): Promise<boolean>; menu: Menu; list: ReadonlyArray<{ id: string; name: string; kind: string }>; mode: Mode; setMode(m: Mode): void; nameOf(id: string): string }): ReactElement | null {
  const [text, setText] = useState("");
  const close = (ok: boolean): void => { if (ok) { setMode(""); setText(""); } };
  useEffect(() => { setMode(""); setText(""); }, [task.state]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (task.kind !== "work") return null;
  if (canTake(task)) return <View style={st.actions}><Btn label="Take it" primary testID="task-take" onPress={() => void run("tasks.take", {})} /><Text style={[st.waiting, st.besideBtn]}>{`For ${nameOf(task.assigned.id)}. Whoever takes it does it.`}</Text></View>;
  const taken = task.takenBy !== undefined && (task.assigned.kind === "group" || task.assigned.kind === "role") && task.takenBy !== me && isOpenState(task.state as TaskState) ? <Text style={st.waiting}>{`Taken by ${nameOf(task.takenBy)}`}</Text> : null;
  const move = myMove({ ...view, takenBy: task.takenBy ?? (task.yourTurn ? me : undefined) } as TaskView, me);
  if (task.blocked && move === null) return <Text style={st.waiting}>{"This waits on something else and starts by itself."}</Text>;
  if (!move) return taken;
  const prompt = (placeholder: string, label: string, press: () => void, multi = false): ReactElement => <View style={st.actionForm}>
    <TextInput autoFocus accessibilityLabel={placeholder} testID="task-action-text" placeholder={placeholder} placeholderTextColor="var(--ink-3)" value={text} onChangeText={setText} multiline={multi} style={[st.input, multi && { minHeight: 64 }]} />
    <View style={st.actions}><Btn label={label} primary onPress={press} /><Btn label="Cancel" onPress={() => { setMode(""); setText(""); }} /></View>
  </View>;
  if (mode === "submit") return prompt("What you did, in one line", task.reviewer || task.approver ? "Hand in" : "Mark done", () => { if (text.trim()) void run("tasks.submit", { summary: text.trim() }).then(close); });
  if (mode === "block") return prompt("What is in the way", "Report it", () => { if (text.trim()) void run("tasks.block", { reason: text.trim() }).then(close); });
  if (mode === "fixes") return prompt("One fix per line", "Send back", () => { const fixes = fixesFromText(text); if (fixes.length) void run("tasks.review", { verdict: "send_back", fixes }).then(close); }, true);
  if (mode === "reject") return prompt("Why not", "Send back", () => { if (text.trim()) void run("tasks.decide", { verdict: "reject", reason: text.trim() }).then(close); }, true);
  const giveBack = canRelease(task, me) ? <Btn label="Give it back" testID="task-release" onPress={() => void run("tasks.release", {})} /> : null;
  if (move === "review") return <View style={st.actions}><Btn label="Approve" primary testID="task-approve" onPress={() => void run("tasks.review", { verdict: "approve" })} /><Btn label="Send back" testID="task-send-back" onPress={() => setMode("fixes")} /></View>;
  if (move === "approve") return <View style={st.actions}><Btn label="Approve" primary testID="task-approve" onPress={() => void run("tasks.decide", { verdict: "approve" })} /><Btn label="Send back" testID="task-reject" onPress={() => setMode("reject")} /></View>;
  // from To do or Doing the same moves: start (from To do), hand in, say what blocks it; from To do it can also go to an agent
  const handIn = <Btn label={handInLabel(task)} primary={task.state !== "todo"} testID="task-submit" onPress={() => setMode("submit")} />;
  const blocked = <Btn label="Blocked" testID="task-blocked" onPress={() => setMode("block")} />;
  if (task.state === "todo") return <View style={st.actions}>
    <Btn label="Start" primary testID="task-start" onPress={() => void run("tasks.transition", { to: "doing", expectedFrom: "todo" })} />
    {handIn}{blocked}
    <Btn label="Give to an agent" testID="task-give" onPress={(e) => { const at = pointAt(e); menu.show(list.filter((p) => p.kind === "agent" && offered(p)).map((p) => ({ label: p.name, leading: <Avatar name={p.name} seedId={p.id} kind="agent" size={16} />, onSelect: () => void run("tasks.assign", { slot: "assigned", to: { kind: "agent", id: p.id } }) })), at.x, at.y, "other", { label: "Give to an agent" }); }} />
    {giveBack}
  </View>;
  return <View style={st.actions}>{handIn}{blocked}{giveBack}</View>;
}

function Btn({ label, onPress, primary = false, testID }: { label: string; onPress(e: unknown): void; primary?: boolean; testID?: string }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [st.btn, primary && st.btnPrimary, hovered === true && !primary && { backgroundColor: "var(--hover)" as string }]}><Text style={[st.btnText, primary && { color: "var(--accent-ink)" as string }]}>{label}</Text></Pressable>;
}

function Block({ title, right, children }: { title?: string; right?: string; children: ReactNode }): ReactElement {
  return <View style={st.block}>{title ? <View style={st.blockHead}><Text style={st.blockTitle}>{title}</Text>{right ? <Text style={st.blockRight}>{right}</Text> : null}</View> : null}{children}</View>;
}

/** Blocks by kind and source. */
function TaskBody({ task, rt, nameOf, run, kids, people, openTask, openAgent, onKids }: { task: TaskFull; rt: ShellRuntime; nameOf(id: string): string; run(cap: string, input: Record<string, unknown>): Promise<boolean>; kids: readonly TaskRow[]; people: readonly QuickPerson[]; openTask(id: string): void; openAgent(id: string): void; onKids(): void }): ReactElement {
  const brief = task.workingNotes["brief"] ?? task.why ?? task.summary;
  const body = task.kind === "work" ? <Brief text={brief} run={run} rt={rt} taskId={task.id} /> : brief ? <Block><Text style={st.body}>{tidyBrief(brief)}</Text></Block> : null;
  const blocks: ReactElement[] = [];
  const held = heldMail(task as never);
  if (held) blocks.push(<HeldMailCard key="mail" mail={held} call={rt.call} onOpenRecord={(id) => rt.open({ subject: { type: "record", id } })} />);
  else for (const [i, b] of task.blocks.entries()) if (b.type !== "question" && b.type !== "access_request") blocks.push(<TaskBlock key={`${b.type}-${i}`} view={blockView(b)} />);
  if (task.kind === "answer") return <><AnswerBlock task={task} run={run} nameOf={nameOf} />{blocks.length ? <Block>{blocks}</Block> : null}</>;
  if (task.kind === "approve") return <>{body}<Block title="Held until you approve">{blocks}<ActionButtons task={task} run={run} /></Block></>;
  const access = accessRequestOf(task);
  if (task.kind === "unblock") return <>{body}{blocks.length ? <Block>{blocks}</Block> : null}<Block>{access && isOpenState(task.state as TaskState) ? <Btn label="Approve" primary testID="task-access-approve" onPress={() => void run("access.requests.approve", { requestId: access.requestId, ...(access.level ? { level: access.level } : {}) })} /> : null}<ActionButtons task={task} run={run} /></Block></>;
  if (task.kind === "review") return <>{body}<DoneMeans task={task} run={run} />{blocks.length ? <Block title="Outputs">{blocks}</Block> : null}<Outputs task={task} rt={rt} /><Block><ActionButtons task={task} run={run} /></Block></>;
  return <>{body}<Fixes task={task} /><Tree task={task} rt={rt} nameOf={nameOf} kids={kids} people={people} openTask={openTask} openAgent={openAgent} onKids={onKids} /><DoneMeans task={task} run={run} /><Outputs task={task} rt={rt} />{blocks.length ? <Block>{blocks}</Block> : null}</>;
}

const tidyBrief = (text: string): string => text.replace(/^## .+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

/**
 * What the work is, in words anyone on it can change. Files dropped on it, or pasted while it is being written, are stored the way a chat stores its uploads and linked to
 * the task, where they list under Outputs.
 */
function Brief({ text, run, rt, taskId }: { text: string | undefined; run(cap: string, input: Record<string, unknown>): Promise<boolean>; rt: ShellRuntime; taskId: string }): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const attach = (files: readonly DroppedFile[]): void => {
    setNote(files.length === 1 ? `Attaching ${files[0]!.name}` : `Attaching ${files.length} files`);
    void uploadAttachments(uploadDeps(rt), files.map((f) => ({ name: f.name, file: f, ...(f.type ? { mime: f.type } : {}) })), `task-files:${taskId}:${Date.now().toString(36)}`).then(async (ids) => {
      for (const fileId of ids) if (!(await run("tasks.links.add", { fileId }))) { setNote(""); return; }
      setNote(ids.length === 1 ? "Attached. It is under Outputs" : `Attached ${ids.length} files. They are under Outputs`);
    }, (e: unknown) => setNote(e instanceof Error && e.message !== "" ? e.message : "Could not attach that. Try again"));
  };
  const line = note ? <Text style={st.briefAdd} testID="task-brief-files" accessibilityLiveRegion="polite">{note}</Text> : null;
  if (draft !== null) {
    const save = (): void => { const v = draft.trim(); setDraft(null); if (v !== (text ?? "").trim()) void run("tasks.working_notes.set", { key: "brief", value: v }); };
    return <DropZone testID="task-brief-drop" onFiles={attach} radius={8}><Block><TextInput autoFocus multiline accessibilityLabel="What this is" testID="task-brief-edit" placeholder="What this is" placeholderTextColor="var(--ink-3)" value={draft} onChangeText={setDraft} onBlur={save} style={[st.body, st.briefEdit]} />{line}</Block></DropZone>;
  }
  return <DropZone testID="task-brief-drop" onFiles={attach} radius={8}><Block><Pressable accessibilityRole="button" accessibilityLabel={text ? "Change what this is" : "Add what this is"} testID="task-brief" onPress={() => setDraft(text ?? "")}>
    {text ? <Text style={st.body}>{tidyBrief(text)}</Text> : <Text style={st.briefAdd}>Add what this is</Text>}
  </Pressable>{line}</Block></DropZone>;
}

/** The buttons a request carries, from the task itself. */
function ActionButtons({ task, run }: { task: TaskFull; run(cap: string, input: Record<string, unknown>): Promise<boolean> }): ReactElement | null {
  const [need, setNeed] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!isOpenState(task.state as TaskState)) return <Text style={st.doneLine}>{`${stateTitle(task.state as TaskState)}${task.workingNotes["answer"] ? `: ${task.workingNotes["answer"]}` : ""}`}</Text>;
  const press = (key: string, required: boolean): void => { if (required && !note.trim()) { setNeed(key); return; } void run("tasks.act", { action: key, ...(note.trim() ? { note: note.trim() } : {}) }); };
  const buttons: ReactElement[] = [];
  for (const [i, a] of task.actions.entries()) buttons.push(<Btn key={a.key} label={a.label} primary={i === 0} testID={`task-act-${a.key}`} onPress={() => press(a.key, a.note === "required")} />);
  return <View style={st.actionForm}>
    {need ? <TextInput autoFocus accessibilityLabel="Add a note" placeholder="Add a note" placeholderTextColor="var(--ink-3)" value={note} onChangeText={setNote} multiline style={[st.input, { minHeight: 56 }]} /> : null}
    <View style={st.actions}>{buttons}</View>
  </View>;
}

function AnswerBlock({ task, run, nameOf }: { task: TaskFull; run(cap: string, input: Record<string, unknown>): Promise<boolean>; nameOf(id: string): string }): ReactElement {
  const [own, setOwn] = useState("");
  const q = task.blocks.find((b) => b.type === "question")?.data as { question?: string; options?: Array<{ label?: string; hint?: string } | string> } | undefined;
  const options = (q?.options ?? []).map((o) => (typeof o === "string" ? { label: o } : o));
  const answered = task.workingNotes["answer"];
  const send = (answer: string): void => { void run("tasks.act", { action: "answer", answer }); };
  if (!isOpenState(task.state as TaskState)) return <Block title={`${nameOf(task.createdBy)} asks`}><Text style={st.doneLine}>{answered ? `Answered: ${answered}` : stateTitle(task.state as TaskState)}</Text></Block>;
  const rows: ReactElement[] = [];
  for (const o of options) rows.push(<Pressable key={o.label} accessibilityRole="radio" accessibilityLabel={o.label ?? ""} testID={`task-option-${o.label}`} onPress={() => send(o.label ?? "")} style={({ hovered }: { hovered?: boolean }) => [st.option, hovered === true && { backgroundColor: "var(--hover)" as string }]}>
    <View style={st.radio} /><Text style={st.optionText}>{o.label}</Text>{o.hint ? <Text style={st.optionHint}>{o.hint}</Text> : null}
  </Pressable>);
  return <Block title={`${nameOf(task.createdBy)} asks`}>
    {q?.question && q.question !== task.title ? <Text style={st.body}>{q.question}</Text> : null}
    {rows}
    <View style={st.option}><View style={st.radio} /><TextInput accessibilityLabel="Your own answer" testID="task-own-answer" placeholder="Your own answer" placeholderTextColor="var(--ink-3)" value={own} onChangeText={setOwn} onSubmitEditing={() => { if (own.trim()) send(own.trim()); }} style={st.inline} /></View>
  </Block>;
}

function DoneMeans({ task, run }: { task: TaskFull; run(cap: string, input: Record<string, unknown>): Promise<boolean> }): ReactElement | null {
  const items = parseList(task.workingNotes["done_means"]);
  const [more, setMore] = useState("");
  const add = (): void => { const v = more.trim(); if (v === "") return; setMore(""); void run("tasks.working_notes.set", { key: "done_means", value: JSON.stringify([...items, v]) }); };
  if (task.kind !== "work" && items.length === 0) return null;
  const ticks = new Set(parseTicks(task.workingNotes["done_ticks"]));
  const toggle = (i: number): void => { const n = new Set(ticks); if (n.has(i)) n.delete(i); else n.add(i); void run("tasks.working_notes.set", { key: "done_ticks", value: JSON.stringify([...n]) }); };
  const rows: ReactElement[] = [];
  for (const [i, m] of items.entries()) rows.push(<Pressable key={m} accessibilityRole="checkbox" accessibilityLabel={m} accessibilityState={{ checked: ticks.has(i) }} testID={`task-means-${i}`} onPress={() => toggle(i)} style={st.check}>
    <View style={[st.tick, ticks.has(i) && st.tickOn]}>{ticks.has(i) ? <Glyph name="check" size={9} color="var(--accent-ink)" /> : null}</View><Text style={st.checkText}>{m}</Text>
  </Pressable>);
  return <Block {...(items.length ? { title: "Done means" } : {})}>{rows}<View style={st.addKid}><View style={st.addDot} /><TextInput accessibilityLabel="Add what done means" testID="task-add-means" placeholder="Add what done means" placeholderTextColor="var(--ink-3)" value={more} onChangeText={setMore} onSubmitEditing={add} style={st.inline} /></View></Block>;
}

/** The names of a task's files, read once each (files.get). A file that cannot be read keeps a plain word. */
function useFileNames(rt: ShellRuntime, ids: readonly string[]): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    const want = key === "" ? [] : key.split(",").slice(0, 30);
    void Promise.all(want.map((id) => rt.call("files.get", { fileId: id }).then((o) => [id, (o as { file?: { name?: string } }).file?.name ?? ""] as const, () => [id, ""] as const))).then((rows) => { if (live) setNames(new Map(rows.filter(([, n]) => n !== ""))); });
    return () => { live = false; };
  }, [rt, key]);
  return names;
}

function Outputs({ task, rt }: { task: TaskFull; rt: ShellRuntime }): ReactElement | null {
  const d = deliverableOf(task as unknown as TaskView);
  const names = useFileNames(rt, task.fileIds);
  const fileRows: ReactElement[] = [];
  for (const id of task.fileIds) { const name = names.get(id) ?? "A file"; fileRows.push(<Pressable key={id} accessibilityRole="link" accessibilityLabel={`Open ${name}`} onPress={() => rt.open({ subject: { type: "file", id } })} style={st.output}><Glyph name="file" size={14} /><Text numberOfLines={1} style={st.outputText}>{name}</Text></Pressable>); }
  if (!d && fileRows.length === 0) return null;
  const fields: ReactElement[] = [];
  for (const f of d?.fields ?? []) fields.push(<View key={f.name} style={st.field}><Text style={st.fieldName}>{f.name}</Text><Text selectable style={st.body}>{f.value}</Text></View>);
  return <Block title="Outputs">{d?.summary ? <Text style={st.body}>{d.summary}</Text> : null}{fields}<View style={st.outputs}>{fileRows}</View></Block>;
}

function Fixes({ task }: { task: TaskFull }): ReactElement | null {
  const fixes = fixesOf(task as unknown as TaskView);
  if (fixes.length === 0 || (task.state !== "todo" && task.state !== "doing")) return null;
  const rows: ReactElement[] = [];
  for (const [i, f] of fixes.entries()) rows.push(<Text key={`${i}-${f}`} style={st.body}>{`${i + 1}. ${f}`}</Text>);
  return <Block title="Fixes asked for">{rows}</Block>;
}

/** Work breakdown: the children of this task with their rollup, each with its own status; add one here. */
function Tree({ task, rt, nameOf, kids, people, openTask, openAgent, onKids }: { task: TaskFull; rt: ShellRuntime; nameOf(id: string): string; kids: readonly TaskRow[]; people: readonly QuickPerson[]; openTask(id: string): void; openAgent(id: string): void; onKids(): void }): ReactElement {
  const [text, setText] = useState("");
  // a subtask reads like quick add: @someone assigns it, a day sets it due, #word labels it; with nobody named it goes to whoever has the parent
  const add = (): void => {
    const typed = text.trim();
    if (typed === "") return;
    const q = parseQuick(typed, people, rt.clock().now, rt.clock().offsetMin);
    if (q.title === "") return;
    setText("");
    const assigned: Who = q.assignee ? { kind: q.assignee.kind as Who["kind"], id: q.assignee.id } : task.assigned;
    void rt.call("tasks.create", { title: q.title, assigned, parentTaskId: task.id, labels: q.labels, ...(q.due !== undefined ? { due: q.due } : {}), ...(q.priority ? { priority: q.priority } : {}), ...(task.recordId ? { recordId: task.recordId } : {}), idempotencyKey: newKey() }).then(onKids, () => setText(typed));
  };
  const done = kids.filter((k) => k.state === "done" || k.state === "canceled").length;
  const rev = kids.filter((k) => k.state === "in_review").length;
  const rows: ReactElement[] = [];
  for (const k of kids) rows.push(<TreeRow key={k.id} row={k} rt={rt} nameOf={nameOf} kids={kids} openTask={openTask} openAgent={openAgent} onKids={onKids} />);
  return <Block title={kids.length > 1 ? "Work breakdown" : "Subtasks"} {...(kids.length ? { right: `${done} of ${kids.length} done` } : {})}>
    {kids.length > 1 ? <View style={st.roll}><View style={[st.rollFill, { width: `${((done + rev * 0.6) / kids.length) * 100}%` }]} /></View> : null}
    {rows}
    <View style={st.addKid}><View style={st.addDot} /><QuickField label="Add a subtask" testID="task-add-child" placeholder={kids.length > 1 ? "Add a task to this" : "Add a subtask"} value={text} onChangeText={setText} onSubmit={add} people={people} style={st.inline} /></View>
  </Block>;
}

function TreeRow({ row, rt, nameOf, kids, openTask, openAgent, onKids }: { row: TaskRow; rt: ShellRuntime; nameOf(id: string): string; kids: readonly TaskRow[]; openTask(id: string): void; openAgent(id: string): void; onKids(): void }): ReactElement {
  const turn = useLiveTurn(rt.turns, row.workerThread ?? row.threadId);
  const menu = useMenu();
  const h = holderOf(row);
  const waits = row.blocked ? row.dependsOn.map((d) => kids.find((k) => k.id === d)?.key).filter(Boolean) : [];
  // the moves that are yours on this child; one that needs words opens it
  const status = (at: { x: number; y: number }): void => {
    const items: MenuEntry[] = movesFor(row, rt.me.id).map((m) => ({ label: m.label, ...(m.to ? { leading: <StatusDot state={m.to} size={14} /> } : {}), onSelect: () => { if (m.ask) openTask(row.id); else void rt.call(m.cap, { taskId: row.id, ...m.input }).then(onKids, () => undefined); } }));
    menu.show(items.length > 0 ? items : [{ head: "Nothing here is yours to move." }], at.x, at.y, "other", { label: "Status" });
  };
  return <View style={st.tree}>
    <StatusDot state={row.state} size={17} live={turn !== undefined} onPress={status} />
    <Pressable accessibilityRole="link" accessibilityLabel={row.title} testID={`tree-${row.id}`} onPress={() => openTask(row.id)} style={st.treeMain}>
      {row.key ? <Text style={st.key}>{row.key}</Text> : null}
      <Text numberOfLines={1} style={[st.treeTitle, row.state === "done" && st.struck]}>{row.title}</Text>
      {turn ? <View style={{ flex: 1, marginLeft: 12 }}><LiveWords turn={turn} turns={rt.turns} name={nameOf(turn.agentId)} /></View> : <Text numberOfLines={1} style={st.treeSub}>{waits.length ? `Waits on ${waits.join(", ")}` : row.state === "in_review" && h ? `With ${nameOf(h.id)} for review` : ""}</Text>}
    </Pressable>
    {h ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${nameOf(h.id)}`} onPress={() => { if (h.kind === "agent") openAgent(h.id); else rt.open({ subject: { type: "contact", id: h.id } }); }}><Avatar name={nameOf(h.id)} seedId={h.id} kind={faceKind(h)} size={22} /></Pressable> : null}
    {menu.element}
  </View>;
}

/** Every field of a task, in a column. */
function Rail({ task, rt, nameOf, run, menu, seats, openTask, kidsCount, begin }: { task: TaskFull; rt: ShellRuntime; nameOf(id: string): string; run(cap: string, input: Record<string, unknown>): Promise<boolean>; menu: Menu; seats: readonly Seat[]; openTask(id: string): void; kidsCount: number; begin(m: Move): void }): ReactElement {
  const clock = rt.clock();
  const act = { now: () => rt.clock().now, offsetMin: clock.offsetMin };
  const person = (slot: "assigned" | "reviewer" | "approver", w: Who | undefined): ReactElement => w ? <View style={st.kvFace}><Avatar name={nameOf(w.id)} seedId={w.id} kind={faceKind(w)} size={18} /><Text numberOfLines={1} style={st.kvVal}>{nameOf(w.id)}</Text></View> : <Text style={st.kvAdd}>Add</Text>;
  const slotMenu = (slot: "assigned" | "reviewer" | "approver", e: unknown): void => {
    const at = pointAt(e);
    // people, agents, then teams and roles; someone else's private agent is never offered
    const items: MenuEntry[] = [];
    let teams = false;
    for (const p of seats) {
      if ((p.kind === "group" || p.kind === "role") && !teams) { items.push({ head: "Teams and roles" }); teams = true; }
      items.push({ label: p.name, leading: <Avatar name={p.name} seedId={p.id} kind={faceKind({ kind: p.kind, id: p.id })} size={16} />, checked: task[slot]?.id === p.id, onSelect: () => giveWithCare(menu.show, p, at, () => void run("tasks.assign", { slot, to: { kind: p.kind, id: p.id } })) });
    }
    if (slot !== "assigned" && task[slot]) items.push({ separator: true }, { label: "Clear", onSelect: () => void run("tasks.assign", { slot, to: null }) });
    menu.show(items, at.x, at.y, "other", { label: slot }, { search: "Find someone" });
  };
  const pick = async (e: unknown, cap: "tasks.dependencies.add" | "parent"): Promise<void> => {
    const at = pointAt(e);
    let rows: TaskRow[] = [];
    try { rows = ((await rt.call("tasks.index", { scope: "everyone" })) as IndexOut).rows.filter((r) => r.id !== task.id); } catch { rows = []; }
    menu.show(rows.slice(0, 200).map((r) => ({ label: `${r.key ?? ""} ${r.title}`.trim(), onSelect: () => void (cap === "parent" ? run("tasks.update", { parentTaskId: r.id }) : run("tasks.dependencies.add", { dependsOnId: r.id })) })), at.x, at.y, "other", { label: "Pick a task" }, { search: "Find a task" });
  };
  const pickProject = async (e: unknown): Promise<void> => {
    const at = pointAt(e);
    let rows: Array<{ recordId: string; title: string }> = [];
    try { rows = ((await rt.call("projects.list", {})) as { projects: Array<{ recordId: string; title: string }> }).projects; } catch { rows = []; }
    menu.show(rows.length === 0 ? [{ head: "No projects yet." }] : rows.map((p) => ({ label: p.title, onSelect: () => void run("tasks.links.add", { recordId: p.recordId }) })), at.x, at.y, "other", { label: "Move to a project" }, { search: "Find a project" });
  };
  const [estimate, setEstimate] = useState(task.effort === undefined ? "" : String(task.effort));
  useEffect(() => setEstimate(task.effort === undefined ? "" : String(task.effort)), [task.effort]);
  const parent = useLive<TaskOut>(rt.screens, "tasks.page", "task", task.parentTaskId ? { route: { taskId: task.parentTaskId } } : null);
  const parentKey = parent.status === "ready" ? parent.data.task.key : undefined;
  const [waits, setWaits] = useState<ReadonlyArray<{ id: string; key?: string; title: string }>>([]);
  const waitIds = task.dependsOn.join(",");
  useEffect(() => {
    let live = true;
    const ids = waitIds === "" ? [] : waitIds.split(",").slice(0, 6);
    void Promise.all(ids.map((id) => rt.call("tasks.get", { taskId: id }).then((o) => { const t = (o as TaskOut).task; return { id, title: t.title, ...(t.key ? { key: t.key } : {}) }; }, () => ({ id, title: "A task" })))).then((rows) => { if (live) setWaits(rows); });
    return () => { live = false; };
  }, [rt, waitIds]);
  const followerFaces: ReactElement[] = [];
  for (const id of task.followers.slice(0, 4)) followerFaces.push(<Avatar key={id} name={nameOf(id)} seedId={id} kind={id.startsWith("agt_") ? "agent" : "person"} size={18} />);
  const [labelText, setLabelText] = useState((task.labels ?? []).join(" "));
  useEffect(() => setLabelText((task.labels ?? []).join(" ")), [task.labels]);
  const notes = Object.entries(task.workingNotes).filter(([k]) => !OWN_NOTE.test(k));
  const [noteText, setNoteText] = useState(task.workingNotes[NOTES_KEY] ?? "");
  useEffect(() => setNoteText(task.workingNotes[NOTES_KEY] ?? ""), [task.workingNotes[NOTES_KEY]]);  // eslint-disable-line react-hooks/exhaustive-deps
  const fieldsQ = useTypeFields(rt);
  const due = dueLabel(task.due, clock.now, clock.offsetMin);
  const noteRows: ReactElement[] = [];
  for (const [k, v] of notes) if (k !== NOTES_KEY) noteRows.push(<Text key={k} style={st.quiet}>{`${k}: ${v}`}</Text>);
  const customRows: ReactElement[] = [];
  for (const f of fieldsQ) {
    const v = task.fields?.[f.key];
    customRows.push(<KV key={f.key} label={f.title} testID={`rail-field-${f.key}`}><TextInput accessibilityLabel={f.title} placeholder="Add" placeholderTextColor="var(--ink-4)" defaultValue={v === undefined ? "" : String(v)} onEndEditing={(e) => { const t = e.nativeEvent.text.trim(); if (t !== String(v ?? "")) void run("tasks.update", { fields: { [f.key]: t === "" ? null : t } }); }} style={st.kvInput} /></KV>);
  }
  return <ScrollView testID="task-rail" contentContainerStyle={st.rail}>
    <KV label="Status" testID="rail-status" onPress={(e) => { const at = pointAt(e); menu.show(statusEntries(task, rt.me.id, run, begin), at.x, at.y, "other", { label: "Status" }); }}><View style={st.kvFace}><StatusDot state={task.state as TaskState} size={13} /><Text style={st.kvVal}>{stateTitle(task.state as TaskState)}</Text></View></KV>
    <KV label="Assigned" testID="rail-assigned" onPress={(e) => slotMenu("assigned", e)}>{person("assigned", task.assigned)}</KV>
    {(task.assigned.kind === "group" || task.assigned.kind === "role") ? <KV label="Taken by" testID="rail-taken" {...(canTake(task) ? { onPress: () => void run("tasks.take", {}) } : canRelease(task, rt.me.id) ? { onPress: () => void run("tasks.release", {}) } : {})}>{task.takenBy ? <Text numberOfLines={1} style={st.kvVal}>{task.takenBy === rt.me.id ? "You (give it back)" : nameOf(task.takenBy)}</Text> : <Text style={st.kvAdd}>{canTake(task) ? "Take it" : "Nobody yet"}</Text>}</KV> : null}
    <KV label="Reviewer" testID="rail-reviewer" onPress={(e) => slotMenu("reviewer", e)}>{person("reviewer", task.reviewer)}</KV>
    <KV label="Approver" testID="rail-approver" onPress={(e) => slotMenu("approver", e)}>{person("approver", task.approver)}</KV>
    <KV label="Due" testID="rail-due" onPress={(e) => { const at = pointAt(e); menu.show(dueEntries(act, (when) => void run("tasks.update", { due: when })), at.x, at.y, "other", { label: "Due" }); }}>{due.text ? <Text style={[st.kvVal, due.late && { color: "var(--danger)" as string }]}>{due.text}</Text> : <Text style={st.kvAdd}>Add</Text>}</KV>
    <KV label="Priority" testID="rail-priority" onPress={(e) => { const at = pointAt(e); menu.show(priorityEntries(task.priority, (k) => void run("tasks.update", { priority: k })), at.x, at.y, "other", { label: "Priority" }); }}><Text style={st.kvVal}>{PRIORITIES.find((p) => p.key === (task.priority ?? "normal"))?.title}</Text></KV>
    <View style={{ height: 12 }} />
    <KV label="Project" testID="rail-project" onPress={(e) => { if (task.recordId) rt.open({ subject: { type: "record", id: task.recordId } }); else void pickProject(e); }}>{task.recordId ? <ProjectName rt={rt} recordId={task.recordId} /> : <Text style={st.kvAdd}>Add</Text>}</KV>
    <KV label="Parent" testID="rail-parent" onPress={(e) => { if (task.parentTaskId) openTask(task.parentTaskId); else void pick(e, "parent"); }}>{task.parentTaskId ? <Text style={st.kvVal}>{parentKey ?? "Open"}</Text> : <Text style={st.kvAdd}>Add</Text>}</KV>
    <KV label="Waits on" testID="rail-waits" onPress={(e) => { if (task.dependsOn.length === 0) { void pick(e, "tasks.dependencies.add"); return; } const at = pointAt(e); menu.show([...waits.map((w): MenuEntry => ({ label: `Stop waiting on ${w.key ?? w.title}`, onSelect: () => void run("tasks.dependencies.remove", { dependsOnId: w.id }) })), { separator: true }, { label: "Wait on another task", onSelect: () => void pick(e, "tasks.dependencies.add") }], at.x, at.y, "other", { label: "Waits on" }); }}>{task.dependsOn.length ? <Text numberOfLines={1} style={st.kvVal}>{waits.length ? waits.map((w) => w.key ?? w.title).join(", ") : `${task.dependsOn.length} ${task.dependsOn.length === 1 ? "task" : "tasks"}`}</Text> : <Text style={st.kvAdd}>Add</Text>}</KV>
    <KV label="Labels" testID="rail-labels"><TextInput accessibilityLabel="Labels" placeholder="Add" placeholderTextColor="var(--ink-4)" value={labelText} onChangeText={setLabelText} onBlur={() => { const next = [...new Set(labelText.split(/[\s,]+/).map((l) => l.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))]; if (next.join() !== (task.labels ?? []).join()) void run("tasks.update", { labels: next }); }} style={st.kvInput} /></KV>
    <KV label="Repeats" testID="rail-repeat" onPress={(e) => { const at = pointAt(e); const on = task.recur?.every; menu.show([{ label: "Does not repeat", checked: !on, onSelect: () => void run("tasks.update", { recur: null }) }, { label: "Every day", checked: on === "day", onSelect: () => void run("tasks.update", { recur: { every: "day" } }) }, { label: "Every week", checked: on === "week", onSelect: () => void run("tasks.update", { recur: { every: "week" } }) }, { label: "Every month", checked: on === "month", onSelect: () => void run("tasks.update", { recur: { every: "month" } }) }], at.x, at.y, "other", { label: "Repeats" }); }}>{task.recur ? <Text style={st.kvVal}>{`Every ${task.recur.every}`}</Text> : <Text style={st.kvAdd}>Add</Text>}</KV>
    <KV label="Following" testID="rail-following" onPress={() => void run(task.followers.includes(rt.me.id) ? "tasks.followers.remove" : "tasks.followers.add", { follower: rt.me.id })}>{task.followers.length ? <View style={st.kvFace}>{followerFaces}</View> : <Text style={st.kvVal}>Follow</Text>}</KV>
    <KV label="Estimate" testID="rail-estimate"><TextInput accessibilityLabel="Estimate in minutes" placeholder="Add" placeholderTextColor="var(--ink-4)" value={estimate} onChangeText={setEstimate} onBlur={() => { const t = estimate.trim(); const n = t === "" ? null : Number(t); if (n === null || (Number.isInteger(n) && n >= 0)) { if ((n ?? undefined) !== task.effort) void run("tasks.update", { effort: n }); } else setEstimate(task.effort === undefined ? "" : String(task.effort)); }} style={st.kvInput} /></KV>
    {customRows}
    <View style={{ height: 12 }} />
    <RailLink label="Add a field" testID="rail-add-field" onPress={() => rt.open({ screen: "records.types", args: { type: "task", edit: "fields" } })} />
    <RailLink label={task.snoozedUntil ? "Clear the snooze" : "Snooze"} testID="rail-snooze" onPress={(e) => { if (task.snoozedUntil) { void run("tasks.snooze", { until: null }); return; } const at = pointAt(e); const n = rt.clock().now; menu.show([{ label: "Until tomorrow", onSelect: () => void run("tasks.snooze", { until: n + 86_400_000 }) }, { label: "For a week", onSelect: () => void run("tasks.snooze", { until: n + 7 * 86_400_000 }) }, { label: "For a month", onSelect: () => void run("tasks.snooze", { until: n + 30 * 86_400_000 }) }], at.x, at.y, "other", { label: "Snooze" }); }} />
    {task.recordId ? <RailLink label="Open in Records" testID="rail-records" onPress={() => rt.open({ subject: { type: "record", id: task.recordId! } })} /> : null}
    <Text style={st.notesHead}>Working notes</Text>
    <TextInput accessibilityLabel="Working notes" testID="rail-notes" multiline placeholder="Anyone on this task, person or agent, can read and write these." placeholderTextColor="var(--ink-3)" value={noteText} onChangeText={setNoteText} onBlur={() => { if (noteText !== (task.workingNotes[NOTES_KEY] ?? "")) void run("tasks.working_notes.set", { key: NOTES_KEY, value: noteText }); }} style={st.notes} />
    {noteRows}
    <Text style={st.quiet}>{`${KIND_TITLE[task.kind] ?? task.kind}${kidsCount ? ` · ${kidsCount} under it` : ""}`}</Text>
  </ScrollView>;
}

function ProjectName({ rt, recordId }: { rt: ShellRuntime; recordId: string }): ReactElement {
  return <Text numberOfLines={1} style={st.kvVal}>{rt.recordTitle(recordId) ?? "Open"}</Text>;
}

/** The fields the Space added to the Task type. */
function useTypeFields(rt: ShellRuntime): ReadonlyArray<{ key: string; title: string }> {
  const [fields, setFields] = useState<ReadonlyArray<{ key: string; title: string }>>([]);
  useEffect(() => {
    void rt.call("schema.types.get", { type: "task" }).then((o) => {
      const all = ((o as { type?: { fields?: Array<{ key: string; title?: string; label?: string; system?: boolean }> } }).type?.fields ?? []);
      setFields(all.filter((f) => !BUILT_IN.has(f.key)).map((f) => ({ key: f.key, title: f.title ?? f.label ?? f.key })));
    }, () => setFields([]));
  }, [rt]);
  return fields;
}
const BUILT_IN = new Set(["title", "summary", "why", "kind", "status", "project", "stage", "assigned", "reviewer", "approver", "start", "due", "effort", "milestone", "parent", "depends_on", "order", "source", "thread", "attachments", "notes", "priority", "labels", "estimate"]);

function KV({ label, onPress, testID, children }: { label: string; onPress?(e: unknown): void; testID: string; children: ReactNode }): ReactElement {
  // a field typed into has no press of its own
  if (!onPress) return <View testID={testID} style={st.kv}><Text style={st.kvKey}>{label}</Text><View style={st.kvRight}>{children}</View></View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [st.kv, hovered === true && { backgroundColor: "var(--hover)" as string }]}><Text style={st.kvKey}>{label}</Text><View style={st.kvRight}>{children}</View></Pressable>;
}
function RailLink({ label, onPress, testID }: { label: string; onPress(e: unknown): void; testID: string }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [st.kv, hovered === true && { backgroundColor: "var(--hover)" as string }]}><Text style={st.kvKey}>{label}</Text></Pressable>;
}

const st = StyleSheet.create({
  besideBtn: { paddingLeft: 8, paddingTop: 0, alignSelf: "center" },
  root: { flex: 1, padding: 28, backgroundColor: "var(--win)" as string },
  row: { flex: 1, minHeight: 0, flexDirection: "row", backgroundColor: "var(--win)" as string },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  // a gutter of its own, so the page in a side pane or on a phone does not touch the edges
  col: { width: "100%", maxWidth: 672, alignSelf: "center", paddingTop: 26, paddingHorizontal: 16 },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 24 },
  key: { marginRight: 8, fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  label: { fontSize: 12, color: "var(--ink-3)" as string },
  iconBtn: { width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: 260, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, backgroundColor: "var(--sunk)" as string },
  chipText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 10 },
  h1: { flex: 1, minWidth: 0, fontSize: 27, lineHeight: 34, fontWeight: "600", letterSpacing: -0.5, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  pathRow: { flexDirection: "row", flexWrap: "wrap", rowGap: 8, alignItems: "center", marginTop: 18, paddingLeft: 36 },
  path: { flexDirection: "row", alignItems: "center", gap: 8 },
  pathLine: { width: 34, height: 1, marginHorizontal: 10, backgroundColor: "var(--line-2)" as string },
  pathDone: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  pathTitle: { fontSize: 11, lineHeight: 14, color: "var(--ink-3)" as string },
  pathName: { fontSize: 13, lineHeight: 16, color: "var(--ink)" as string },
  liveLine: { paddingLeft: 36, paddingTop: 10 },
  waiting: { paddingLeft: 36, paddingTop: 12, fontSize: 13, color: "var(--ink-3)" as string },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 36, paddingTop: 14 },
  actionForm: { gap: 2, paddingTop: 10 },
  input: { marginLeft: 36, padding: 10, minHeight: 38, borderRadius: 9, fontSize: 14, color: "var(--ink)" as string, backgroundColor: "var(--sunk)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  btn: { height: 32, justifyContent: "center", paddingHorizontal: 13, borderRadius: 9 },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnText: { fontSize: 13.5, fontWeight: "600", color: "var(--ink-2)" as string },
  error: { paddingLeft: 36, paddingTop: 10, fontSize: 13, color: "var(--danger)" as string },
  block: { paddingTop: 14, paddingLeft: 36 },
  blockHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  blockTitle: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  blockRight: { fontSize: 12.5, color: "var(--ink-3)" as string },
  body: { fontSize: 15, lineHeight: 23, color: "var(--ink-2)" as string },
  briefEdit: { minHeight: 70, outlineStyle: "none", outlineWidth: 0 } as object,
  briefAdd: { fontSize: 14, color: "var(--ink-3)" as string },
  doneLine: { paddingTop: 6, fontSize: 14, color: "var(--ok)" as string },
  option: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40, paddingHorizontal: 10, borderRadius: 10 },
  optionText: { fontSize: 14.5, color: "var(--ink)" as string },
  optionHint: { marginLeft: "auto", fontSize: 12.5, color: "var(--ink-3)" as string },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: "var(--line-2)" as string },
  inline: { flex: 1, minWidth: 0, height: 28, fontSize: 14, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  check: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 5 },
  tick: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1.5px var(--line-2)" } as object,
  tickOn: { backgroundColor: "var(--accent)" as string, boxShadow: "none" } as object,
  checkText: { flex: 1, fontSize: 14, color: "var(--ink)" as string },
  outputs: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  output: { flexDirection: "row", alignItems: "center", gap: 7, height: 32, paddingHorizontal: 11, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  outputText: { fontSize: 13, color: "var(--ink)" as string },
  field: { gap: 2, paddingTop: 6 },
  fieldName: { fontSize: 12, color: "var(--ink-3)" as string },
  roll: { height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: "var(--line)" as string, marginTop: 2, marginBottom: 8 },
  rollFill: { height: "100%", borderRadius: 2, backgroundColor: "var(--accent)" as string },
  tree: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 42 },
  treeMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", height: 42 },
  treeTitle: { flexShrink: 1, fontSize: 14, color: "var(--ink)" as string },
  treeSub: { flex: 1, minWidth: 0, marginLeft: 12, fontSize: 12.5, color: "var(--ink-3)" as string },
  struck: { color: "var(--ink-3)" as string, textDecorationLine: "line-through" },
  addKid: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34 },
  addDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderStyle: "dashed", borderColor: "var(--line-2)" as string },
  feedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 26, marginLeft: 36, paddingTop: 10, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  rail: { padding: 14, paddingTop: 8 },
  kv: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, minHeight: 32, paddingHorizontal: 2, borderRadius: 6 },
  kvKey: { fontSize: 13.5, color: "var(--ink-3)" as string },
  kvRight: { flexShrink: 1, minWidth: 0, alignItems: "flex-end" },
  kvFace: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  kvVal: { fontSize: 13.5, color: "var(--ink)" as string },
  kvAdd: { fontSize: 13.5, color: "var(--ink-4)" as string },
  kvInput: { width: 120, height: 24, textAlign: "right", fontSize: 13.5, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  notesHead: { marginTop: 16, marginBottom: 4, fontSize: 12, color: "var(--ink-3)" as string },
  notes: { minHeight: 72, fontSize: 13, lineHeight: 19, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingTop: 6 },
});
