// The goal pane's Details tab: the goal's settings, one row each, and every row edits in place with the control that suits it (a date and time field, a rhythm and quiet hours picker, a budget cap, the
// list of what the goal may do without asking, the people). It repeats nothing the page already shows (the finish line). Saving is the page's: each row hands back the new value.
import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { Mini, RemoveX } from "./GoalEdit.tsx";
import { budgetOf, dueWords, fromLocalInput, rhythmWords, toLocalInput } from "./model.ts";
import type { Goal, Permission } from "./model.ts";

type Patch = (input: Record<string, unknown>, said: string, back: Record<string, unknown>) => void;
const input = (value: string, onChange: (v: string) => void, type: string, label: string, width = 110): ReactElement => createElement("input", {
  type, value, "aria-label": label, onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  style: { width, font: "inherit", fontSize: 13, padding: "3px 6px", border: "1px solid var(--field-line)", borderRadius: 6, background: "var(--field)", color: "var(--ink)" },
});

/** A setting: its name, its value in plain words, and a Change that opens the editor where the value is. */
function Setting({ name, value, note, editor, canEdit, testID }: { name: string; value: string; note?: string; editor: (close: () => void) => ReactNode; canEdit: boolean; testID: string }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <View testID={testID} style={st.setting}>
      <View style={st.head}>
        <View style={{ flex: 1, minWidth: 0 }}><Text style={st.name}>{name}</Text><Text style={st.value}>{value}</Text></View>
        {canEdit ? <Mini label={open ? "Close" : "Change"} testID={`${testID}-change`} onPress={() => setOpen(!open)} /> : null}
      </View>
      {open ? <View style={st.editor}>{editor(() => setOpen(false))}</View> : null}
      {note ? <Text style={st.note}>{note}</Text> : null}
    </View>
  );
}

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
function RhythmEditor({ g, patch, close }: { g: Goal; patch: Patch; close(): void }): ReactElement {
  const [every, setEvery] = useState<"day" | "hours" | "week">(g.rhythm.every);
  const [at, setAt] = useState(g.rhythm.at ?? "09:00");
  const [hours, setHours] = useState(String(g.rhythm.hours ?? 6));
  const [day, setDay] = useState(g.rhythm.day ?? 1);
  const [quiet, setQuiet] = useState(g.quiet !== null);
  const [from, setFrom] = useState(g.quiet?.from ?? "22:00");
  const [to, setTo] = useState(g.quiet?.to ?? "08:00");
  const h = Math.max(1, Math.min(168, Math.round(Number(hours)) || 1));
  const rhythm = every === "hours" ? { every, hours: h } : every === "week" ? { every, at, day } : { every, at };
  return (
    <View style={{ gap: 8 }}>
      {/* ui-rows-lint: not a list (segmented choice buttons) */}
      <View style={st.row}>{(["day", "hours", "week"] as const).map((k) => <Mini key={k} label={k === "day" ? "Every day" : k === "hours" ? "Every few hours" : "Every week"} primary={every === k} testID={`goal-rhythm-${k}`} onPress={() => setEvery(k)} />)}</View>
      {every === "hours" ? <View style={st.row}><Text style={st.note}>Every</Text>{input(hours, setHours, "number", "Hours", 70)}<Text style={st.note}>hours</Text></View> : null}
      {/* ui-rows-lint: not a list (day choice buttons) */}
      {every === "week" ? <View style={st.row}>{DAYS.map((d, i) => <Mini key={d} label={d.slice(0, 3)} primary={day === i} onPress={() => setDay(i)} />)}</View> : null}
      {every !== "hours" ? <View style={st.row}><Text style={st.note}>At</Text>{input(at, setAt, "time", "Time")}</View> : null}
      <View style={st.row}><Mini label={quiet ? "Quiet hours on" : "Quiet hours off"} primary={quiet} testID="goal-quiet-toggle" onPress={() => setQuiet(!quiet)} />
        {quiet ? <>{input(from, setFrom, "time", "Quiet from")}<Text style={st.note}>to</Text>{input(to, setTo, "time", "Quiet until")}</> : null}</View>
      <View style={st.row}>
        <Mini label="Save" primary testID="goal-rhythm-save" onPress={() => { patch({ rhythm, quiet: quiet ? { from, to } : null }, "Check-ins changed.", { rhythm: g.rhythm, quiet: g.quiet }); close(); }} />
        <Mini label="Cancel" onPress={close} />
      </View>
    </View>
  );
}

function BudgetEditor({ g, patch, close }: { g: Goal; patch: Patch; close(): void }): ReactElement {
  const [cap, setCap] = useState(g.budget.spendMicros ? String(g.budget.spendMicros / 1_000_000) : "");
  const [turns, setTurns] = useState(g.budget.turns ? String(g.budget.turns) : "");
  const dollars = Number(cap), t = Math.round(Number(turns));
  const budget = { ...(cap !== "" && dollars > 0 ? { spendMicros: Math.round(dollars * 1_000_000) } : {}), ...(turns !== "" && t > 0 ? { turns: t } : {}) };
  return (
    <View style={{ gap: 8 }}>
      <View style={st.row}><Text style={st.note}>Spend cap, $</Text><TextField testID="goal-budget-cap" accessibilityLabel="Spend cap in dollars" value={cap} onChangeText={setCap} style={st.num} /></View>
      <View style={st.row}><Text style={st.note}>Turns</Text><TextField testID="goal-budget-turns" accessibilityLabel="Turn cap" value={turns} onChangeText={setTurns} style={st.num} /></View>
      <View style={st.row}>
        <Mini label="Save" primary testID="goal-budget-save" disabled={Object.keys(budget).length === 0} onPress={() => { patch({ budget }, "Budget changed.", { budget: g.budget }); close(); }} />
        <Mini label="Cancel" onPress={close} />
      </View>
    </View>
  );
}

function PermissionsBlock({ g, canEdit, patch }: { g: Goal; canEdit: boolean; patch: Patch }): ReactElement {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [act, setAct] = useState<"send" | "post">("send");
  const save = (next: Permission[], said: string): void => patch({ permissions: next.map(({ act: a, target: tg, label: l }) => ({ act: a, target: tg, label: l })) }, said, { permissions: g.permissions.map(({ act: a, target: tg, label: l }) => ({ act: a, target: tg, label: l })) });
  return (
    <View testID="goal-permissions" style={st.setting}>
      <Text style={st.name}>It may do without asking</Text>
      {g.permissions.length === 0 ? <Text style={st.value}>Nothing yet. It asks you before anything leaves the Space.</Text> : null}
      {g.permissions.map((p) => (
        // ui-rows-lint: not a list (each row carries its own remove control and is not pressable)
        <View key={`${p.act}-${p.target}-${p.label}`} style={st.perm}>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={st.value}>{p.label}</Text><Text style={st.note}>{p.granted ? "Allowed" : "Allowed once you start the goal"}</Text></View>
          {canEdit ? <RemoveX label={`Remove ${p.label}`} testID={`goal-perm-remove-${p.target}`} onPress={() => save(g.permissions.filter((x) => x !== p), "Removed.")} /> : null}
        </View>
      ))}
      {g.permissions.length > 0 ? <Text style={st.note}>Anything not listed asks you first.</Text> : null}
      {canEdit && !adding ? <Mini label="Allow something" testID="goal-perm-add" onPress={() => setAdding(true)} /> : null}
      {adding ? (
        <View style={{ gap: 8, marginTop: 6 }}>
          <View style={st.row}><Mini label="Send" primary={act === "send"} onPress={() => setAct("send")} /><Mini label="Post" primary={act === "post"} onPress={() => setAct("post")} /></View>
          <TextField testID="goal-perm-label" accessibilityLabel="What it may do" placeholder="What, in words (Send email from the Lab template)" value={label} onChangeText={setLabel} />
          <TextField testID="goal-perm-target" accessibilityLabel="Where" placeholder="Where (mail.send, or a domain)" value={target} onChangeText={setTarget} />
          <View style={st.row}>
            <Mini label="Add" primary testID="goal-perm-save" disabled={label.trim() === "" || target.trim() === ""} onPress={() => { save([...g.permissions, { act, target: target.trim(), label: label.trim() }], "Allowed."); setAdding(false); setLabel(""); setTarget(""); }} />
            <Mini label="Cancel" onPress={() => setAdding(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function GoalSettings({ g, nameOf, offsetMin, canEdit, patch, pick, removeHelper }: {
  g: Goal; nameOf(id: string): string; offsetMin: number; canEdit: boolean; patch: Patch; pick(w: "lead" | "owner" | "helpers"): void; removeHelper(id: string): void;
}): ReactElement {
  const b = budgetOf(g);
  const [due, setDue] = useState(toLocalInput(g.deadline, offsetMin));
  const people: Array<{ id: string; kind: string; role: string }> = [{ id: g.owner, kind: "person", role: "Owner" }, { id: g.leadAgentId, kind: "agent", role: "Leads" }, ...g.helpers.map((h) => ({ id: h.id, kind: h.kind, role: "Helps" }))];
  return (
    <ScrollView testID="goal-details" contentContainerStyle={st.pad}>
      <Text style={st.small}>{`Progress is read from ${g.finish.source?.label ?? "the goal itself"}, never from what an agent says.`}</Text>
      {g.finish.kind === "number" ? (
        <Setting testID="goal-set-target" name="Target" value={`${g.finish.target ?? ""}${g.finish.unit ? ` ${g.finish.unit}` : ""}`} canEdit={canEdit}
          editor={(close) => <TargetEditor g={g} patch={patch} close={close} />} />
      ) : null}
      <Setting testID="goal-set-deadline" name="Deadline" value={dueWords(g.deadline, offsetMin)} canEdit={canEdit}
        editor={(close) => {
          const next = fromLocalInput(due, offsetMin);
          return <View style={st.row}>{input(due, setDue, "datetime-local", "Deadline", 200)}<Mini label="Save" primary disabled={next === null} testID="goal-set-deadline-save" onPress={() => { if (next !== null && next !== g.deadline) patch({ deadline: next }, `Deadline moved to ${dueWords(next, offsetMin)}.`, { deadline: g.deadline }); close(); }} /></View>;
        }} />
      <Setting testID="goal-set-checkins" name="Check-ins" value={rhythmWords(g)} note="It also wakes when a task finishes, the number moves, or you answer." canEdit={canEdit} editor={(close) => <RhythmEditor g={g} patch={patch} close={close} />} />
      <Setting testID="goal-set-budget" name="Budget" value={b.text} note="Warns you at 80%. Pauses and asks you at 100%. Runs on the owner's AI account." canEdit={canEdit} editor={(close) => <BudgetEditor g={g} patch={patch} close={close} />} />
      <PermissionsBlock g={g} canEdit={canEdit} patch={patch} />
      <View testID="goal-people" style={st.setting}>
        <Text style={st.name}>People</Text>
        {people.map((p) => (
          // ui-rows-lint: not a list (each row carries its own change or remove control and is not pressable)
          <View key={`${p.role}-${p.id}`} testID={`goal-person-${p.id}`} style={st.perm}>
            <Avatar {...avatarOf({ id: p.id, name: nameOf(p.id), kind: p.kind === "agent" ? "agent" : "person" })} size={20} />
            <Text style={[st.value, { flex: 1 }]}>{nameOf(p.id)}</Text>
            <Text style={st.note}>{p.role}</Text>
            {canEdit && p.role === "Owner" ? <Mini label="Change" onPress={() => pick("owner")} /> : null}
            {canEdit && p.role === "Leads" ? <Mini label="Change" onPress={() => pick("lead")} /> : null}
            {canEdit && p.role === "Helps" ? <RemoveX label={`Remove ${nameOf(p.id)}`} onPress={() => removeHelper(p.id)} /> : null}
          </View>
        ))}
        {canEdit ? <Mini label="Add helper" testID="goal-details-add-helper" onPress={() => pick("helpers")} /> : null}
      </View>
    </ScrollView>
  );
}

function TargetEditor({ g, patch, close }: { g: Goal; patch: Patch; close(): void }): ReactElement {
  const [v, setV] = useState(String(g.finish.target ?? ""));
  const n = Number(v);
  return (
    <View style={st.row}>
      <TextField testID="goal-target-field" accessibilityLabel="Target" value={v} onChangeText={setV} style={st.num} />
      <Mini label="Save" primary testID="goal-target-save" disabled={!Number.isFinite(n) || v.trim() === ""} onPress={() => { patch({ finish: { ...g.finish, target: n } }, "Target changed.", { finish: g.finish }); close(); }} />
    </View>
  );
}

const st = StyleSheet.create({
  pad: { padding: 16, gap: 4 },
  small: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  setting: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  value: { color: "var(--ink)" as string, fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  note: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 17 },
  editor: { marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  perm: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 30 },
  x: { color: "var(--ink-3)" as string, fontSize: 12, paddingHorizontal: 4 },
  num: { width: 100, height: 30, fontSize: 13 },
});
