// The goal page's in-place editing: click a part of the goal (title, finish line, deadline, lead, owner, helpers, checklist items, plan steps) and change it where it stands. Each part edits in the
// way that suits it: text as text, the deadline with a date and time field, people with the shared people picker, lists with add, remove and drag to reorder. The page owns the saving (one goals
// capability per edit, with Undo); these parts only draw the editing and hand back the new value.
import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { PeoplePicker } from "../../../../../../ui/src/PeoplePicker/index.tsx";
import type { PickEntry } from "../../../../../../ui/src/PeoplePicker/index.tsx";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { fromLocalInput, moved, toLocalInput } from "./model.ts";
import type { PlanStep, Who } from "./model.ts";

const web = Platform.OS === "web";

/** Text that edits where it stands: a press turns it into a field; Enter or leaving saves, Escape puts it back. A save of the same words, or of nothing, changes nothing. */
export function EditText({ value, canEdit, onSave, label, testID, textStyle, multiline = false, placeholder }: {
  value: string; canEdit: boolean; onSave(next: string): void; label: string; testID: string; textStyle: StyleProp<TextStyle>; multiline?: boolean; placeholder?: string;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const done = (save: boolean): void => {
    setEditing(false);
    const next = text.trim();
    if (save && next !== "" && next !== value) onSave(next);
    else setText(value);
  };
  if (!canEdit) return <Text testID={testID} style={textStyle}>{value}</Text>;
  if (editing) {
    return (
      <TextField testID={`${testID}-field`} accessibilityLabel={label} autoFocus value={text} multiline={multiline} onChangeText={setText} onBlur={() => done(true)}
        onSubmitEditing={() => done(true)} onKeyPress={(e: { nativeEvent: { key: string } }) => { if (e.nativeEvent.key === "Escape") done(false); }}
        style={[textStyle, st.field, multiline && st.fieldMulti]} />
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} testID={`${testID}-edit`} onPress={() => { setText(value); setEditing(true); }}
      style={({ hovered }: { hovered?: boolean }) => [st.editable, hovered === true && st.editableOver]}>
      <Text testID={testID} style={[textStyle, value === "" && st.empty]}>{value === "" ? (placeholder ?? `Add ${label}`) : value}</Text>
    </Pressable>
  );
}

/** A date and time field in the person's zone. */
export function DeadlineEdit({ deadline, offsetMin, canEdit, shown, onSave }: { deadline: number; offsetMin: number; canEdit: boolean; shown: ReactNode; onSave(next: number): void }): ReactElement {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(toLocalInput(deadline, offsetMin));
  if (!canEdit) return <>{shown}</>;
  if (!editing || !web) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Change the deadline" testID="goal-deadline-edit" onPress={() => { setValue(toLocalInput(deadline, offsetMin)); setEditing(true); }}
        style={({ hovered }: { hovered?: boolean }) => [st.editable, hovered === true && st.editableOver]}>{shown}</Pressable>
    );
  }
  const next = fromLocalInput(value, offsetMin);
  return (
    <View style={st.inline}>
      {createElement("input", {
        type: "datetime-local", value, "aria-label": "Deadline", "data-testid": "goal-deadline-field", autoFocus: true,
        onChange: (e: { target: { value: string } }) => setValue(e.target.value),
        onKeyDown: (e: { key: string }) => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter" && next !== null) { setEditing(false); if (next !== deadline) onSave(next); } },
        style: { font: "inherit", fontSize: 13, padding: "3px 6px", border: "1px solid var(--field-line)", borderRadius: 6, background: "var(--field)", color: "var(--ink)" },
      })}
      <Mini label="Save" primary disabled={next === null} testID="goal-deadline-save" onPress={() => { setEditing(false); if (next !== null && next !== deadline) onSave(next); }} />
      <Mini label="Cancel" testID="goal-deadline-cancel" onPress={() => setEditing(false)} />
    </View>
  );
}

export function Mini({ label, onPress, primary = false, disabled = false, testID }: { label: string; onPress(): void; primary?: boolean; disabled?: boolean; testID?: string }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} testID={testID} onPress={disabled ? undefined : onPress}
      style={[st.mini, primary && st.miniPrimary, disabled && { opacity: 0.5 }]}>
      <Text style={[st.miniText, primary && { color: "var(--accent-ink)" as string }]}>{label}</Text>
    </Pressable>
  );
}

/** Pick people, or one person or agent, with the shared picker. Single mode replaces the choice on a press. */
export function PeopleDialog({ title, entries, selected, single = false, onSave, onClose, testID }: {
  title: string; entries: readonly PickEntry[]; selected: readonly string[]; single?: boolean; onSave(ids: string[]): void; onClose(): void; testID: string;
}): ReactElement {
  const [picked, setPicked] = useState<string[]>([...selected]);
  const toggle = (id: string): void => setPicked((p) => (single ? [id] : p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const same = picked.length === selected.length && picked.every((p) => selected.includes(p));
  return (
    <Dialog title={title} onClose={onClose} testID={testID} width={420}
      actions={[{ label: "Cancel", onPress: onClose, testID: `${testID}-cancel` }, { label: "Save", primary: true, disabled: same || (single && picked.length === 0), onPress: () => { onSave(picked); onClose(); }, testID: `${testID}-save` }]}>
      <PeoplePicker entries={entries} selected={picked} onToggle={toggle} placeholder={single ? "Search" : "Add people and agents"} testID={`${testID}-picker`} />
    </Dialog>
  );
}

/** The helpers: faces with names, a remove on each, and add. */
export function HelpersRow({ helpers, nameOf, canEdit, onRemove, onAdd }: { helpers: readonly Who[]; nameOf(id: string): string; canEdit: boolean; onRemove(id: string): void; onAdd(): void }): ReactElement | null {
  if (helpers.length === 0 && !canEdit) return null;
  return (
    <View testID="goal-helpers" style={st.helpers}>
      <Text style={st.helpersLabel}>Helpers</Text>
      {helpers.length === 0 ? <Text style={st.helpersNone}>None yet</Text> : null}
      {helpers.map((h) => (
        // ui-rows-lint: not a list (helper chips laid side by side in a wrapping row)
        <View key={`${h.kind}-${h.id}`} testID={`goal-helper-${h.id}`} style={st.helper}>
          <Avatar {...avatarOf({ id: h.id, name: nameOf(h.id), kind: h.kind === "agent" ? "agent" : "person" })} size={18} />
          <Text style={st.helperName}>{nameOf(h.id)}</Text>
          {canEdit ? <RemoveX label={`Remove ${nameOf(h.id)}`} testID={`goal-helper-remove-${h.id}`} onPress={() => onRemove(h.id)} /> : null}
        </View>
      ))}
      {canEdit ? <Mini label="Add helper" testID="goal-add-helper" onPress={onAdd} /> : null}
    </View>
  );
}

/** The shared close mark as a remove control, with its tooltip ("Remove Aliza"). */
export function RemoveX({ label, onPress, testID }: { label: string; onPress(): void; testID?: string }): ReactElement {
  return (
    <Tooltip text={label}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [st.rm, hovered === true && st.rmOver]}>
        {web ? createElement("svg", { viewBox: "0 0 16 16", width: 12, height: 12, "aria-hidden": true, style: { display: "block", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" } }, createElement("path", { d: "M4 4l8 8M12 4l-8 8" })) : <Text style={st.x}>x</Text>}
      </Pressable>
    </Tooltip>
  );
}

let dragFrom = -1;
/** A row that drags to a new place in its list (web); the move arrows beside it do the same from the keyboard. */
export function DragRow({ index, count, onMove, children, testID }: { index: number; count: number; onMove(from: number, to: number): void; children: ReactNode; testID: string }): ReactElement {
  const arrows = (
    <View style={st.arrows}>
      <Pressable accessibilityRole="button" accessibilityLabel="Move up" testID={`${testID}-up`} disabled={index === 0} onPress={() => onMove(index, index - 1)}><Text style={[st.arrow, index === 0 && st.arrowOff]}>^</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Move down" testID={`${testID}-down`} disabled={index === count - 1} onPress={() => onMove(index, index + 1)}><Text style={[st.arrow, index === count - 1 && st.arrowOff]}>v</Text></Pressable>
    </View>
  );
  const body = <View testID={testID} style={st.dragRow}>{children}{arrows}</View>;
  if (!web) return body;
  return createElement("div", {
    draggable: true, "data-testid": `${testID}-drag`,
    onDragStart: (e: { dataTransfer?: { effectAllowed: string; setData(k: string, v: string): void } }) => { dragFrom = index; if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(index)); } },
    onDragOver: (e: { preventDefault(): void }) => e.preventDefault(),
    onDrop: (e: { preventDefault(): void }) => { e.preventDefault(); if (dragFrom >= 0) onMove(dragFrom, index); dragFrom = -1; },
    style: { cursor: "grab" },
  }, body);
}

/** One line to add an item: type, Enter. */
export function AddLine({ label, placeholder, onAdd, testID }: { label: string; placeholder: string; onAdd(text: string): void; testID: string }): ReactElement {
  const [text, setText] = useState("");
  const add = (): void => { const t = text.trim(); if (t !== "") { onAdd(t); setText(""); } };
  return (
    <View style={st.addLine}>
      <TextField testID={`${testID}-field`} accessibilityLabel={label} value={text} placeholder={placeholder} onChangeText={setText} onSubmitEditing={add} style={{ flex: 1, height: 30, fontSize: 13 }} />
      <Mini label="Add" testID={`${testID}-add`} disabled={text.trim() === ""} onPress={add} />
    </View>
  );
}

let seq = 0;
/** An id for a new checklist item or plan step. */
export const newId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The checklist of a goal: edit an item's words, remove it, drag it, add one. */
export function ChecklistEdit({ items, onChange }: { items: ReadonlyArray<{ id: string; text: string; done?: boolean; taskId?: string }>; onChange(next: Array<{ id: string; text: string; done?: boolean; taskId?: string }>): void }): ReactElement {
  return (
    <View testID="goal-checklist-edit" style={st.list}>
      {items.map((it, i) => (
        // ui-rows-lint: not a list (each row is an inline editor with its own field, drag handle and remove, not a pressable list row)
        <DragRow key={it.id} index={i} count={items.length} onMove={(a, b) => onChange(moved(items, a, b))} testID={`goal-item-${it.id}`}>
          <View style={st.rowBody}>
            <EditText value={it.text} canEdit label="this item" testID={`goal-item-text-${it.id}`} textStyle={st.rowText} onSave={(text) => onChange(items.map((x) => (x.id === it.id ? { ...x, text } : x)))} />
          </View>
          {items.length > 1 ? <RemoveX label="Remove this item" testID={`goal-item-remove-${it.id}`} onPress={() => onChange(items.filter((x) => x.id !== it.id))} /> : null}
        </DragRow>
      ))}
      <AddLine label="a new item" placeholder="Add an item" testID="goal-item-new" onAdd={(text) => onChange([...items, { id: newId("ci"), text }])} />
    </View>
  );
}

/** The drafted plan: steps to rename, remove, drag and add. Each step keeps its why. */
export function DraftPlanEdit({ steps, leadAgentId, canEdit, nameOf, onChange }: { steps: readonly PlanStep[]; leadAgentId: string; canEdit: boolean; nameOf(id: string): string; onChange(next: PlanStep[]): void }): ReactElement {
  return (
    <View testID="goal-draft-plan" style={st.list}>
      {steps.length === 0 ? <Text style={st.helpersNone}>{canEdit ? "No steps yet. Add the first one." : "No steps yet."}</Text> : null}
      {steps.map((s, i) => {
        const face = <Avatar {...avatarOf({ id: s.assigned.id, name: nameOf(s.assigned.id), kind: s.assigned.kind === "agent" ? "agent" : "person" })} size={18} />;
        if (!canEdit) {
          return (
            <View key={s.key} testID={`goal-step-${s.key}`} style={st.dragRow}>
              <View style={st.rowBody}><Text style={st.rowText}>{s.title}</Text><Text style={st.why}>{s.why}</Text></View>{face}
            </View>
          );
        }
        return (
          // ui-rows-lint: not a list (each row is an inline editor with its own fields, drag handle and remove, not a pressable list row)
          <DragRow key={s.key} index={i} count={steps.length} onMove={(a, b) => onChange(moved(steps, a, b))} testID={`goal-step-${s.key}`}>
            <View style={st.rowBody}>
              <EditText value={s.title} canEdit label="this step" testID={`goal-step-title-${s.key}`} textStyle={st.rowText} onSave={(title) => onChange(steps.map((x) => (x.key === s.key ? { ...x, title } : x)))} />
              <EditText value={s.why} canEdit label="why" testID={`goal-step-why-${s.key}`} textStyle={st.why} placeholder="Add why" onSave={(why) => onChange(steps.map((x) => (x.key === s.key ? { ...x, why } : x)))} />
            </View>
            {face}
            <RemoveX label="Remove this step" testID={`goal-step-remove-${s.key}`} onPress={() => onChange(steps.filter((x) => x.key !== s.key))} />
          </DragRow>
        );
      })}
      {canEdit ? <AddLine label="a new step" placeholder="Add a step" testID="goal-step-new" onAdd={(title) => onChange([...steps, { key: newId("s"), title, why: "Added by the owner", assigned: { kind: "agent", id: leadAgentId } }])} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  field: { height: undefined as unknown as number, minHeight: 32, paddingVertical: 4 },
  fieldMulti: { minHeight: 56 },
  editable: { alignSelf: "flex-start", borderRadius: 6, marginHorizontal: -4, paddingHorizontal: 4, maxWidth: "100%" },
  editableOver: { backgroundColor: "var(--hover)" as string },
  empty: { color: "var(--ink-4)" as string },
  inline: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  mini: { height: 26, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  miniPrimary: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  miniText: { color: "var(--ink-2)" as string, fontSize: 12 },
  helpers: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 },
  helpersLabel: { color: "var(--ink-3)" as string, fontSize: 12.5 },
  helpersNone: { color: "var(--ink-4)" as string, fontSize: 12.5 },
  helper: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 2, paddingLeft: 3, paddingRight: 8, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  helperName: { color: "var(--ink-2)" as string, fontSize: 12.5 },
  rm: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rmOver: { backgroundColor: "var(--hover)" as string },
  x: { color: "var(--ink-3)" as string, fontSize: 12, paddingHorizontal: 4 },
  list: { marginTop: 6, gap: 2 },
  dragRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, paddingHorizontal: 4, minHeight: 32 },
  rowBody: { flex: 1, minWidth: 0 },
  rowText: { color: "var(--ink)" as string, fontSize: 13.5, lineHeight: 19 },
  why: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 17 },
  arrows: { flexDirection: "row", gap: 2 },
  arrow: { color: "var(--ink-3)" as string, fontSize: 11, paddingHorizontal: 3 },
  arrowOff: { opacity: 0.3 },
  addLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
});
