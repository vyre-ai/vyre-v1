// The Journey designer (spec 2.12, 3.7): a Journey type is a record type whose records move through stages. This is the page for one: where the records are now (a bar across the stages),
// then each stage with its tasks (Assigned, Reviewer, Approver and when each is due) and the Automations that run when a record enters it, then the Journey's settings. Every list is the
// shared Row with its leading and trailing slots. Every edit saves as it is made through journeys.design (quiet Saved, Undo). People without the Design Journeys role see it read-only.
import { useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { Face, IconButton, SubTabs, TextButton, pointer, webOnly } from "../canvas/parts.tsx";
import type { KeyEventLike } from "../canvas/parts.tsx";
import { each } from "../runs/each.ts";
import { useConfigExtras } from "../config/data.tsx";
import { Glyph } from "../config/glyphs.tsx";
import { useJourney, useDesign } from "./data.ts";
import { JourneySettings } from "./JourneySettings.tsx";
import { SLOTS, initials, addAutomation, addStage, addTask, canDeleteStage, countOf, dueWords, moveStage, moveTask, plural, removeAutomation, removeStage, removeTask, totalOver, totalRecords, updateTask } from "./model.ts";
import type { Journey, Ref, Stage, StageCounts, Task } from "./model.ts";

export interface Selection { stage: string; task?: string }
export type DesignerTab = "stages" | "settings";

export interface JourneyDesignerProps {
  journeyId: string;
  selection?: Selection | null;
  onSelect?(s: Selection | null): void;
  initialTab?: DesignerTab;
  /** False when the person lacks the Design Journeys role: the page shows, nothing edits. */
  canDesign?: boolean;
  /** Stages that start folded. */
  initialFolded?: readonly string[];
  /** The shared Ask control, supplied by the shell. */
  ask?: ReactNode;
}

export function JourneyDesigner({ journeyId, selection, onSelect, initialTab = "stages", canDesign = true, initialFolded = [], ask }: JourneyDesignerProps): ReactElement {
  const st = useJourney(journeyId);
  const [tab, setTab] = useState<DesignerTab>(initialTab);
  const [inner, setInner] = useState<Selection | null>(null);
  const sel = selection === undefined ? inner : selection;
  const choose = (s: Selection | null): void => { if (selection === undefined) setInner(s); onSelect?.(s); };
  if (st.phase === "loading") return <View testID="journey-loading" style={s.frame}><View style={s.skHead} /><View style={s.skBody} /></View>;
  if (st.phase === "gone" || !st.journey) return <View testID="journey-gone" style={s.frame}><Text style={s.gone}>This Journey is not available</Text></View>;
  return <Body journey={st.journey} counts={st.counts} versions={st.versions} tab={tab} setTab={setTab} sel={sel} choose={choose} canDesign={canDesign} initialFolded={initialFolded} ask={ask} />;
}

function Body({ journey: j, counts, versions, tab, setTab, sel, choose, canDesign, initialFolded, ask }: {
  journey: Journey; counts: StageCounts; versions: { versionId: string; n: number }[]; tab: DesignerTab; setTab(t: DesignerTab): void; sel: Selection | null; choose(s: Selection | null): void; canDesign: boolean; initialFolded: readonly string[]; ask: ReactNode;
}): ReactElement {
  const data = useAutomationsData();
  const extras = useConfigExtras();
  const d = useDesign(j);
  const { element, show } = useMenu();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set(initialFolded));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const total = totalRecords(counts), over = totalOver(counts);
  const stages = useMemo(() => [...j.stages].sort((a, b) => a.order - b.order), [j.stages]);
  const me: Ref = { kind: "person", id: data.me.id };

  const fold = (key: string): void => setFolded((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const edit = (next: Stage[], text: string): void => { void d.design(next, text); };
  const note = d.saved.note;

  const stageMenu = (g: Stage, i: number, x: number, y: number): void => {
    const items: MenuEntry[] = [{ label: "Open", onSelect: () => choose({ stage: g.key }) }];
    if (canDesign) {
      items.push({ separator: true });
      if (i > 0) items.push({ label: "Move Up", onSelect: () => edit(moveStage(stages, g.key, i - 1), `Moved ${g.title} up`) });
      if (i < stages.length - 1) items.push({ label: "Move Down", onSelect: () => edit(moveStage(stages, g.key, i + 1), `Moved ${g.title} down`) });
      items.push({ separator: true }, { label: "Delete Stage", danger: true, onSelect: () => setConfirmDelete(g.key) });
    }
    show(items, x, y, "context", { label: g.title });
  };
  const taskMenu = (g: Stage, t: Task, x: number, y: number): void => {
    const items: MenuEntry[] = [{ label: "Open", onSelect: () => choose({ stage: g.key, task: t.key }) }];
    if (canDesign) {
      items.push(
        { separator: true },
        { label: t.required ? "Make Optional" : "Make Required", onSelect: () => edit(updateTask(stages, g.key, t.key, { required: !t.required }), `${t.title} is ${t.required ? "optional" : "required"}`) },
        { label: "Move Up", onSelect: () => edit(moveTask(stages, g.key, t.key, -1), "Moved the task up") },
        { label: "Move Down", onSelect: () => edit(moveTask(stages, g.key, t.key, 1), "Moved the task down") },
        { separator: true },
        { label: "Delete Task", danger: true, onSelect: () => { edit(removeTask(stages, g.key, t.key), `Deleted ${t.title}`); if (sel?.task === t.key) choose({ stage: g.key }); } },
      );
    }
    show(items, x, y, "context", { label: t.title });
  };
  const automationMenu = (g: Stage, id: string, x: number, y: number): void => {
    show([
      { label: "Open the Automation", onSelect: () => (extras.openAutomation ?? data.nav.openAutomation)(id) },
      ...(canDesign ? [{ separator: true } as MenuEntry, { label: "Remove from This Stage", danger: true, onSelect: () => edit(removeAutomation(stages, g.key, id), `${data.name(id)} no longer runs on ${g.title}`) } as MenuEntry] : []),
    ], x, y, "context", { label: data.name(id) });
  };
  const addAutomationMenu = (g: Stage, x: number, y: number): void => {
    const rows = extras.directory.automations;
    show(rows.length ? each(rows.filter((a) => !g.automations.includes(a.id)), (a) => ({ label: a.name, onSelect: () => edit(addAutomation(stages, g.key, a.id), `${a.name} runs when a record enters ${g.title}`) })) : [{ head: "No Automations to add" }], x, y, "other", { label: "Add an Automation" });
  };

  const stageBlocks = each(stages, (g, i) => {
    const c = countOf(counts, g.key), closed = folded.has(g.key), isSel = sel?.stage === g.key && !sel.task;
    return (
      <View key={g.key} testID={`stage-${g.key}`} accessibilityLabel={`Stage ${i + 1}, ${g.title}`} style={[s.stage, isSel && s.stageSel]} {...menuTrigger((x, y) => stageMenu(g, i, x, y))}>
        <View {...webOnly({ dataSet: { row: `stage:${g.key}` } })}>
          <Row
            id={`stage-${g.key}`} title={g.title} selected={isSel} onPress={() => choose({ stage: g.key })}
            leading={<View style={s.lead}><Glyph name="grip" size={13} color={canDesign ? "var(--ink-4)" : "transparent"} /><View style={s.no}><Text style={s.noText}>{String(i + 1)}</Text></View></View>}
            trailing={
              <View style={s.tr}>
                <Text testID={`stage-count-${g.key}`} style={s.count}>{plural(c.count, "record")}</Text>
                {c.over ? <View style={s.late}><View style={s.lateDot} /><Text style={s.lateText}>{`${c.over} late`}</Text></View> : null}
                <IconButton icon="more" label={`More for ${g.title}`} size={22} testID={`stage-more-${g.key}`} onPress={(e) => { const p = pointOf(e); stageMenu(g, i, p.x, p.y); }} />
                <IconButton icon={closed ? "chevR" : "chevD"} label={closed ? `Open ${g.title}` : `Fold ${g.title}`} size={22} testID={`fold-${g.key}`} onPress={() => fold(g.key)} />
              </View>
            }
          />
        </View>
        {confirmDelete === g.key ? (
          <View testID={`confirm-delete-${g.key}`} style={s.confirm}>
            {canDeleteStage(counts, g.key) ? (
              <>
                <Text style={s.confirmText}>{`Delete ${g.title}?`}</Text>
                <TextButton label="Delete" testID={`delete-stage-${g.key}`} onPress={() => { setConfirmDelete(null); edit(removeStage(stages, g.key), `Deleted ${g.title}`); if (sel?.stage === g.key) choose(null); }} />
              </>
            ) : <Text style={s.confirmText}>{`${plural(c.count, "record")} ${c.count === 1 ? "is" : "are"} in ${g.title}. Move them on first, then delete it.`}</Text>}
            <TextButton label="Cancel" testID={`cancel-delete-${g.key}`} onPress={() => setConfirmDelete(null)} />
          </View>
        ) : null}
        {closed ? null : (
          <View style={s.stageBody}>
            <Text accessibilityRole="header" style={s.sl}>Tasks</Text>
            {each(g.tasks, (t) => <TaskRow key={t.key} g={g} t={t} selected={sel?.task === t.key} onOpen={() => choose({ stage: g.key, task: t.key })} onMenu={(x, y) => taskMenu(g, t, x, y)} name={data.name} />)}
            {canDesign ? <AddLine label="Add a task" testID={`add-task-${g.key}`} onPress={() => { const next = addTask(stages, g.key, "New task", me); edit(next, "Added a task"); const k = next.find((x) => x.key === g.key)?.tasks.slice(-1)[0]?.key; if (k) choose({ stage: g.key, task: k }); }} /> : g.tasks.length === 0 ? <Text style={s.none}>None</Text> : null}
            <Text accessibilityRole="header" style={s.sl}>On entering</Text>
            {each(g.automations, (id) => (
              <View key={id} {...menuTrigger((x, y) => automationMenu(g, id, x, y))} {...webOnly({ dataSet: { row: `auto:${g.key}:${id}` } })}>
                <Row
                  id={`auto-${g.key}-${id}`} title={data.name(id)} onPress={() => (extras.openAutomation ?? data.nav.openAutomation)(id)}
                  leading={<View style={s.autoMark}><Glyph name="bolt" size={13} color="var(--accent)" /></View>}
                  trailing={canDesign ? <IconButton icon="more" label={`More for ${data.name(id)}`} size={22} onPress={(e) => { const p = pointOf(e); automationMenu(g, id, p.x, p.y); }} /> : undefined}
                />
              </View>
            ))}
            {canDesign ? <AddLine label="Add an automation" testID={`add-auto-${g.key}`} onPress={(x, y) => addAutomationMenu(g, x, y)} /> : g.automations.length === 0 ? <Text style={s.none}>None</Text> : null}
          </View>
        )}
      </View>
    );
  });

  const funnel = (
    <View testID="funnel">
      <Text accessibilityRole="header" style={s.lab}>Where the records are now</Text>
      <View accessibilityRole="none" accessibilityLabel="Records per stage" style={s.fbar}>
        {each(stages, (g) => { const c = countOf(counts, g.key); return (
          <Pressable key={g.key} accessibilityRole="button" accessibilityLabel={`${g.title}: ${plural(c.count, "record")}`} testID={`funnel-${g.key}`} onPress={() => choose({ stage: g.key })} {...webOnly({ title: `${g.title}: ${plural(c.count, "record")}` })} style={[s.fseg, { flexGrow: Math.max(c.count, 0.25), opacity: c.count ? 1 : 0.25 }, pointer]} />
        ); })}
      </View>
      <View style={s.fcount}>
        {each(stages, (g) => <View key={g.key} style={{ flexGrow: Math.max(countOf(counts, g.key).count, 0.25), flexBasis: 0, minWidth: 0 }}><Text style={s.fn}><Text style={s.fb}>{String(countOf(counts, g.key).count)}</Text>{` ${g.title}`}</Text></View>)}
      </View>
    </View>
  );

  const onKey = (e: KeyEventLike): void => {
    if (!canDesign || !sel || !(e.altKey || e.metaKey)) return;
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!dir) return;
    e.preventDefault?.();
    if (sel.task) edit(moveTask(stages, sel.stage, sel.task, dir), "Moved the task");
    else { const i = stages.findIndex((x) => x.key === sel.stage); if (i >= 0) edit(moveStage(stages, sel.stage, i + dir), "Moved the stage"); }
  };

  return (
    <View testID="journey-designer" accessibilityLabel={`${j.name}, Journey`} style={s.frame} {...webOnly({ onKeyDown: onKey })}>
      <View style={s.head}>
        <View aria-hidden style={s.tile}><Text style={s.tileText}>{initials(j.name)}</Text></View>
        <Text accessibilityRole="header" numberOfLines={1} style={s.title}>{j.name}</Text>
        <Text numberOfLines={1} style={s.meta}>{plural(total, "record")}{over ? `  ·  ${over} late` : ""}</Text>
        <View style={{ flex: 1 }} />
        {canDesign ? null : <View testID="view-only" style={s.viewOnly}><Glyph name="lock" size={13} color="var(--ink-3)" /><Text style={s.viewOnlyText}>View only</Text><Text style={s.viewOnlyDim}>needs the Design Journeys role</Text></View>}
        <TextButton label="Open records in Records" icon="records" primary testID="open-records" onPress={() => extras.openRecords?.(j.recordType)} />
        {ask}
      </View>
      <SubTabs label="Journey" active={tab} onSelect={(k) => setTab(k as DesignerTab)} tabs={[{ key: "stages", label: "Stages", note: String(stages.length) }, ...(canDesign ? [{ key: "settings", label: "Settings" }] : [])]} />
      <ScrollView style={s.scroll} contentContainerStyle={s.col} keyboardShouldPersistTaps="handled">
        {tab === "settings" && canDesign ? <JourneySettings journey={j} versions={versions} design={d} /> : (
          <>
            {funnel}
            <View style={s.stagesHead}>
              <Text accessibilityRole="header" style={s.lab}>Stages</Text>
              <Text style={s.labDim}>{`${canDesign ? "Move with the menu or Option and the arrows. " : ""}A record moves on when every required task is done.`}</Text>
              <View style={{ flex: 1 }} />
              {canDesign ? <TextButton label="Add a stage" icon="plus" testID="add-stage" onPress={() => { const next = addStage(stages, "New stage"); edit(next, "Added a stage"); const k = next[next.length - 1]?.key; if (k) choose({ stage: k }); }} /> : null}
            </View>
            {stageBlocks}
          </>
        )}
      </ScrollView>
      {note ? (
        <View testID="saved-note" accessibilityLiveRegion="polite" style={s.saved}>
          <Text style={[s.savedText, note.failed && { color: "var(--danger)" as string }]}>{note.text}</Text>
          {note.undo ? <Text accessibilityRole="button" testID="saved-undo" onPress={note.undo} style={s.undo}>Undo</Text> : null}
        </View>
      ) : null}
      {element}
    </View>
  );
}

function TaskRow({ g, t, selected, onOpen, onMenu, name }: { g: Stage; t: Task; selected: boolean; onOpen(): void; onMenu(x: number, y: number): void; name(id: string): string }): ReactElement {
  const seats = SLOTS.flatMap(({ key }) => (t[key] ? [t[key] as Ref] : []));
  return (
    <View {...menuTrigger((x, y) => onMenu(x, y))} {...webOnly({ dataSet: { row: `task:${g.key}:${t.key}` } })}>
      <Row
        id={`task-${t.key}`} title={t.title} selected={selected} onPress={onOpen}
        leading={<View accessibilityLabel={t.required ? "Required" : "Optional"} style={[s.check, !t.required && s.checkOpt]} {...webOnly({ title: t.required ? "Required" : "Optional" })} />}
        trailing={
          <View style={s.tr}>
            <View style={s.seats} testID={`seats-${t.key}`}>
              {each(seats, (r, i) => (
                <View key={`${r.kind}:${r.id}:${i}`} style={s.seat}>
                  {i > 0 ? <Glyph name="arrow" size={11} color="var(--ink-4)" /> : null}
                  <Face name={name(r.id)} kind={r.kind === "person" ? "person" : "agent"} size={20} />
                </View>
              ))}
            </View>
            <Text style={s.due} {...webOnly({ title: "Due after the record enters the stage" })}>{dueWords(t.dueAfterHours)}</Text>
            <IconButton icon="more" label={`More for ${t.title}`} size={22} onPress={(e) => { const p = pointOf(e); onMenu(p.x, p.y); }} />
          </View>
        }
      />
    </View>
  );
}

function AddLine({ label, onPress, testID }: { label: string; onPress(x: number, y: number): void; testID: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} testID={testID}
      onPress={(e) => { const p = pointOf(e); onPress(p.x, p.y); }} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.addl, over && { backgroundColor: "var(--hover)" }, pointer]}
    >
      <Glyph name="plus" size={13} color="var(--ink-3)" />
      <Text style={s.addlText}>{label}</Text>
    </Pressable>
  );
}

function pointOf(e: unknown): { x: number; y: number } {
  const n = (e as { nativeEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number } } | null)?.nativeEvent ?? {};
  return { x: n.clientX ?? n.pageX ?? 0, y: n.clientY ?? n.pageY ?? 0 };
}

const s = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { height: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 20, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tile: { width: 28, height: 28, borderRadius: 8, backgroundColor: "var(--accent-wash)" as string, alignItems: "center", justifyContent: "center" },
  tileText: { fontSize: 11, fontWeight: "700", color: "var(--accent)" as string },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  meta: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  viewOnly: { flexDirection: "row", alignItems: "center", gap: 6 },
  viewOnlyText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  viewOnlyDim: { fontSize: 12.5, color: "var(--ink-4)" as string },
  scroll: { flex: 1, minHeight: 0 },
  col: { width: "100%", maxWidth: 820, alignSelf: "center", paddingHorizontal: 28, paddingTop: 22, paddingBottom: 64 },
  lab: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  labDim: { fontSize: 11.5, color: "var(--ink-4)" as string, marginLeft: 6, flexShrink: 1 },
  fbar: { flexDirection: "row", gap: 2, height: 10, marginTop: 8, borderRadius: 5, overflow: "hidden" },
  fseg: { flexBasis: 0, backgroundColor: "var(--accent)" as string, minWidth: 4 },
  fcount: { flexDirection: "row", gap: 6, marginTop: 6 },
  fn: { fontSize: 11.5, color: "var(--ink-3)" as string },
  fb: { fontWeight: "600", color: "var(--ink)" as string },
  stagesHead: { flexDirection: "row", alignItems: "center", marginTop: 20, marginBottom: 8 },
  stage: { borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, marginBottom: 10, overflow: "hidden" },
  stageSel: { borderColor: "var(--accent-line)" as string },
  stageBody: { paddingHorizontal: 8, paddingBottom: 8 },
  lead: { flexDirection: "row", alignItems: "center", gap: 6, marginRight: 8 },
  no: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  noText: { fontSize: 11, fontWeight: "600", color: "var(--ink-2)" as string },
  tr: { flexDirection: "row", alignItems: "center", gap: 8 },
  count: { fontSize: 12, color: "var(--ink-3)" as string },
  late: { flexDirection: "row", alignItems: "center", gap: 4 },
  lateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--warn)" as string },
  lateText: { fontSize: 12, color: "var(--warn)" as string },
  sl: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4 },
  check: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: "var(--ink-3)" as string, marginRight: 8 },
  checkOpt: { borderStyle: "dashed" },
  seats: { flexDirection: "row", alignItems: "center", gap: 4 },
  seat: { flexDirection: "row", alignItems: "center", gap: 4 },
  due: { fontSize: 12, color: "var(--ink-3)" as string, minWidth: 32, textAlign: "right" },
  autoMark: { width: 22, alignItems: "center", marginRight: 6 },
  addl: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 6, alignSelf: "flex-start" },
  addlText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  none: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingVertical: 4 },
  confirm: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  confirmText: { flex: 1, fontSize: 12.5, color: "var(--ink-2)" as string },
  saved: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  savedText: { fontSize: 12, color: "var(--ink-2)" as string },
  undo: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
  skHead: { height: 52, margin: 0, backgroundColor: "var(--sunk)" as string },
  skBody: { height: 200, margin: 20, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  gone: { fontSize: 13, color: "var(--ink-3)" as string, padding: 24 },
});
