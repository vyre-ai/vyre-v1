// The side pane of the Journey designer (spec 2.12, 3.7): the Journey itself, a stage, or a task, whichever is selected. A task shows who is Assigned, the Reviewer and the Approver, the key
// and backup key when an agent holds a seat, when it is due after the record enters the stage, whether the stage waits for it, and its instructions. A stage shows when a record moves on,
// its time limit and who is told when it runs over, the records in it and the Automations that run on it. Every change is the designer's own write: saved as made, with Undo.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { Face, TextButton, webOnly } from "../canvas/parts.tsx";
import type { KeyEventLike } from "../canvas/parts.tsx";
import { each } from "../runs/each.ts";
import { useConfigExtras } from "../config/data.tsx";
import type { ConfigDirectory } from "../config/data.tsx";
import { Glyph } from "../config/glyphs.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Group, Hint, Lab, PickButton, SRow, Switch } from "../config/parts.tsx";
import { useDesign, useJourney } from "./data.ts";
import type { Selection } from "./JourneyDesigner.tsx";
import { DUE_CHOICES, automationsByStage, initials, agentNames as seatNames, EXIT_RULES, LIMIT_CHOICES, SLOTS, agentSeats, clearTaskField, countOf, dueWords, exitRuleId, exitWords, findTask, limitWords, plural, renameStage, setSeat, tasksWords, updateTask } from "./model.ts";
import type { Journey, Ref, Slot, Stage, StageCounts, Task } from "./model.ts";

export interface JourneyPaneProps { journeyId: string; selection: Selection | null; canDesign?: boolean }

export function JourneyPane({ journeyId, selection, canDesign = true }: JourneyPaneProps): ReactElement {
  const st = useJourney(journeyId);
  if (st.phase !== "ready" || !st.journey) return <View testID="journey-pane-loading" style={p.frame} />;
  const j = st.journey;
  const hit = selection?.task ? findTask(j.stages, selection.stage, selection.task) : null;
  if (hit) return <TaskPane key={hit.task.key} journey={j} stage={hit.stage} task={hit.task} canDesign={canDesign} />;
  const stage = selection ? j.stages.find((x) => x.key === selection.stage) : undefined;
  if (stage) return <StagePane key={stage.key} journey={j} stage={stage} counts={st.counts} canDesign={canDesign} />;
  return <JourneyInfo journey={j} counts={st.counts} />;
}

const peopleMenu = (dir: ConfigDirectory, on: (r: Ref) => void, none?: () => void): MenuEntry[] => {
  const out: MenuEntry[] = [];
  if (none) out.push({ label: "Nobody", onSelect: none }, { separator: true });
  let first = true;
  for (const [head, list, kind] of [["People", dir.people, "person"], ["Agents", dir.agents, "agent"], ["Groups", dir.groups, "group"], ["Roles", dir.roles, "role"]] as const) {
    if (list.length === 0) continue;
    if (!first) out.push({ separator: true });
    first = false;
    out.push({ head }, ...each(list, (e) => ({ label: e.name, onSelect: () => on({ kind, id: e.id }) })));
  }
  return out.length ? out : [{ head: "Nobody to pick" }];
};

function PaneHead({ tile, title, sub, right }: { tile: ReactElement; title: string; sub: string; right?: ReactElement | null }): ReactElement {
  return (
    <View style={p.ph}>
      {tile}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={p.name}>{title}</Text>
        <Text numberOfLines={1} style={p.sub}>{sub}</Text>
      </View>
      {right}
    </View>
  );
}

function JourneyInfo({ journey: j, counts }: { journey: Journey; counts: StageCounts }): ReactElement {
  const data = useAutomationsData();
  const extras = useConfigExtras();
  const used = automationsByStage(j.stages);
  const total = counts.reduce((n, c) => n + c.count, 0);
  return (
    <View testID="journey-pane" accessibilityLabel={`${j.name}, Journey`} style={p.frame}>
      <PaneHead tile={<View style={p.tile}><Text style={p.tileText}>{initials(j.name)}</Text></View>} title={j.name} sub={plural(total, "active record")} right={<TextButton label="Records" icon="records" testID="pane-records" onPress={() => extras.openRecords?.(j.recordType)} />} />
      <ScrollView style={p.scroll} contentContainerStyle={p.body}>
        <Lab first>Record type</Lab>
        <Group><SRow label={j.recordType} sub={`Subject: ${j.subjectType}`} last minHeight={48} /></Group>
        <Lab>Stages</Lab>
        <Group testID="pane-stages">
          {j.stages.map((g, i) => <Row key={g.key} id={`info-stage-${g.key}`} title={`${i + 1}. ${g.title}`} trailing={<Text style={p.dimr}>{plural(countOf(counts, g.key).count, "record")}</Text>} />)}
        </Group>
        {used.length ? (
          <>
            <Lab>Automations on its stages</Lab>
            <Group testID="pane-autos">
              {used.map((u) => <Row key={`${u.id}-${u.stage}`} id={`info-auto-${u.id}-${u.stage}`} title={data.name(u.id)} note={`On entering ${u.stage}`} leading={<View style={p.lead}><Glyph name="bolt" size={14} color="var(--accent)" /></View>} />)}
            </Group>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StagePane({ journey: j, stage: g, counts, canDesign }: { journey: Journey; stage: Stage; counts: StageCounts; canDesign: boolean }): ReactElement {
  const data = useAutomationsData();
  const extras = useConfigExtras();
  const d = useDesign(j);
  const { element, show } = useMenu();
  const [title, setTitle] = useState(g.title);
  useEffect(() => setTitle(g.title), [g.title]);
  const i = j.stages.findIndex((x) => x.key === g.key);
  const c = countOf(counts, g.key);
  const commit = (): void => { const v = title.trim(); if (!v || v === g.title) { setTitle(g.title); return; } void d.design(renameStage(j.stages, g.key, v), `Renamed to ${v}`); };
  const toldWho = g.timeLimit?.escalateTo;
  return (
    <View testID="stage-pane" accessibilityLabel={`${g.title}, stage ${i + 1} of ${j.stages.length}`} style={p.frame}>
      <PaneHead
        tile={<View style={p.tile}><Text style={p.tileText}>{String(i + 1)}</Text></View>} title={g.title} sub={`Stage ${i + 1} of ${j.stages.length}, ${plural(c.count, "record")}`}
        right={<TextButton label="Records" icon="records" testID="pane-records" onPress={() => extras.openRecords?.(j.recordType, g.title)} />}
      />
      <ScrollView style={p.scroll} contentContainerStyle={p.body}>
        {canDesign ? (
          <>
            <Lab first>Name</Lab>
            <Group><SRow minHeight={44} last><TextInput accessibilityLabel="Stage name" testID="stage-name" value={title} onChangeText={setTitle} onBlur={commit} onSubmitEditing={commit} {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Escape") { setTitle(g.title); e.stopPropagation?.(); } } })} style={p.input} /></SRow></Group>
          </>
        ) : null}
        <Lab first={!canDesign}>When a record moves on</Lab>
        <Group testID="stage-rules">
          <SRow label="Moves on" minHeight={44}>
            <PickButton label="Moves on" value={exitWords(g.exit)} disabled={!canDesign} testID="exit-rule" onPress={(x, y) => show(each(EXIT_RULES, (r) => ({ label: r.label, checked: r.id === exitRuleId(g.exit), onSelect: () => void d.setRule(g.key, { exit: r.exit }, r.label) })), x, y, "other", { label: "When a record moves on" })} />
          </SRow>
          <SRow label="Tasks" minHeight={40}><Text style={p.dimr}>{tasksWords(g)}</Text></SRow>
          <SRow label="Time limit" sub={c.over ? `${plural(c.over, "record is", "records are")} over it` : undefined} minHeight={44} last={!g.timeLimit}>
            <PickButton label="Time limit" value={g.timeLimit ? limitWords({ hours: g.timeLimit.hours }, data.name) : "None"} disabled={!canDesign} testID="time-limit" empty={!g.timeLimit}
              onPress={(x, y) => show([{ label: "None", checked: !g.timeLimit, onSelect: () => void d.setRule(g.key, { timeLimit: null }, "No time limit") }, { separator: true }, ...each(LIMIT_CHOICES, (h) => ({ label: limitWords({ hours: h }, data.name), checked: g.timeLimit?.hours === h, onSelect: () => void d.setRule(g.key, { timeLimit: { hours: h, ...(g.timeLimit?.escalateTo ? { escalateTo: g.timeLimit.escalateTo } : {}) } }, `Limit of ${limitWords({ hours: h }, data.name)}`) }))], x, y, "other", { label: "Time limit" })} />
          </SRow>
          {g.timeLimit ? (
            <SRow label="When it runs over, tell" minHeight={44} last>
              <PickButton label="Who is told" value={toldWho ? data.name(toldWho.id) : "Nobody"} disabled={!canDesign} testID="told-who" empty={!toldWho}
                onPress={(x, y) => show([{ label: "Nobody", checked: !toldWho, onSelect: () => void d.setRule(g.key, { timeLimit: { hours: g.timeLimit!.hours } }, "Nobody is told") }, { separator: true }, ...each([...each(extras.directory.roles, (r) => ({ kind: "role" as const, ...r })), ...each(extras.directory.people, (r) => ({ kind: "person" as const, ...r }))], (e) => ({ label: e.name, checked: toldWho?.id === e.id, onSelect: () => void d.setRule(g.key, { timeLimit: { hours: g.timeLimit!.hours, escalateTo: { kind: e.kind, id: e.id } } }, `${e.name} is told when it runs over`) }))], x, y, "other", { label: "Who is told" })} />
            </SRow>
          ) : null}
        </Group>
        <Lab>Runs here</Lab>
        {g.automations.length ? (
          <Group testID="stage-autos">
            {g.automations.map((id) => <Row key={id} id={`stage-auto-${id}`} title={data.name(id)} note="On entering" leading={<View style={p.lead}><Glyph name="bolt" size={14} color="var(--accent)" /></View>} />)}
          </Group>
        ) : <Text style={p.dim}>No automations on this stage.</Text>}
        {d.saved.note ? <Text testID="saved-note" accessibilityLiveRegion="polite" style={[p.note, d.saved.note.failed && { color: "var(--danger)" as string }]}>{d.saved.note.text}</Text> : null}
      </ScrollView>
      {element}
    </View>
  );
}

function TaskPane({ journey: j, stage: g, task: t, canDesign }: { journey: Journey; stage: Stage; task: Task; canDesign: boolean }): ReactElement {
  const data = useAutomationsData();
  const extras = useConfigExtras();
  const d = useDesign(j);
  const { element, show } = useMenu();
  const [title, setTitle] = useState(t.title);
  const [brief, setBrief] = useState(t.description ?? "");
  useEffect(() => setTitle(t.title), [t.title]);
  useEffect(() => setBrief(t.description ?? ""), [t.description]);
  const edit = (next: Stage[], text: string): void => { void d.design(next, text); };
  const seat = (slot: Slot): Ref | undefined => t[slot];
  const agents = agentSeats(t);
  const agentNames = seatNames(t, data.name);
  const keyName = (id: string | undefined): string => (id ? data.keys.find((k) => k.id === id)?.name ?? data.name(id) : "None");
  const commitTitle = (): void => { const v = title.trim(); if (!v || v === t.title) { setTitle(t.title); return; } edit(updateTask(j.stages, g.key, t.key, { title: v }), `Renamed to ${v}`); };
  const commitBrief = (): void => { const v = brief.trim(); if (v === (t.description ?? "")) return; edit(v ? updateTask(j.stages, g.key, t.key, { description: v }) : clearTaskField(j.stages, g.key, t.key, "description"), "Saved the instructions"); };
  const keyMenu = (field: "keyId" | "backupKeyId", x: number, y: number): void => {
    const items: MenuEntry[] = each(data.keys, (k) => ({ label: k.name, checked: t[field] === k.id, onSelect: () => edit(updateTask(j.stages, g.key, t.key, field === "keyId" ? { keyId: k.id } : { backupKeyId: k.id }), `${field === "keyId" ? "Key" : "Backup key"}: ${k.name}`) }));
    if (field === "backupKeyId") items.unshift({ label: "None", checked: t.backupKeyId === undefined, onSelect: () => edit(clearTaskField(j.stages, g.key, t.key, "backupKeyId"), "No backup key") }, { separator: true });
    show(items.length ? items : [{ head: "No keys to pick" }], x, y, "other", { label: field === "keyId" ? "Key" : "Backup key" });
  };

  return (
    <View testID="task-pane" accessibilityLabel={`${t.title}, task in ${g.title}`} style={p.frame}>
      <PaneHead tile={<View style={p.tile}><Glyph name="task" size={16} color="var(--ink-2)" /></View>} title={t.title} sub={`Task in ${g.title}`} />
      <ScrollView style={p.scroll} contentContainerStyle={p.body}>
        {canDesign ? (
          <>
            <Lab first>Name</Lab>
            <Group><SRow minHeight={44} last><TextInput accessibilityLabel="Task name" testID="task-name" value={title} onChangeText={setTitle} onBlur={commitTitle} onSubmitEditing={commitTitle} {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Escape") { setTitle(t.title); e.stopPropagation?.(); } } })} style={p.input} /></SRow></Group>
          </>
        ) : null}
        <Lab first={!canDesign}>People on this task</Lab>
        <Group testID="seats">
          {each(SLOTS, ({ key, label }, n) => {
            const who = seat(key);
            return (
              <SRow key={key} label={label} minHeight={40} last={n === SLOTS.length - 1} testID={`seat-${key}`}>
                <PickButton
                  label={label} value={who ? data.name(who.id) : "Nobody"} empty={!who} disabled={!canDesign} testID={`pick-${key}`}
                  lead={who ? <Face name={data.name(who.id)} kind={who.kind === "person" ? "person" : "agent"} size={16} /> : undefined}
                  onPress={(x, y) => show(peopleMenu(extras.directory, (r) => edit(setSeat(j.stages, g.key, t.key, key, r), `${label}: ${data.name(r.id)}`), key === "assigned" ? undefined : () => edit(setSeat(j.stages, g.key, t.key, key, null), `No ${label.toLowerCase()}`)), x, y, "other", { label })}
                />
              </SRow>
            );
          })}
        </Group>

        {agents.length ? (
          <>
            <Lab>Agent key</Lab>
            <Group testID="agent-key">
              <SRow label="Key" sub={`For ${agentNames}`} minHeight={44}>
                <PickButton label="Key" value={keyName(t.keyId)} empty={!t.keyId} disabled={!canDesign} testID="pick-key" onPress={(x, y) => keyMenu("keyId", x, y)} />
              </SRow>
              <SRow label="Backup" minHeight={40} last>
                <PickButton label="Backup key" value={keyName(t.backupKeyId)} empty={!t.backupKeyId} disabled={!canDesign} testID="pick-backup" onPress={(x, y) => keyMenu("backupKeyId", x, y)} />
              </SRow>
            </Group>
          </>
        ) : null}

        <Lab>When</Lab>
        <Group testID="task-when">
          <SRow label="Due after entering" minHeight={40}>
            <PickButton label="Due after entering" value={dueWords(t.dueAfterHours)} disabled={!canDesign} testID="pick-due" onPress={(x, y) => show(each(DUE_CHOICES, (h) => ({ label: dueWords(h), checked: (t.dueAfterHours ?? 0) === h, onSelect: () => edit(h === 0 ? clearTaskField(j.stages, g.key, t.key, "dueAfterHours") : updateTask(j.stages, g.key, t.key, { dueAfterHours: h }), `Due ${dueWords(h)} after entering`) })), x, y, "other", { label: "Due after entering" })} />
          </SRow>
          <SRow label="Required" sub={t.required ? "The stage waits for it" : "The stage does not wait"} minHeight={44} last>
            <Switch on={t.required} label="Required" disabled={!canDesign} testID="task-required" onChange={(v) => edit(updateTask(j.stages, g.key, t.key, { required: v }), v ? "Required" : "Optional")} />
          </SRow>
        </Group>

        {canDesign || t.description ? (
          <>
            <Lab>Instructions</Lab>
            {canDesign ? (
              <TextInput accessibilityLabel="Instructions" testID="task-brief" value={brief} onChangeText={setBrief} onBlur={commitBrief} multiline placeholder="What the doer should know" placeholderTextColor="var(--ink-4)" style={[p.input, p.brief]} />
            ) : <Text style={p.para}>{t.description}</Text>}
          </>
        ) : null}
        <Hint>Each task gets its own chat, listed under this Journey. It opens when the first person or agent speaks.</Hint>
        {d.saved.note ? <Text testID="saved-note" accessibilityLiveRegion="polite" style={[p.note, d.saved.note.failed && { color: "var(--danger)" as string }]}>{d.saved.note.text}</Text> : null}
      </ScrollView>
      {element}
    </View>
  );
}

const p = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  ph: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 14, paddingBottom: 12, paddingLeft: 16, paddingRight: 14 },
  lead: { flexDirection: "row", alignItems: "center", marginRight: 8 },
  tile: { width: 34, height: 34, borderRadius: 10, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center" },
  tileText: { fontSize: 12, fontWeight: "700", color: "var(--ink-2)" as string },
  name: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  scroll: { flex: 1, minHeight: 0 },
  body: { paddingHorizontal: 16, paddingBottom: 24 },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string },
  dimr: { fontSize: 12.5, color: "var(--ink-2)" as string },
  para: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  input: { flex: 1, height: 30, borderRadius: 7, paddingHorizontal: 8, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--hover)" as string, ...({ outlineStyle: "none", outlineWidth: 0 } as object) },
  brief: { minHeight: 72, height: undefined, paddingTop: 8, paddingBottom: 8, flex: undefined },
  note: { fontSize: 12, color: "var(--ink-2)" as string, marginTop: 14 },
});
