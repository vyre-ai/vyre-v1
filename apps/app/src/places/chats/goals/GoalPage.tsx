// One goal's page, in a tab: the page with the goal's chat under it, the same shape as a task page. The head says what the goal is, who leads it and whose move it is, with the controls
// (Pause, Edit finish line, Add helper, More). Under it: a stuck, budget or ended notice when there is one, the number with its chart, what waits on whom with one-tap answers, the plan as
// tasks, then the goal chat and its composer. The pane on the right holds Activity (every step and why), Details (finish line, check-ins, budget, permissions, people) and Files.
// Every change is one capability call; the page reads the goal again when the Space changes. Nothing blinks: numbers and bars are drawn at their values.
import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import type { ConversationData } from "../conversation/data.tsx";
import type { Changes } from "../conversation/use-follow.ts";
import { useGoal } from "./data.ts";
import type { Call } from "./data.ts";
import { Bar, TONE } from "./GoalRow.tsx";
import { ENDED, LIVE, budgetOf, byDay, chartOf, fmt, fractionOf, leftWords, numberOf, rhythmWords, statusOf, taskWord, whenWords } from "./model.ts";
import type { Goal, GoalPageData, TaskLine, Tone, WaitLine } from "./model.ts";

export interface GoalPageProps {
  goalId: string;
  call: Call;
  changes: Changes | undefined;
  me: string;
  nameOf(id: string): string;
  clock(): { now: number; offsetMin: number };
  /** The chat wiring for the goal's thread: the same conversation data any chat has. */
  conversationFor(threadId: string): ConversationData;
  openTask(taskId: string): void;
  openAgent(agentId: string): void;
  openFolder?(folderId: string): void;
  openFile?(fileId: string): void;
  /** Put words in the goal chat's composer ("Change the plan: "). */
  fill?(text: string): void;
  /** Off where the page sits in a narrow window: the pane folds away. */
  pane?: boolean;
}

type PaneTab = "activity" | "details" | "files";
const DAY = 86_400_000;

export function GoalPage({ goalId, call, changes, me, nameOf, clock, conversationFor, openTask, openAgent, openFolder, openFile, fill, pane = true }: GoalPageProps): ReactElement {
  const { state, reload } = useGoal(call, changes, goalId);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 640;
  const [tab, setTab] = useState<PaneTab>("activity");
  const [paneOpen, setPaneOpen] = useState(pane && !phone && width >= 980);
  const [line, setLine] = useState("");
  const menu = useMenu();
  const data = state.status === "ready" ? state.data : null;
  const g = data?.goal;
  const run = useCallback(async (cap: string, input: Record<string, unknown>, done?: string): Promise<boolean> => {
    setLine("");
    try { await call(cap, { goalId, ...input }); reload(); if (done) setLine(done); return true; }
    catch (e) { setLine(e instanceof Error && e.message ? e.message : "That could not be changed."); return false; }
  }, [call, goalId, reload]);
  useEffect(() => { setLine(""); }, [goalId]);
  const conv = useMemo(() => (g?.threadId ? conversationFor(g.threadId) : null), [conversationFor, g?.threadId]);

  if (!data || !g) {
    return <View testID="goal-page-loading" style={st.root}>{state.status === "error" ? <States kind="error" message="This goal is not available" cause={state.message} /> : <View style={st.loading} />}</View>;
  }
  const now = clock().now, offsetMin = clock().offsetMin;
  const showPane = (t: PaneTab): void => { setTab(t); setPaneOpen(true); };
  const head = (
    <View testID="goal-page-head" style={[st.col, phone && st.colPhone]}>
      <Head g={g} me={me} nameOf={nameOf} now={now} offsetMin={offsetMin} run={run} menu={menu} showPane={showPane} openAgent={openAgent} fill={fill} phone={phone} />
      {line ? <Text testID="goal-line" accessibilityLiveRegion="polite" style={st.line}>{line}</Text> : null}
      <Notice data={data} now={now} offsetMin={offsetMin} run={run} fill={fill} menu={menu} />
      <NumberBlock data={data} now={now} offsetMin={offsetMin} phone={phone} />
      <Waiting waits={data.waiting} call={call} nameOf={nameOf} now={now} offsetMin={offsetMin} openTask={openTask} onDone={reload} />
      <Plan tasks={data.tasks} nameOf={nameOf} openTask={openTask} />
    </View>
  );
  const feed = conv
    ? <Conversation key={g.threadId} compact data={{ ...conv, head, placeholder: ENDED.has(g.status) ? `Ask ${nameOf(g.leadAgentId)} about this goal` : `Message ${nameOf(g.leadAgentId)} about this goal` }} />
    : <ScrollView contentContainerStyle={st.scroll}>{head}</ScrollView>;
  return (
    <View testID="goal-page" style={st.row}>
      <View style={st.main}>{feed}</View>
      {paneOpen && !phone ? (
        <SidePane paneKey="goal-pane" toggle={{ open: true, onPress: () => setPaneOpen(false) }} title="Goal" tabs={[{ key: "activity", title: "Activity" }, { key: "details", title: "Details" }, { key: "files", title: "Files" }]} activeTab={tab} onSelectTab={(k) => setTab(k as PaneTab)} defaultWidth={340} onCloseTab={() => setPaneOpen(false)}>
          {tab === "activity" ? <Activity data={data} nameOf={nameOf} now={now} offsetMin={offsetMin} openTask={openTask} /> : tab === "details" ? <Details g={g} nameOf={nameOf} offsetMin={offsetMin} now={now} run={run} menu={menu} /> : <Files g={g} call={call} changes={changes} {...(openFolder ? { openFolder } : {})} {...(openFile ? { openFile } : {})} />}
        </SidePane>
      ) : null}
      {menu.element}
    </View>
  );
}

type Run = (cap: string, input: Record<string, unknown>, done?: string) => Promise<boolean>;
type Menu = ReturnType<typeof useMenu>;
const pointAt = (e: unknown): { x: number; y: number } => { const t = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } } | undefined)?.currentTarget?.getBoundingClientRect?.(); return { x: t?.left ?? 8, y: (t?.bottom ?? 48) + 4 }; };

/** Small line icons drawn the way the sidebar draws its own (web only; elsewhere the words carry it). */
const PATHS: Readonly<Record<string, readonly string[]>> = {
  target: ["M8 14a6 6 0 100-12 6 6 0 000 12z", "M8 11a3 3 0 100-6 3 3 0 000 6z", "M8 8.01V8"],
  clock: ["M8 14a6 6 0 100-12 6 6 0 000 12z", "M8 4.8V8l2.2 1.4"],
  cal: ["M3 4.5h10v8.5H3z", "M3 7h10", "M5.5 3v3M10.5 3v3"],
  pause: ["M6 4v8M10 4v8"],
  play: ["M5.5 3.8l6.5 4.2-6.5 4.2z"],
  edit: ["M10.8 2.7l2.5 2.5L6.5 12 3.5 12.5 4 9.5z"],
  plus: ["M8 3.5v9M3.5 8h9"],
  more: ["M3.5 8h.01", "M8 8h.01", "M12.5 8h.01"],
  warn: ["M8 2.5l6 10.5H2z", "M8 6.5v3M8 11.3v.01"],
  check: ["M3 8.5l3 3 7-7"],
  file: ["M4 2.5h5l3 3v8H4z", "M9 2.5v3h3"],
  folder: ["M2.5 4.5h4l1.5 1.5h5.5v7h-11z"],
};
export function Icon({ name, size = 14, color = "var(--ink-3)" }: { name: string; size?: number; color?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", fill: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : 1.4, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...(PATHS[name] ?? []).map((d) => createElement("path", { key: d, d })));
}

export function Btn({ label, icon, primary = false, danger = false, onPress, testID }: { label: string; icon?: string; primary?: boolean; danger?: boolean; onPress(e?: unknown): void; testID?: string }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [st.btn, primary && st.btnPrimary, hovered === true && !primary && { backgroundColor: "var(--hover)" as string }]}>
      {icon ? <Icon name={icon} color={primary ? "var(--accent-ink)" : danger ? "var(--danger)" : "var(--ink-2)"} /> : null}
      <Text style={[st.btnText, primary && { color: "var(--accent-ink)" as string }, danger && { color: "var(--danger)" as string }]}>{label}</Text>
    </Pressable>
  );
}

function extendEntries(g: Goal, run: Run): MenuEntry[] {
  const base = Math.max(g.deadline, Date.now());
  return [
    { label: "One more day", onSelect: () => void run("goals.extend", { deadline: base + DAY }, "Extended by a day") },
    { label: "Three more days", onSelect: () => void run("goals.extend", { deadline: base + 3 * DAY }, "Extended by three days") },
    { label: "One more week", onSelect: () => void run("goals.extend", { deadline: base + 7 * DAY }, "Extended by a week") },
  ];
}

function Head({ g, me, nameOf, now, offsetMin, run, menu, showPane, openAgent, fill, phone }: { g: Goal; me: string; nameOf(id: string): string; now: number; offsetMin: number; run: Run; menu: Menu; showPane(t: PaneTab): void; openAgent(id: string): void; fill: ((t: string) => void) | undefined; phone: boolean }): ReactElement {
  const s = statusOf(g, me);
  const live = LIVE.has(g.status);
  const more = (e: unknown): void => {
    const at = pointAt(e);
    const items: MenuEntry[] = [];
    if (live || g.status === "paused" || g.status === "missed") items.push({ head: "Extend the deadline" }, ...extendEntries(g, run), { separator: true });
    if (live || g.status === "paused") items.push({ label: "Change the plan", onSelect: () => fill?.("Change the plan: ") });
    items.push({ label: "Show activity", onSelect: () => showPane("activity") });
    if (!ENDED.has(g.status)) items.push({ separator: true }, { label: "Stop the goal", danger: true, onSelect: () => void run("goals.stop", {}, "Stopped. Its open tasks were withdrawn.") });
    menu.show(items, at.x, at.y, "other", { label: "Goal" });
  };
  return (
    <View>
      <View style={st.kicker}><Icon name="target" size={13} /><Text style={st.kickerText}>Goal</Text></View>
      <Text testID="goal-title" accessibilityRole="header" style={[st.h1, phone && st.h1Phone]}>{g.title}</Text>
      <Text testID="goal-finish" style={st.finish}>{g.finish.line}</Text>
      <View style={st.meta}>
        <Text testID="goal-status" style={[st.metaText, { color: TONE[s.tone] as string, fontWeight: s.tone === "plain" ? "400" : "600" }]}>{s.word}</Text>
        <Pressable accessibilityRole="link" accessibilityLabel={`Open ${nameOf(g.leadAgentId)}`} onPress={() => openAgent(g.leadAgentId)} style={st.metaItem}>
          <Avatar {...avatarOf({ id: g.leadAgentId, name: nameOf(g.leadAgentId), kind: "agent" })} size={18} /><Text style={st.metaText}>{`${nameOf(g.leadAgentId)} leads`}</Text>
        </Pressable>
        <View style={st.metaItem}><Avatar {...avatarOf({ id: g.owner, name: nameOf(g.owner), kind: "person" })} size={18} /><Text style={st.metaText}>{`${g.owner === me ? "You own it" : `${nameOf(g.owner)} owns it`}`}</Text></View>
        {live && g.nextCheckinAt ? <View style={st.metaItem}><Icon name="clock" /><Text style={st.metaText}>{`Check-in ${whenWords(g.nextCheckinAt, now, offsetMin)}`}</Text></View> : null}
        <View style={st.metaItem}><Icon name="cal" /><Text style={st.metaText}>{ENDED.has(g.status) ? `Ended ${whenWords(g.endedAt ?? now, now, offsetMin)}` : `Due ${whenWords(g.deadline, now, offsetMin)}`}</Text></View>
      </View>
      {ENDED.has(g.status) ? null : (
        <View style={st.controls}>
          {g.status === "draft" ? <Btn label="Start goal" primary testID="goal-start" onPress={() => void run("goals.confirm", {}, "Started")} /> : null}
          {live ? <Btn label="Pause" icon="pause" testID="goal-pause" onPress={() => void run("goals.pause", {}, "Paused. Nothing wakes until you resume it.")} /> : null}
          {g.status === "paused" ? <Btn label="Resume" icon="play" testID="goal-resume" onPress={() => void run("goals.resume", {}, "Resumed")} /> : null}
          <Btn label="Edit finish line" icon="edit" testID="goal-edit" onPress={() => showPane("details")} />
          <Btn label="Add helper" icon="plus" testID="goal-add-helper" onPress={() => showPane("details")} />
          <Btn label="More" icon="more" testID="goal-more" onPress={more} />
        </View>
      )}
    </View>
  );
}

/** Stuck, the budget, a draft or the end: one notice, above the number, with what you can do about it. */
function Notice({ data, now, offsetMin, run, fill, menu }: { data: GoalPageData; now: number; offsetMin: number; run: Run; fill: ((t: string) => void) | undefined; menu: Menu }): ReactElement | null {
  const g = data.goal;
  const b = budgetOf(g);
  if (g.status === "stuck") {
    return (
      <Card testID="goal-stuck" tone="stuck" icon="warn" title={`Stuck${g.lastCheckinAt ? ` since ${whenWords(g.lastCheckinAt, now, offsetMin)}` : ""}`}>
        <Text style={st.body}>{g.statusReason ?? "No progress."}</Text>
        <View style={st.cardActions}>
          <Btn label="Change the plan" primary onPress={() => fill?.("Change the plan: ")} testID="goal-stuck-plan" />
          <Btn label="Extend the deadline" onPress={(e) => { const at = pointAt(e); menu.show(extendEntries(g, run), at.x, at.y, "other", { label: "Extend" }); }} testID="goal-stuck-extend" />
          <Btn label="Stop" danger onPress={() => void run("goals.stop", {}, "Stopped")} testID="goal-stuck-stop" />
        </View>
        <Text style={st.small}>You were told once. It will not repeat until something changes.</Text>
      </Card>
    );
  }
  if (g.status === "paused" && b.used >= 1) {
    return (
      <Card testID="goal-budget-full" tone="need" icon="pause" title="Paused: the budget is used">
        <Text style={st.body}>{`${b.text}. Raise the budget to go on.`}</Text>
        <View style={st.cardActions}><Btn label="Raise by half" primary testID="goal-raise" onPress={() => void run("goals.update", { budget: { ...(g.budget.spendMicros ? { spendMicros: Math.round(g.budget.spendMicros * 1.5) } : {}), ...(g.budget.turns ? { turns: Math.round(g.budget.turns * 1.5) } : {}) } }, "Budget raised. The goal goes on.")} /><Btn label="Stop" danger onPress={() => void run("goals.stop", {}, "Stopped")} /></View>
      </Card>
    );
  }
  if (g.status === "draft") {
    return (
      <Card testID="goal-draft" tone="plain" icon="target" title="Drafted, not started">
        <Text style={st.body}>{`Nothing runs and no permission holds until you press Start goal.`}</Text>
      </Card>
    );
  }
  if (ENDED.has(g.status)) {
    const missed = g.status === "missed";
    return (
      <Card testID={`goal-ended-${g.status}`} tone={g.status === "done" ? "ok" : "plain"} icon={g.status === "done" ? "check" : "target"} title={g.status === "done" ? `Reached ${whenWords(g.endedAt ?? now, now, offsetMin)}` : missed ? `Missed: ${numberOf(g.progress)} by the deadline` : "Stopped"}>
        {g.summary ? <Text style={st.body}>{g.summary}</Text> : null}
        {g.retro ? (
          <View style={st.retro}>
            {g.retro.worked.length ? <Text style={st.label}>What moved it</Text> : null}
            {g.retro.worked.map((w) => <Row key={`w${w}`} id={`rw-${w.slice(0, 20)}`} title={w} leading={<View style={{ marginRight: 8 }}><Icon name="check" color="var(--ok)" /></View>} />)}
            {g.retro.didNot.length ? <Text style={st.label}>What held it back</Text> : null}
            {g.retro.didNot.map((w) => <Row key={`d${w}`} id={`rd-${w.slice(0, 20)}`} title={w} leading={<View style={{ marginRight: 8 }}><Icon name="clock" /></View>} />)}
          </View>
        ) : <Text style={st.small}>The retrospective comes from the lead agent in the goal chat.</Text>}
        {missed ? <View style={st.cardActions}><Btn label="Extend" primary testID="goal-extend" onPress={(e) => { const at = pointAt(e); menu.show(extendEntries(g, run), at.x, at.y, "other", { label: "Extend" }); }} /></View> : null}
      </Card>
    );
  }
  if (b.warn) return <Text testID="goal-budget-warn" style={[st.line, { color: "var(--warn)" as string }]}>{`80% of the budget is used: ${b.text}.`}</Text>;
  return null;
}

function Card({ tone, icon, title, children, testID }: { tone: Tone; icon: string; title: string; children: ReactNode; testID: string }): ReactElement {
  return (
    <View testID={testID} style={[st.card, tone === "ok" && { backgroundColor: "color-mix(in srgb, var(--ok) 8%, transparent)" as string }]}>
      <View style={st.cardHead}><Icon name={icon} size={16} color={TONE[tone]} /><Text style={st.cardTitle}>{title}</Text></View>
      {children}
    </View>
  );
}

/** The number, big and still, with where it comes from and the chart of how it got here. */
function NumberBlock({ data, now, offsetMin, phone }: { data: GoalPageData; now: number; offsetMin: number; phone: boolean }): ReactElement {
  const g = data.goal, p = g.progress;
  const src = g.finish.source?.label ?? (g.finish.kind === "checklist" ? "the checklist" : g.finish.kind === "owner" ? "the owner says done" : "the source");
  const sub = p.error ? `Can't read ${src}: ${p.error}` : p.readAt ? `${src}, read ${whenWords(p.readAt, now, offsetMin)}` : src;
  const big = p.target !== undefined ? (p.value === undefined ? "–" : fmt(p.value)) : p.items !== undefined ? String(p.itemsDone ?? 0) : String(p.tasksDone);
  const of = p.target !== undefined ? `/ ${fmt(p.target)}` : p.items !== undefined ? `of ${p.items}` : `of ${p.tasks} tasks`;
  return (
    <View testID="goal-number" style={st.numberBlock}>
      <View style={st.numRow}>
        <Text style={[st.big, phone && st.bigPhone]}>{big}</Text><Text style={st.of}>{of}</Text>
        <View style={{ flex: 1 }} />
        <View style={st.numRight}>
          <Text style={st.pct}>{`${Math.round(fractionOf(p) * 100)}%`}</Text>
          <Text style={st.small}>{ENDED.has(g.status) ? "Ended" : leftWords(g.deadline, now)}</Text>
        </View>
      </View>
      <Bar value={fractionOf(p)} tone={g.status === "done" ? "ok" : "plain"} width="100%" testID="goal-progress" />
      <Text testID="goal-source" style={[st.small, p.error && { color: "var(--danger)" as string }]}>{sub}</Text>
      {g.finish.kind === "number" ? <ChartView data={data} now={now} /> : null}
      {g.finish.kind === "checklist" ? <View style={st.list}>{(g.finish.items ?? []).map((i) => <Row key={i.id} id={`ci-${i.id}`} title={i.text} leading={<View style={{ marginRight: 8 }}><Icon name={i.done ? "check" : "target"} color={i.done ? "var(--ok)" : "var(--ink-4)"} /></View>} />)}</View> : null}
    </View>
  );
}

function ChartView({ data, now }: { data: GoalPageData; now: number }): ReactElement | null {
  const w = 560, h = 120;
  const c = chartOf(data.readings, data.goal, w, h, now);
  if (!c || Platform.OS !== "web") return null;
  const e = createElement;
  return (
    <View testID="goal-chart" style={st.chart} accessibilityLabel={`Progress over time, now ${numberOf(data.goal.progress)}`}>
      {e("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h, preserveAspectRatio: "none", "aria-hidden": true, style: { display: "block" } },
        e("line", { key: "t", x1: 0, x2: w, y1: c.targetY, y2: c.targetY, stroke: "var(--line)", strokeDasharray: "3 4" }),
        e("path", { key: "p", d: c.pace, fill: "none", stroke: "var(--ink-4)", strokeDasharray: "2 4", strokeWidth: 1 }),
        e("line", { key: "d", x1: c.deadlineX, x2: c.deadlineX, y1: 0, y2: h, stroke: "var(--line)" }),
        e("path", { key: "a", d: c.area, fill: "var(--accent-wash)", stroke: "none" }),
        e("path", { key: "l", d: c.line, fill: "none", stroke: "var(--accent)", strokeWidth: 2, strokeLinejoin: "round" }),
      )}
      <View style={st.chartLegend}><Text style={st.tiny}>Target</Text><Text style={st.tiny}>Dashed: the pace to reach it by the deadline</Text></View>
    </View>
  );
}

/** What waits on whom, with the answer one press away. A press acts on the task itself; the goal hears and goes on. */
function Waiting({ waits, call, nameOf, now, offsetMin, openTask, onDone }: { waits: readonly WaitLine[]; call: Call; nameOf(id: string): string; now: number; offsetMin: number; openTask(id: string): void; onDone(): void }): ReactElement | null {
  if (waits.length === 0) return null;
  return (
    <View testID="goal-waiting" style={st.section}>
      <Text style={st.label}>Waiting on</Text>
      {/* ui-rows-lint: not a list (each waiting item is a card with its own answer buttons) */}
      {waits.map((w) => <WaitRow key={w.taskId} w={w} call={call} nameOf={nameOf} now={now} offsetMin={offsetMin} openTask={openTask} onDone={onDone} />)}
    </View>
  );
}

interface TaskActs { state?: string; actions?: Array<{ key: string; label: string; note?: string }>; blocks?: Array<{ type: string; data?: { options?: Array<{ label?: string } | string> } }> }
function WaitRow({ w, call, nameOf, now, offsetMin, openTask, onDone }: { w: WaitLine; call: Call; nameOf(id: string): string; now: number; offsetMin: number; openTask(id: string): void; onDone(): void }): ReactElement {
  const [task, setTask] = useState<TaskActs | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => { void call("tasks.get", { taskId: w.taskId }).then((o) => setTask((o as { task?: TaskActs }).task ?? null), () => setTask(null)); }, [call, w.taskId]);
  const act = (action: string, answer?: string): void => {
    void call("tasks.act", { taskId: w.taskId, action, ...(answer !== undefined ? { answer } : {}) }).then(() => { setSaid(answer ?? (action === "approve" ? "Approved" : "Done")); onDone(); }, (e: unknown) => setSaid(e instanceof Error ? e.message : "That did not go through."));
  };
  const options = (task?.blocks?.find((b) => b.type === "question")?.data?.options ?? []).map((o) => (typeof o === "string" ? o : o.label ?? "")).filter((o) => o !== "");
  const who = w.assigned ? nameOf(w.assigned.id) : "someone";
  const buttons: ReactElement[] = [];
  if (options.length > 0) options.slice(0, 4).forEach((o, i) => buttons.push(<Btn key={o} label={o} primary={i === 0} onPress={() => act("answer", o)} testID={`goal-wait-${w.taskId}-${i}`} />));
  else if (w.kind === "approve") {
    buttons.push(<Btn key="ok" label="Approve" primary onPress={() => act("approve")} testID={`goal-wait-${w.taskId}-approve`} />);
    buttons.push(<Btn key="later" label="Not now" onPress={() => void call("tasks.snooze", { taskId: w.taskId, until: now + DAY }).then(onDone, () => undefined)} testID={`goal-wait-${w.taskId}-later`} />);
  }
  buttons.push(<Btn key="open" label="Open" onPress={() => openTask(w.taskId)} testID={`goal-wait-${w.taskId}-open`} />);
  return (
    <View testID={`goal-wait-${w.taskId}`} style={st.wait}>
      <Text style={st.waitTitle}>{w.title}</Text>
      <Text style={st.small}>{`${who} · since ${whenWords(w.since, now, offsetMin)}`}</Text>
      {said ? <Text style={[st.small, { color: "var(--ok)" as string }]}>{said}</Text> : <View style={st.cardActions}>{buttons}</View>}
    </View>
  );
}

function Plan({ tasks, nameOf, openTask }: { tasks: readonly TaskLine[]; nameOf(id: string): string; openTask(id: string): void }): ReactElement {
  const done = tasks.filter((t) => t.state === "done").length;
  return (
    <View testID="goal-plan" style={st.section}>
      <Text style={st.label}>{tasks.length ? `Plan · ${done} of ${tasks.length} done` : "Plan"}</Text>
      {tasks.length === 0 ? <Text style={st.small}>The lead agent researches first, then plans here.</Text> : null}
      {tasks.map((t) => {
        const s = taskWord(t.state, t.blocked);
        return <Row key={t.taskId} id={`gt-${t.taskId}`} title={t.title} titleSuffix={t.key ?? ""} onPress={() => openTask(t.taskId)}
          leading={<View style={{ marginRight: 8 }}><Icon name={t.state === "done" ? "check" : "target"} color={t.state === "done" ? "var(--ok)" : "var(--ink-4)"} /></View>}
          trailing={<View style={st.planTrail}><Text style={[st.small, { color: TONE[s.tone] as string }]}>{s.word}</Text>{t.assigned ? <Avatar {...avatarOf({ id: t.assigned.id, name: nameOf(t.assigned.id), kind: t.assigned.kind === "agent" ? "agent" : "person" })} size={18} /> : null}</View>} />;
      })}
    </View>
  );
}

function Activity({ data, nameOf, now, offsetMin, openTask }: { data: GoalPageData; nameOf(id: string): string; now: number; offsetMin: number; openTask(id: string): void }): ReactElement {
  const days = byDay(data.activity, now, offsetMin);
  if (days.length === 0) return <Text style={[st.small, st.pad]}>Nothing yet.</Text>;
  return (
    <ScrollView testID="goal-activity" contentContainerStyle={st.pad}>
      {/* ui-rows-lint: not a list (a day heading over its rows, which are ui/Row) */}
      {days.map((d) => (
        <View key={d.day} style={st.day}>
          <Text style={st.label}>{d.day}</Text>
          {d.items.map((a) => (
            <Row key={`${a.at}-${a.kind}-${a.text.slice(0, 24)}`} id={`ga-${a.at}`} title={a.text} note={`${whenWords(a.at, now, offsetMin)}${a.by ? ` · ${credit(a.by, nameOf)}` : ""}`}
              {...(a.ref?.startsWith("tsk_") ? { onPress: () => openTask(a.ref!) } : {})} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
/** Who did it: a person by name, a person's agent as "<Person> (Agent)", the server as Vyre. */
function credit(by: string, nameOf: (id: string) => string): string {
  const [actor, forWho] = by.split(">");
  if (forWho) return `${nameOf(forWho)} (Agent)`;
  if (actor?.startsWith("svc_")) return "Vyre";
  return nameOf(actor ?? by);
}

function Details({ g, nameOf, offsetMin, now, run, menu }: { g: Goal; nameOf(id: string): string; offsetMin: number; now: number; run: Run; menu: Menu }): ReactElement {
  const b = budgetOf(g);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(String(g.finish.target ?? ""));
  const people: Array<{ id: string; kind: string; role: string }> = [{ id: g.owner, kind: "person", role: "Owner" }, { id: g.leadAgentId, kind: "agent", role: "Lead" }, ...g.helpers.map((h) => ({ id: h.id, kind: h.kind, role: "Helper" }))];
  return (
    <ScrollView testID="goal-details" contentContainerStyle={st.pad}>
      <Text style={st.label}>Finish line</Text>
      <Text style={st.body}>{g.finish.line}</Text>
      {g.finish.kind === "number" ? (editing ? (
        <View style={st.cardActions}>
          <Text style={st.small}>Target</Text>
          {createElement("input", { "aria-label": "Target", value: target, onChange: (e: { target: { value: string } }) => setTarget(e.target.value), style: { width: 90, font: "inherit", fontSize: 13, padding: "4px 6px", border: "1px solid var(--field-line)", borderRadius: 6, background: "var(--field)", color: "var(--ink)" } })}
          <Btn label="Save" primary onPress={() => { const n = Number(target); if (Number.isFinite(n)) void run("goals.update", { finish: { ...g.finish, target: n } }, "Finish line changed").then(() => setEditing(false)); }} testID="goal-target-save" />
          <Btn label="Cancel" onPress={() => setEditing(false)} />
        </View>
      ) : <Btn label="Change the target" icon="edit" onPress={() => setEditing(true)} testID="goal-target-edit" />) : null}
      <Text style={st.small}>{`Read from ${g.finish.source?.label ?? g.finish.source?.kind ?? "the goal itself"}. Progress comes from the source only, never from what an agent says.`}</Text>
      <Text style={st.label}>Deadline</Text>
      <Text style={st.body}>{whenWords(g.deadline, now, offsetMin)}</Text>
      <Btn label="Extend" onPress={(e) => { const at = pointAt(e); menu.show(extendEntries(g, run), at.x, at.y, "other", { label: "Extend" }); }} />
      <Text style={st.label}>Check-ins</Text>
      <Text style={st.body}>{rhythmWords(g)}</Text>
      <Text style={st.small}>Also wakes when a task finishes, the number moves, or you answer.</Text>
      <Text style={st.label}>Budget</Text>
      <Bar value={b.used} tone={b.warn ? "need" : "plain"} width="100%" testID="goal-budget" />
      <Text testID="goal-budget-text" style={[st.body, b.warn && { color: "var(--warn)" as string }]}>{b.text}</Text>
      <Text style={st.small}>Warns at 80%. Pauses and asks at 100%. Runs on the owner's AI account.</Text>
      <Text style={st.label}>May do without asking</Text>
      {g.permissions.length === 0 ? <Text style={st.small}>Nothing. Every outward act waits on the owner.</Text> : g.permissions.map((p) => <Row key={p.label} id={`gp-${p.label}`} title={p.label} note={p.granted ? "Granted" : "Waiting for the owner's press"} leading={<View style={{ marginRight: 8 }}><Icon name="check" color={p.granted ? "var(--ok)" : "var(--ink-4)"} /></View>} />)}
      <Text style={st.small}>Anything else that leaves the Space waits on you.</Text>
      <Text style={st.label}>People</Text>
      {people.map((p) => <Row key={`${p.role}-${p.id}`} id={`gpp-${p.id}`} title={nameOf(p.id)} trailing={<Text style={st.small}>{p.role}</Text>} leading={<View style={{ marginRight: 8 }}><Avatar {...avatarOf({ id: p.id, name: nameOf(p.id), kind: p.kind === "agent" ? "agent" : "person" })} size={20} /></View>} />)}
    </ScrollView>
  );
}

function Files({ g, call, changes, openFolder, openFile }: { g: Goal; call: Call; changes: Changes | undefined; openFolder?: (id: string) => void; openFile?: (id: string) => void }): ReactElement {
  const [rows, setRows] = useState<Array<{ id: string; name: string; folder: boolean }> | null>(null);
  const load = useCallback((): void => {
    if (!g.folderId) { setRows([]); return; }
    void call("files.list", { folder: g.folderId, limit: 200 }).then((o) => {
      const out = o as { files?: Array<{ fileId: string; name: string }>; folders?: Array<{ folderId: string; name: string }> };
      setRows([...(out.folders ?? []).map((f) => ({ id: f.folderId, name: f.name, folder: true })), ...(out.files ?? []).map((f) => ({ id: f.fileId, name: f.name, folder: false }))]);
    }, () => setRows([]));
  }, [call, g.folderId]);
  useEffect(load, [load]);
  useEffectFollow(changes, load);
  return (
    <ScrollView testID="goal-files" contentContainerStyle={st.pad}>
      <Text style={st.label}>{`Goals / ${g.title}`}</Text>
      {g.folderId && openFolder ? <Btn label="Open the folder" icon="folder" onPress={() => openFolder(g.folderId!)} testID="goal-open-folder" /> : null}
      {rows === null ? null : rows.length === 0 ? <Text style={st.small}>Plans, drafts, research and reports land here.</Text> : rows.map((r) => (
        <Row key={r.id} id={`gf-${r.id}`} title={r.name} leading={<View style={{ marginRight: 8 }}><Icon name={r.folder ? "folder" : "file"} /></View>} onPress={() => (r.folder ? openFolder?.(r.id) : openFile?.(r.id))} />
      ))}
    </ScrollView>
  );
}
function useEffectFollow(changes: Changes | undefined, load: () => void): void {
  useEffect(() => (changes ? changes.subscribe(load) : undefined), [changes, load]);
}

const st = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  loading: { height: 1 },
  row: { flex: 1, minHeight: 0, flexDirection: "row" },
  main: { flex: 1, minWidth: 0 },
  scroll: { paddingBottom: 40 },
  col: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 28, paddingTop: 28, gap: 2 },
  colPhone: { paddingHorizontal: 16, paddingTop: 16 },
  kicker: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  kickerText: { color: "var(--ink-3)" as string, fontSize: 12 },
  h1: { color: "var(--ink)" as string, fontSize: 26, lineHeight: 32, fontWeight: "600", letterSpacing: -0.3 },
  h1Phone: { fontSize: 22, lineHeight: 28 },
  finish: { color: "var(--ink-2)" as string, fontSize: 14, lineHeight: 20, marginTop: 4 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14, marginTop: 12 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { color: "var(--ink-2)" as string, fontSize: 12.5, lineHeight: 18 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 14 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: "var(--line)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  btnText: { color: "var(--ink-2)" as string, fontSize: 12.5 },
  line: { color: "var(--ink-3)" as string, fontSize: 12.5, marginTop: 10 },
  card: { marginTop: 20, padding: 14, borderRadius: 10, backgroundColor: "var(--sunk)" as string, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: "var(--ink)" as string, fontSize: 13.5, fontWeight: "600" },
  cardActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 },
  body: { color: "var(--ink-2)" as string, fontSize: 13, lineHeight: 19 },
  small: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 17 },
  tiny: { color: "var(--ink-4)" as string, fontSize: 11 },
  label: { color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600", marginTop: 16, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 },
  li: { color: "var(--ink-2)" as string, fontSize: 13, lineHeight: 19, paddingLeft: 10 },
  retro: { gap: 2 },
  numberBlock: { marginTop: 22, gap: 8 },
  numRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  big: { color: "var(--ink)" as string, fontSize: 52, lineHeight: 56, fontWeight: "600", letterSpacing: -1.2, fontVariant: ["tabular-nums"] },
  bigPhone: { fontSize: 40, lineHeight: 44 },
  of: { color: "var(--ink-3)" as string, fontSize: 22, fontWeight: "500", fontVariant: ["tabular-nums"] },
  numRight: { alignItems: "flex-end" },
  pct: { color: "var(--ink)" as string, fontSize: 18, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chart: { marginTop: 8 },
  chartLegend: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  list: { marginTop: 6 },
  section: { marginTop: 10 },
  wait: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, gap: 3 },
  waitTitle: { color: "var(--ink)" as string, fontSize: 13.5, lineHeight: 19 },
  planTrail: { flexDirection: "row", alignItems: "center", gap: 8 },
  pad: { padding: 14 },
  day: { marginBottom: 4 },
});
