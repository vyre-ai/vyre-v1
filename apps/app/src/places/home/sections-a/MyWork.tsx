// Home > My work: every task assigned to me or waiting on me as reviewer or approver, grouped Overdue, Today, This week, Later, then "Assigned by you".
// The circle completes a task, a face assigns it (people, agents, groups, roles), double-click or Enter opens it. Data: tasks.my_work (screen tasks.my-work), live from the kept copy.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Plan } from "../../../../../../ui/src/Plan/index.tsx";
import type { PlanTask, PlanWho } from "../../../../../../ui/src/Plan/types.ts";
import { toIso } from "../../../../../../ui/src/Plan/logic.ts";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useActions } from "./actions.ts";
import { useHomeData, usePrincipals, useScreenQuery, useSelection } from "./data.tsx";
import type { Principal } from "./data.tsx";
import { ASSIGN_GROUPS, MY_WORK_LIMIT, STATE_LABEL, dayNumber, dueCount, dueLabel, givenSub, orderMyWork, seatLabel, statusIcon, workGroups } from "./model.ts";
import type { Ref, Task } from "./model.ts";
import { planEdits, planStages, planTasks } from "./plan.ts";
import type { PlanContext } from "./plan.ts";
import { EmptyLine, Face, Glyph, HRow, LinkButton, SectionHeader, Section, Skeleton, StatusCircle, s, useNarrow } from "./parts.tsx";

export const WORK_SCREEN = "tasks.my-work";
type Out = CapMap["tasks.my_work"]["out"];

const same = (a: Ref | undefined, b: Ref): boolean => a !== undefined && a.kind === b.kind && a.id === b.id;

/** The face menu: People, Agents, Groups, Roles, the current one checked, and "No one". */
export function assignMenu(candidates: readonly Principal[], current: Ref | undefined, pick: (to: Ref | null) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const g of ASSIGN_GROUPS) {
    const here = candidates.filter((c) => c.kind === g.kind);
    if (!here.length) continue;
    if (out.length) out.push({ separator: true });
    out.push({ head: g.head });
    for (const c of here) out.push({ label: c.name, checked: same(current, { kind: c.kind, id: c.id }), onSelect: () => pick({ kind: c.kind, id: c.id }) });
  }
  if (out.length) out.push({ separator: true });
  out.push({ label: "No one", checked: current === undefined, onSelect: () => pick(null) });
  return out;
}

function AssigneeFace({ task, onOpen }: { task: Task; onOpen: (x: number, y: number) => void }): ReactElement {
  const { name, kindOf } = usePrincipals();
  const [over, setOver] = useState(false);
  const label = `${task.assigned ? name(task.assigned.id) : "No one"}, change who is assigned`;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} testID={`assign-${task.id}`}
      onPress={(e) => {
        const box = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
        onOpen(box?.left ?? 0, box?.bottom ?? 0);
      }}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[local.face, over && local.faceOver]}
    >
      {task.assigned ? <Face name={name(task.assigned.id)} kind={kindOf(task.assigned)} size={20} /> : <View style={local.noOne} />}
    </Pressable>
  );
}

function Circle({ task, onDone }: { task: Task; onDone: () => void }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`Mark done: ${task.title}`} testID={`done-${task.id}`}
      onPress={onDone} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[local.chk, over && local.chkOver]}
    >
      <StatusCircle status={statusIcon(task)} hovered={over} />
    </Pressable>
  );
}

function LayoutButton({ kind, on, onPress }: { kind: "list" | "plan"; on: boolean; onPress: () => void }): ReactElement {
  return (
    <Pressable role="radio" aria-checked={on} aria-label={kind === "list" ? "List" : "Plan"} testID={`work-view-${kind}`} onPress={onPress} style={[local.segBtn, on && local.segOn]}>
      <Glyph name={kind === "list" ? "list" : "timeline"} size={14} color={on ? "var(--ink)" : "var(--ink-3)"} />
    </Pressable>
  );
}

function NewTask({ onCreate, onCancel }: { onCreate: (title: string) => void; onCancel: () => void }): ReactElement {
  const [title, setTitle] = useState("");
  return (
    <View style={local.newRow} testID="new-task">
      <StatusCircle status="todo" />
      <TextInput
        autoFocus accessibilityLabel="New task title" placeholder="What needs doing?" placeholderTextColor="var(--ink-4)" value={title} onChangeText={setTitle}
        onSubmitEditing={() => { const t = title.trim(); if (t) onCreate(t); else onCancel(); }}
        onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") onCancel(); }}
        onBlur={() => { if (!title.trim()) onCancel(); }}
        style={local.input}
      />
    </View>
  );
}

export function MyWork(): ReactElement {
  const data = useHomeData();
  const p = usePrincipals();
  const sel = useSelection();
  const actions = useActions();
  const narrow = useNarrow();
  const menu = useMenu();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<"list" | "plan">("list");
  const open = useScreenQuery<Out>(WORK_SCREEN, "list", { section: "open" });
  const given = useScreenQuery<Out>(WORK_SCREEN, "list", { section: "assigned_by_me" });
  const clock = data.clock();
  const tasks = open.status === "ready" ? open.data.tasks : [];
  const groups = workGroups(tasks, clock);
  const givenTasks = given.status === "ready" ? orderMyWork(given.data.tasks) : [];
  const keys: string[] = [];
  for (const g of groups) for (const t of g.rows) keys.push(`work:${t.id}`);
  for (const t of givenTasks) keys.push(`given:${t.id}`);
  const keyList = keys.join("|");
  useEffect(() => { sel.register(1, keyList ? keyList.split("|") : []); }, [keyList]);

  const complete = (t: Task): void => void actions.complete(t);
  const assign = (t: Task, to: Ref | null): void => void actions.assign(t, to);
  const openAssign = (t: Task, x: number, y: number): void => menu.show(assignMenu(p.list, t.assigned, (to) => assign(t, to)), x, y, "other", { label: "Assign" });
  const openTask = (t: Task) => (): void => data.nav.openTask(t.id);
  const taskMenu = (t: Task, x: number, y: number): void => {
    const entries: MenuEntry[] = [{ label: "Open", onSelect: openTask(t) }];
    if (t.state !== "done") entries.push({ label: "Mark done", onSelect: () => complete(t) });
    entries.push({ label: "Assign to...", onSelect: () => openAssign(t, x, y) });
    menu.show(entries, x, y, "context", { label: t.title });
  };

  const today = dayNumber(clock.now, clock.offsetMin);
  const row = (t: Task, key: string, givenRow: boolean): ReactElement => {
    const seat = seatLabel(t, data.me.id);
    const late = t.due !== undefined && dayNumber(t.due, clock.offsetMin) < today && !givenRow;
    const chip = t.recordId ? data.recordTitle(t.recordId) ?? "Project" : "Personal";
    const sub = givenRow ? givenSub(t, p.name, p.kindOf) : "";
    return (
      <HRow key={key} rowKey={key} label={t.title} onOpen={openTask(t)} onMenu={(x, y) => taskMenu(t, x, y)}>
        <Circle task={t} onDone={() => complete(t)} />
        <View style={s.text}>
          <Text numberOfLines={1} style={s.title}>
            {t.title}
            {seat ? <Text style={local.rl}>{`  ${seat}`}</Text> : null}
            {t.blocked ? <Text style={[local.rl, { color: "var(--warn)" as string }]}>{"  Blocked"}</Text> : null}
          </Text>
          {sub ? <Text numberOfLines={1} style={s.sub}>{sub}</Text> : null}
        </View>
        {narrow ? null : (
          <View style={local.chip}>
            <Glyph name={t.recordId ? "project" : "person"} size={13} />
            <Text numberOfLines={1} style={local.chipText}>{chip}</Text>
          </View>
        )}
        <AssigneeFace task={t} onOpen={(x, y) => openAssign(t, x, y)} />
        {givenRow ? <Text style={local.state}>{STATE_LABEL[t.state]}</Text> : null}
        {t.due !== undefined ? <Text style={[local.due, late && { color: "var(--danger)" as string }]}>{dueLabel(t.due, clock)}</Text> : <View style={local.due} />}
      </HRow>
    );
  };

  const body: ReactElement[] = [];
  for (const g of groups) {
    const head = (
      <View key={`g-${g.name}`} style={[local.group]} testID={`group-${g.name}`}>
        <Text style={[local.groupText, g.name === "Overdue" && { color: "var(--danger)" as string }]}>{g.name}<Text style={local.groupCount}>{`  ${g.total}`}</Text></Text>
      </View>
    );
    const rows: ReactElement[] = [];
    for (const t of g.rows) rows.push(row(t, `work:${t.id}`, false));
    body.push(head, ...rows);
  }
  if (givenTasks.length) {
    const head = <View key="g-given" style={local.group} testID="group-given"><Text style={local.groupText}>Assigned by you<Text style={local.groupCount}>{`  ${givenTasks.length}`}</Text></Text></View>;
    const rows: ReactElement[] = [];
    for (const t of givenTasks) rows.push(row(t, `given:${t.id}`, true));
    body.push(head, ...rows);
  }

  // Plan mode: the same open tasks on the shared timeline; a change on it is written back as a reschedule, a state change or a reassignment
  const planCtx: PlanContext = { clock, recordTitle: (id) => data.recordTitle(id), name: p.name, kindOf: p.kindOf };
  const planTaskList = planTasks(tasks, planCtx);
  const planStageList = planStages(tasks, planCtx);
  const planToday = toIso(dayNumber(clock.now, clock.offsetMin));
  const planPeople: PlanWho[] = [];
  for (const x of p.list) planPeople.push({ name: x.name, kind: x.kind === "agent" ? "agent" : x.kind === "group" ? "group" : x.kind === "role" ? "role" : "person" });
  const onPlanChange = (next: readonly PlanTask[]): void => {
    for (const e of planEdits(planTaskList, next, tasks, planCtx, p.list)) {
      const t = tasks.find((x) => x.id === e.id);
      if (!t) continue;
      if (e.kind === "reschedule") void actions.reschedule(t, e.due, e.effort);
      else if (e.kind === "state") void actions.transition(t, e.to);
      else void actions.assign(t, e.to);
    }
  };
  const loading = open.status === "loading";
  const total = open.status === "ready" ? open.data.counts.open : 0;
  const dueN = dueCount(tasks, clock);
  return (
    <Section id="s-work">
      <SectionHeader id="work" title="My work" count={open.status === "ready" ? `${total} · ${dueN} due` : undefined}>
        {total > MY_WORK_LIMIT ? <LinkButton label={`All ${total} in My work`} onPress={() => data.nav.openMyWork()} testID="work-all" /> : null}
        <LinkButton label="+ New task" onPress={() => setAdding(true)} testID="work-new" />
        <View style={local.seg} accessibilityRole="radiogroup" accessibilityLabel="My work layout">
          <LayoutButton kind="list" on={view === "list"} onPress={() => setView("list")} />
          <LayoutButton kind="plan" on={view === "plan"} onPress={() => setView("plan")} />
        </View>
      </SectionHeader>
      {adding ? (
        <NewTask
          onCancel={() => setAdding(false)}
          onCreate={(title) => { setAdding(false); void actions.createTask(title); }}
        />
      ) : null}
      {loading ? <Skeleton rows={4} id="work" /> : body.length ? view === "plan" ? <View style={local.plan} testID="work-plan"><Plan today={planToday} stages={planStageList} tasks={planTaskList} people={planPeople} height={340} view="timeline" canAdd={false} canDelete={false} onChange={onPlanChange} onOpenTask={(t) => data.nav.openTask(t.id)} /></View> : <View accessibilityRole="list">{body}</View> : adding ? null : <EmptyLine id="work" text="No tasks yet" />}
      {menu.element}
    </Section>
  );
}

const local = StyleSheet.create({
  rl: { marginLeft: 8, fontSize: 11.5, color: "var(--ink-3)" as string, fontWeight: "500" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 220 },
  chipText: { color: "var(--ink-3)" as string, fontSize: 12.5, flexShrink: 1 },
  due: { minWidth: 64, textAlign: "right", color: "var(--ink-2)" as string, fontSize: 12.5 },
  state: { minWidth: 56, textAlign: "right", fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  seg: { flexDirection: "row", borderRadius: 7, padding: 2, backgroundColor: "var(--sunk)" as string, marginLeft: 6 },
  segBtn: { width: 26, height: 22, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string },
  plan: { marginTop: 8 },
  group: { flexDirection: "row", alignItems: "center", marginTop: 12, height: 26 },
  groupText: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  groupCount: { fontWeight: "500" },
  chk: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center", marginLeft: -3 },
  chkOver: { backgroundColor: "var(--hover)" as string },
  face: { width: 26, height: 26, borderRadius: 99, alignItems: "center", justifyContent: "center", marginHorizontal: -3 },
  faceOver: { backgroundColor: "var(--hover)" as string },
  noOne: { width: 20, height: 20, borderRadius: 99, borderWidth: 1.5, borderStyle: "dashed", borderColor: "var(--ink-4)" as string },
  newRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, marginHorizontal: -10, paddingHorizontal: 10 },
  input: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "500", color: "var(--ink)" as string, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, backgroundColor: "var(--win)" as string, borderWidth: 1.5, borderColor: "var(--accent)" as string },
});
