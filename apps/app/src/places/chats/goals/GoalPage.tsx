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
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { askedCall, goalMenuEntries } from "./goal-menu.ts";
import { TextAsk } from "../menus/TextAsk.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import type { ConversationData } from "../conversation/data.tsx";
import type { Changes } from "../conversation/use-follow.ts";
import { formatActivity } from "../../../../../../lib/words/activity.ts";
import { useGoal } from "./data.ts";
import type { Call } from "./data.ts";
import { Bar, TONE } from "./GoalRow.tsx";
import { ENDED, LIVE, bareLine, budgetOf, byDay, canEdit as mayEdit, chartOf, dueWords, fmt, fractionOf, leftWords, nameList, numberOf, statusOf, taskWord, whenWords } from "./model.ts";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { GoalSettings } from "./GoalSettings.tsx";
import { AddLine, ChecklistEdit, DeadlineEdit, DraftPlanEdit, EditText, HelpersRow, Mini, PeopleDialog, newId } from "./GoalEdit.tsx";
import type { PickEntry } from "../../../../../../ui/src/PeoplePicker/index.tsx";
import { TimePop, When, useZones } from "../../../../../../ui/src/Time/index.tsx";
import { whenIn } from "../../../../../../lib/zones.ts";
import type { Zones } from "../../../../../../ui/src/Time/index.tsx";
import type { Goal, GoalPageData, PlanStep, TaskLine, Tone, WaitLine, Who } from "./model.ts";

export interface GoalPageProps {
  goalId: string;
  call: Call;
  changes: Changes | undefined;
  me: string;
  nameOf(id: string): string;
  clock(): { now: number; offsetMin?: number };
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
  /** The people and agents a lead, owner or helper can be picked from. */
  directory?: readonly PickEntry[];
}

type PaneTab = "activity" | "details" | "files";
const DAY = 86_400_000;

export function GoalPage({ goalId, call, changes, me, nameOf, clock, conversationFor, openTask, openAgent, openFolder, openFile, fill, pane = true, directory }: GoalPageProps): ReactElement {
  const { state, reload } = useGoal(call, changes, goalId);
  const zones = useZones();
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 640;
  const [tab, setTab] = useState<PaneTab>("activity");
  const [paneOpen, setPaneOpen] = useState(pane && !phone && width >= 980);
  const [line, setLine] = useState("");
  const [undo, setUndo] = useState<{ input: Record<string, unknown>; said: string } | null>(null);
  const [picker, setPicker] = useState<"lead" | "owner" | "helpers" | null>(null);
  const menu = useMenu();
  const [asking, setAsking] = useState<"stuck" | "report" | null>(null);
  const data = state.status === "ready" ? state.data : null;
  const g = data?.goal;
  /** One capability call. `back` is the same capability's input that puts the change back: it shows as Undo. A helper the goal chat would not take is said, with the reason, never skipped. */
  const run = useCallback(async (cap: string, input: Record<string, unknown>, done?: string, back?: Record<string, unknown>): Promise<boolean> => {
    setLine(""); setUndo(null);
    try {
      const r = (await call(cap, { goalId, ...input })) as { seated?: Array<{ id: string; inChat: boolean; error?: string }> } | undefined;
      reload();
      const failed = (r?.seated ?? []).filter((x) => !x.inChat);
      const lost = failed.length ? ` ${nameList(failed.map((x) => nameOf(x.id)))} could not join the goal chat${failed[0]?.error ? `: ${failed[0].error}` : ""}` : "";
      if (done || lost) setLine(`${done ?? "Saved."}${lost}`);
      if (back) setUndo({ input: back, said: cap === "goals.update" ? "Put back." : "Undone." });
      return true;
    } catch (e) { setLine(e instanceof Error && e.message ? e.message : "That could not be changed."); return false; }
  }, [call, goalId, reload, nameOf]);
  const takeBack = useCallback(async (): Promise<void> => {
    const u = undo;
    if (!u) return;
    await run("goals.update", u.input, u.said);
  }, [undo, run]);
  useEffect(() => { setLine(""); setUndo(null); }, [goalId]);
  const conv = useMemo(() => (g?.threadId ? conversationFor(g.threadId) : null), [conversationFor, g?.threadId]);

  const entries = useMemo<readonly PickEntry[]>(() => {
    if (directory && directory.length > 0) return directory;
    if (!g) return [];
    const seen = new Map<string, PickEntry>();
    for (const w of [{ kind: "person", id: g.owner }, { kind: "agent", id: g.leadAgentId }, ...g.helpers]) seen.set(w.id, { id: w.id, name: nameOf(w.id), kind: w.kind === "agent" ? "agent" : "person" });
    return [...seen.values()];
  }, [directory, g, nameOf]);
  if (!data || !g) {
    return <View testID="goal-page-loading" style={st.root}>{state.status === "error" ? <States kind="error" message="This goal is not available" cause={state.message} /> : <View style={st.loading} />}</View>;
  }
  const now = clock().now;
  const showPane = (t: PaneTab): void => { setTab(t); setPaneOpen(true); };
  const edit = mayEdit(g, me);
  const saveHelpers = (next: Who[], said: string): void => { void run("goals.update", { helpers: next }, said, { helpers: g.helpers }); };
  const head = (
    <View testID="goal-page-head" style={[st.col, phone && st.colPhone]} {...menuTrigger((x, y) => menu.show(goalMenuEntries(g, me, { run, ask: setAsking }), x, y, "context", { label: g.title }))}>
      <Head g={g} me={me} nameOf={nameOf} now={now} zones={zones} run={run} menu={menu} showPane={showPane} openAgent={openAgent} fill={fill} phone={phone} edit={edit} pick={setPicker} saveHelpers={saveHelpers} />
      {line ? (
        <View style={st.lineRow}>
          <Text testID="goal-line" accessibilityLiveRegion="polite" style={st.lineText}>{line}</Text>
          {undo ? <Mini label="Undo" testID="goal-undo" onPress={() => void takeBack()} /> : null}
        </View>
      ) : null}
      <Notice data={data} now={now} zones={zones} run={run} fill={fill} menu={menu} edit={edit} />
      <NumberBlock data={data} now={now} zones={zones} phone={phone} {...(edit ? { onItems: (items: NonNullable<Goal["finish"]["items"]>) => void run("goals.update", { finish: { ...g.finish, items } }, "Checklist changed.", { finish: g.finish }) } : {})} me={me} />
      <Waiting waits={data.waiting} call={call} nameOf={nameOf} now={now} zones={zones} openTask={openTask} onDone={reload} />
      <Plan data={data} nameOf={nameOf} openTask={openTask} edit={edit}
        onDraft={(plan) => void run("goals.update", { plan }, "Plan changed.", { plan: data.draftPlan ?? [] })}
        onRemove={(taskId) => void call("tasks.withdraw", { taskId, note: "Taken off the goal's plan by the owner." }).then(() => { reload(); setLine("Step removed."); }, (e: unknown) => setLine(e instanceof Error ? e.message : "That could not be changed."))}
        onRename={(taskId, title) => void call("tasks.update", { taskId, title }).then(() => { reload(); setLine("Step renamed."); }, (e: unknown) => setLine(e instanceof Error ? e.message : "That could not be changed."))}
        onAdd={(title) => void run("goals.plan", { children: [{ key: newId("s"), title, why: "Added by the owner", assigned: { kind: "agent", id: g.leadAgentId } }] }, "Step added.")} />
    </View>
  );
  const feed = conv
    ? <Conversation key={g.threadId} compact data={{ ...conv, head, placeholder: ENDED.has(g.status) ? `Ask ${nameOf(g.leadAgentId)} about this goal` : `Message ${nameOf(g.leadAgentId)} about this goal` }} />
    : <ScrollView contentContainerStyle={st.scroll}>{head}</ScrollView>;
  return (
    <View testID="goal-page" style={st.row}>
      <View style={st.main}>{feed}</View>
      {paneOpen && !phone ? (
        <SidePane paneKey="goal-pane" toggle={{ open: true, onPress: () => setPaneOpen(false) }} title="Goal" tabs={[{ key: "activity", title: "Activity" }, { key: "details", title: "Details" }, { key: "files", title: "Files" }]} activeTab={tab} onSelectTab={(k) => setTab(k as PaneTab)} defaultWidth={340}>
          {tab === "activity" ? <Activity data={data} me={me} nameOf={nameOf} now={now} zones={zones} openTask={openTask} /> : tab === "details" ? <GoalSettings g={g} nameOf={nameOf} zones={zones} canEdit={edit} patch={(i, said, back) => void run("goals.update", i, said, back)} pick={setPicker} removeHelper={(id) => saveHelpers(g.helpers.filter((h) => h.id !== id), `${nameOf(id)} is no longer a helper.`)} /> : <Files g={g} call={call} changes={changes} {...(openFolder ? { openFolder } : {})} {...(openFile ? { openFile } : {})} />}
        </SidePane>
      ) : null}
      {menu.element}
      {picker === "lead" ? <PeopleDialog testID="goal-pick-lead" title="Who leads this goal" single entries={entries.filter((e) => e.kind === "agent")} selected={[g.leadAgentId]} onClose={() => setPicker(null)}
        onSave={(ids) => { const id = ids[0]; if (id && id !== g.leadAgentId) void run("goals.update", { leadAgentId: id }, `${nameOf(id)} leads it now.`, { leadAgentId: g.leadAgentId }); }} /> : null}
      {picker === "owner" ? <PeopleDialog testID="goal-pick-owner" title="Who owns this goal" single entries={entries.filter((e) => e.kind === "person")} selected={[g.owner]} onClose={() => setPicker(null)}
        onSave={(ids) => { const id = ids[0]; if (id && id !== g.owner) void run("goals.update", { owner: id }, `${nameOf(id)} owns it now. What you allowed does not carry over.`); }} /> : null}
      {picker === "helpers" ? <PeopleDialog testID="goal-pick-helpers" title="Who helps with this goal" entries={entries.filter((e) => e.id !== g.owner && e.id !== g.leadAgentId)} selected={g.helpers.map((h) => h.id)} onClose={() => setPicker(null)}
        onSave={(ids) => saveHelpers(ids.map((id) => ({ kind: entries.find((e) => e.id === id)?.kind ?? "person", id })), "Helpers changed.")} /> : null}
      {asking ? <TextAsk title={asking === "stuck" ? "Why is this goal stuck?" : "Report progress"} label={asking === "stuck" ? "What is in the way" : "What changed and what is next"} action={asking === "stuck" ? "Mark stuck" : "Report"} multiline onClose={() => setAsking(null)} onDone={(text) => { const c = askedCall(asking, text); setAsking(null); void run(c.cap, c.input, c.done); }} /> : null}
    </View>
  );
}

type Run = (cap: string, input: Record<string, unknown>, done?: string, back?: Record<string, unknown>) => Promise<boolean>;
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

function Head({ g, me, nameOf, now, zones, run, menu, showPane, openAgent, fill, phone, edit, pick, saveHelpers }: { edit: boolean; pick(w: "lead" | "owner" | "helpers"): void; saveHelpers(next: Who[], said: string): void; g: Goal; me: string; nameOf(id: string): string; now: number; zones: Zones; run: Run; menu: Menu; showPane(t: PaneTab): void; openAgent(id: string): void; fill: ((t: string) => void) | undefined; phone: boolean }): ReactElement {
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
      <EditText value={g.title} canEdit={edit} label="the title" testID="goal-title" textStyle={[st.h1, phone && st.h1Phone]} onSave={(title) => void run("goals.update", { title }, "Renamed.", { title: g.title })} />
      <EditText value={bareLine(g.finish.line)} canEdit={edit} label="the finish line" testID="goal-finish" textStyle={st.finish} multiline
        onSave={(line) => void run("goals.update", { finish: { ...g.finish, line } }, "Finish line changed.", { finish: g.finish })} />
      <View style={st.meta}>
        <Text testID="goal-status" style={[st.metaText, { color: TONE[s.tone] as string, fontWeight: s.tone === "plain" ? "400" : "600" }]}>{s.word}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={edit ? "Change the lead" : `Open ${nameOf(g.leadAgentId)}`} testID="goal-lead" onPress={() => (edit ? pick("lead") : openAgent(g.leadAgentId))} style={st.metaItem}>
          <Avatar {...avatarOf({ id: g.leadAgentId, name: nameOf(g.leadAgentId), kind: "agent" })} size={18} /><Text style={st.metaText}>{`${nameOf(g.leadAgentId)} leads`}</Text>
        </Pressable>
        <Pressable accessibilityRole={edit ? "button" : "text"} accessibilityLabel={edit ? "Change the owner" : "Owner"} testID="goal-owner" onPress={edit ? () => pick("owner") : undefined} style={st.metaItem}>
          <Avatar {...avatarOf({ id: g.owner, name: nameOf(g.owner), kind: "person" })} size={18} /><Text style={st.metaText}>{`${g.owner === me ? "You own it" : `${nameOf(g.owner)} owns it`}`}</Text>
        </Pressable>
        {live && g.nextCheckinAt ? <View style={st.metaItem}><Icon name="clock" /><Text style={st.metaText}>Check-in </Text><When at={g.nextCheckinAt} now={now} style={st.metaText} testID="goal-checkin" /></View> : null}
        <DeadlineEdit deadline={g.deadline} zones={zones} canEdit={edit} onSave={(deadline) => void run("goals.update", { deadline }, `Deadline moved to ${dueWords(deadline, zones)}.`, { deadline: g.deadline })}
          shown={<View style={st.metaItem}><Icon name="cal" />{ENDED.has(g.status) ? <Text testID="goal-due" style={st.metaText}>{`Ended ${whenWords(g.endedAt ?? now, now, zones)}`}</Text> : <><Text style={st.metaText}>Due </Text><When at={g.deadline} now={now} as="date" style={st.metaText} testID="goal-due" /></>}</View>} />
      </View>
      <HelpersRow helpers={g.helpers} nameOf={nameOf} canEdit={edit} onAdd={() => pick("helpers")} onRemove={(id) => saveHelpers(g.helpers.filter((h) => h.id !== id), `${nameOf(id)} is no longer a helper.`)} />
      {ENDED.has(g.status) ? null : (
        <View style={st.controls}>
          {g.status === "draft" ? <Btn label="Start goal" primary testID="goal-start" onPress={() => void run("goals.confirm", {}, "Started")} /> : null}
          {live ? <Btn label="Pause" icon="pause" testID="goal-pause" onPress={() => void run("goals.pause", {}, "Paused. Nothing wakes until you resume it.")} /> : null}
          {g.status === "paused" ? <Btn label="Resume" icon="play" testID="goal-resume" onPress={() => void run("goals.resume", {}, "Resumed")} /> : null}
          <Btn label="More" icon="more" testID="goal-more" onPress={more} />
        </View>
      )}
    </View>
  );
}

/** Stuck, the budget, a draft or the end: one notice, above the number, with what you can do about it. */
function Notice({ data, now, zones, run, fill, menu, edit }: { edit: boolean; data: GoalPageData; now: number; zones: Zones; run: Run; fill: ((t: string) => void) | undefined; menu: Menu }): ReactElement | null {
  const g = data.goal;
  const b = budgetOf(g);
  if (g.status === "stuck") {
    return (
      <Card testID="goal-stuck" tone="stuck" icon="warn" title={`Stuck${g.lastCheckinAt ? ` since ${whenWords(g.lastCheckinAt, now, zones)}` : ""}`}>
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
        <Text style={st.body}>{edit ? "Nothing runs until you press Start goal. Click any part of this page to change it." : "Nothing runs until the owner presses Start goal."}</Text>
      </Card>
    );
  }
  if (ENDED.has(g.status)) {
    const missed = g.status === "missed";
    return (
      <Card testID={`goal-ended-${g.status}`} tone={g.status === "done" ? "ok" : "plain"} icon={g.status === "done" ? "check" : "target"} title={g.status === "done" ? `Reached ${whenWords(g.endedAt ?? now, now, zones)}` : missed ? `Missed: ${numberOf(g.progress)} by the deadline` : "Stopped"}>
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
function NumberBlock({ data, now, zones, phone, onItems, me }: { data: GoalPageData; now: number; zones: Zones; phone: boolean; onItems?: (items: NonNullable<Goal["finish"]["items"]>) => void; me: string }): ReactElement {
  const g = data.goal, p = g.progress;
  const you = g.owner === me;
  const src = g.finish.source?.label ?? (g.finish.kind === "checklist" ? (you ? "Done when you tick every item" : "Done when the owner ticks every item") : g.finish.kind === "owner" ? (you ? "Done when you say so" : "Done when the owner says so") : "the source");
  const sub = p.error ? `Can't read ${src}: ${p.error}` : p.readAt ? `${src}, read ${whenWords(p.readAt, now, zones)}` : src;
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
      {g.finish.kind === "checklist" && onItems ? <ChecklistEdit items={g.finish.items ?? []} onChange={onItems} /> : null}
      {g.finish.kind === "checklist" && !onItems ? <View style={st.list}>{(g.finish.items ?? []).map((i) => <Row key={i.id} id={`ci-${i.id}`} title={i.text} leading={<View style={{ marginRight: 8 }}><Icon name={i.done ? "check" : "target"} color={i.done ? "var(--ok)" : "var(--ink-4)"} /></View>} />)}</View> : null}
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
      <View style={st.plotRow}>
      <View style={[st.axis, { height: h }]}>
        {/* ui-rows-lint: not a list (the chart's axis labels) */}
        {c.ticks.map((t) => <Text key={t.value} style={[st.tick, { top: t.y - 7 }]}>{fmt(t.value)}</Text>)}
      </View>
      <View style={{ flex: 1 }}>
      {e("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h, preserveAspectRatio: "none", "aria-hidden": true, style: { display: "block" } },
        ...c.ticks.map((t) => e("line", { key: `tk${t.value}`, x1: 0, x2: w, y1: t.y, y2: t.y, stroke: "var(--line)", strokeOpacity: 0.5 })),
        e("line", { key: "t", x1: 0, x2: w, y1: c.targetY, y2: c.targetY, stroke: "var(--line)", strokeDasharray: "3 4" }),
        e("path", { key: "p", d: c.pace, fill: "none", stroke: "var(--ink-4)", strokeDasharray: "2 4", strokeWidth: 1 }),
        e("line", { key: "d", x1: c.deadlineX, x2: c.deadlineX, y1: 0, y2: h, stroke: "var(--line)" }),
        e("path", { key: "a", d: c.area, fill: "var(--accent-wash)", stroke: "none" }),
        e("path", { key: "l", d: c.line, fill: "none", stroke: "var(--accent)", strokeWidth: 2, strokeLinejoin: "round" }),
      )}
      </View>
      </View>
      <View style={st.chartLegend}><Text style={st.tiny}>Target</Text><Text style={st.tiny}>Dashed: the pace to reach it by the deadline</Text></View>
    </View>
  );
}

/** What waits on whom, with the answer one press away. A press acts on the task itself; the goal hears and goes on. */
function Waiting({ waits, call, nameOf, now, zones, openTask, onDone }: { waits: readonly WaitLine[]; call: Call; nameOf(id: string): string; now: number; zones: Zones; openTask(id: string): void; onDone(): void }): ReactElement | null {
  if (waits.length === 0) return null;
  return (
    <View testID="goal-waiting" style={st.section}>
      <Text style={st.label}>Waiting on</Text>
      {/* ui-rows-lint: not a list (each waiting item is a card with its own answer buttons) */}
      {waits.map((w) => <WaitRow key={w.taskId} w={w} call={call} nameOf={nameOf} now={now} zones={zones} openTask={openTask} onDone={onDone} />)}
    </View>
  );
}

interface TaskActs { state?: string; actions?: Array<{ key: string; label: string; note?: string }>; blocks?: Array<{ type: string; data?: { options?: Array<{ label?: string } | string> } }> }
function WaitRow({ w, call, nameOf, now, zones, openTask, onDone }: { w: WaitLine; call: Call; nameOf(id: string): string; now: number; zones: Zones; openTask(id: string): void; onDone(): void }): ReactElement {
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
    buttons.push(<Btn key="ok" label="Allow" primary onPress={() => act("approve")} testID={`goal-wait-${w.taskId}-approve`} />);
    buttons.push(<Btn key="later" label="Not now" onPress={() => void call("tasks.snooze", { taskId: w.taskId, until: now + DAY }).then(onDone, () => undefined)} testID={`goal-wait-${w.taskId}-later`} />);
  }
  buttons.push(<Btn key="open" label="Open" onPress={() => openTask(w.taskId)} testID={`goal-wait-${w.taskId}-open`} />);
  return (
    <View testID={`goal-wait-${w.taskId}`} style={st.wait}>
      <Text style={st.waitTitle}>{w.title}</Text>
      <Text style={st.small}>{`${who} · since ${whenIn(w.since, now, zones).text}`}</Text>
      {said ? <Text style={[st.small, { color: "var(--ok)" as string }]}>{said}</Text> : <View style={st.cardActions}>{buttons}</View>}
    </View>
  );
}

function Plan({ data, nameOf, openTask, edit, onDraft, onRemove, onAdd, onRename }: {
  data: GoalPageData; nameOf(id: string): string; openTask(id: string): void; edit: boolean; onDraft(next: PlanStep[]): void; onRemove(taskId: string): void; onAdd(title: string): void; onRename(taskId: string, title: string): void;
}): ReactElement {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const finish = (t: TaskLine, save: boolean): void => { setRenaming(null); const next = name.trim(); if (save && next !== "" && next !== t.title) onRename(t.taskId, next); };
  const g = data.goal, tasks = data.tasks;
  if (g.status === "draft") {
    const steps = data.draftPlan ?? [];
    return (
      <View testID="goal-plan" style={st.section}>
        <Text style={st.label}>{steps.length ? `Plan · ${steps.length} step${steps.length === 1 ? "" : "s"}` : "Plan"}</Text>
        <DraftPlanEdit steps={steps} leadAgentId={g.leadAgentId} canEdit={edit} nameOf={nameOf} onChange={onDraft} />
      </View>
    );
  }
  const done = tasks.filter((t) => t.state === "done").length;
  return (
    <View testID="goal-plan" style={st.section}>
      <Text style={st.label}>{tasks.length ? `Plan · ${done} of ${tasks.length} done` : "Plan"}</Text>
      {tasks.length === 0 ? <Text style={st.small}>{edit ? `No steps yet. ${nameOf(g.leadAgentId)} researches first, then plans here. You can add a step now.` : `${nameOf(g.leadAgentId)} researches first, then plans here.`}</Text> : null}
      {tasks.map((t) => {
        const s = taskWord(t.state, t.blocked);
        if (renaming === t.taskId) {
          return <TextField key={t.taskId} testID={`goal-task-name-${t.taskId}`} accessibilityLabel="Step name" autoFocus value={name} onChangeText={setName} onBlur={() => finish(t, true)} onSubmitEditing={() => finish(t, true)}
            onKeyPress={(e: { nativeEvent: { key: string } }) => { if (e.nativeEvent.key === "Escape") finish(t, false); }} />;
        }
        return <Row key={t.taskId} id={`gt-${t.taskId}`} title={t.title} titleSuffix={t.key ?? ""} onPress={() => openTask(t.taskId)}
          leading={<View style={{ marginRight: 8 }}><Icon name={t.state === "done" ? "check" : "target"} color={t.state === "done" ? "var(--ok)" : "var(--ink-4)"} /></View>}
          trailing={<View style={st.planTrail}><Text style={[st.small, { color: TONE[s.tone] as string }]}>{s.word}</Text>{t.assigned ? <Avatar {...avatarOf({ id: t.assigned.id, name: nameOf(t.assigned.id), kind: t.assigned.kind === "agent" ? "agent" : "person" })} size={18} /> : null}
            {edit && t.state !== "done" && t.state !== "canceled" ? <Mini label="Rename" testID={`goal-task-rename-${t.taskId}`} onPress={() => { setName(t.title); setRenaming(t.taskId); }} /> : null}
            {edit && t.state !== "done" && t.state !== "canceled" ? <Mini label="Remove" testID={`goal-task-remove-${t.taskId}`} onPress={() => onRemove(t.taskId)} /> : null}</View>} />;
      })}
      {edit && g.status !== "done" ? <AddLine label="a new step" placeholder="Add a step" testID="goal-step-new" onAdd={onAdd} /> : null}
    </View>
  );
}

export function Activity({ data, me, nameOf, now, zones, openTask }: { data: GoalPageData; me: string; nameOf(id: string): string; now: number; zones: Zones; openTask(id: string): void }): ReactElement {
  const viewer = { me, nameOf, offsetMin: 0, zone: zones.space };
  const days = byDay(data.activity, now, zones);
  if (days.length === 0) return <Text style={[st.small, st.pad]}>Nothing yet.</Text>;
  return (
    <ScrollView testID="goal-activity" contentContainerStyle={st.pad}>
      {/* ui-rows-lint: not a list (a day heading over its rows, which are ui/Row) */}
      {days.map((d) => (
        <View key={d.day} style={st.day}>
          <Text style={st.label}>{d.day}</Text>
          {/* ui-rows-lint: not a list (each item is a ui/Row; the TimePop around it only adds the hover card with both zones) */}
          {d.items.map((a) => {
            const line = formatActivity(a, viewer);
            // a list of times: each reads in the Space zone only; yours is on hover, so the list stays quiet
            return (
              <TimePop key={`${a.at}-${a.kind}-${a.text.slice(0, 24)}`} at={a.at}>
                <Row id={`ga-${a.at}`} title={line.text} note={`${whenIn(a.at, now, zones).text}${line.credit ? ` · ${line.credit}` : ""}`}
                  {...(a.ref?.startsWith("tsk_") ? { onPress: () => openTask(a.ref!) } : {})} />
              </TimePop>
            );
          })}
        </View>
      ))}
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
  lineRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  lineText: { color: "var(--ink-3)" as string, fontSize: 12.5, flexShrink: 1 },
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
  plotRow: { flexDirection: "row" },
  axis: { width: 30, position: "relative" },
  tick: { position: "absolute", right: 6, color: "var(--ink-4)" as string, fontSize: 10, lineHeight: 14, fontVariant: ["tabular-nums"] },
  chartLegend: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  list: { marginTop: 6 },
  section: { marginTop: 10 },
  wait: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, gap: 3 },
  waitTitle: { color: "var(--ink)" as string, fontSize: 13.5, lineHeight: 19 },
  planTrail: { flexDirection: "row", alignItems: "center", gap: 8 },
  pad: { padding: 14 },
  day: { marginBottom: 4 },
});
