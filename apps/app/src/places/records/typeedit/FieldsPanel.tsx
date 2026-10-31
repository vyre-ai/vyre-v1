// The Fields panel of a table: every field of the type with show or hide in this view, and the edits a person makes to the type itself: add a field, rename, change type, delete (to the
// field Trash, restorable), move up or down. Each edit is a schema change previewed with schema.diff and applied on exactly that preview; a destructive one asks once, with the count.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Glyph } from "../schemamap/icons.tsx";
import { fieldMark } from "../schemamap/model.ts";
import { ConfirmLine, FieldMark, TextButton } from "./parts.tsx";
import {
  addFieldOps, addableTypes, confirmLine, dropFieldOps, fieldDeleteBlocked, moveFieldOps, renameFieldOps, requiredOps, retypeBlocked, retypeFieldOps, retypeTarget, slugOf,
} from "./model.ts";
import type { Call, FieldDef, FieldTypeInfo } from "./model.ts";
import { OVERVIEW, addGroup, deleteGroup, groupOf, groupsIn, moveField, renameGroup } from "./groups.ts";
import type { LayoutSection } from "./groups.ts";
import { useSchemaChange } from "./useChange.ts";

export interface PanelType {
  key: string;
  title: string;
  system: boolean;
  titleField: string;
  summaryField?: string | undefined;
  statusField?: string | undefined;
  ownerField?: string | undefined;
  fields: readonly FieldDef[];
}
type TrashItem = CapMap["schema.trash.list"]["out"]["items"][number];
export type FieldMode = "rename" | "type" | "delete" | "group";

export interface FieldsPanelProps {
  call: Call;
  type: PanelType;
  /** Fields hidden in this view. */
  hidden: readonly string[];
  onToggleHidden(field: string): void;
  onClose(): void;
  /** Open with one field's action showing (from a column header's menu). */
  initial?: { field: string; mode: FieldMode };
  /** Types and trash are read once the panel opens; tests hand them in. */
  fieldTypes?: readonly FieldTypeInfo[];
  trash?: readonly TrashItem[];
  /** Draw the show or hide checks (a table has a view to hide in; the Record types page has none). */
  viewToggles?: boolean;
  /** The type's record page layout (its field groups), read once the panel opens; tests hand it in. */
  layout?: readonly LayoutSection[];
}

export function FieldsPanel({ call, type, hidden, onToggleHidden, onClose, initial, fieldTypes: given, trash: givenTrash, viewToggles = true, layout: givenLayout }: FieldsPanelProps): ReactElement {
  const [fieldTypes, setFieldTypes] = useState<readonly FieldTypeInfo[]>(given ?? []);
  const [trash, setTrash] = useState<readonly TrashItem[]>(givenTrash ?? []);
  const [open, setOpen] = useState<string | null>(initial?.field ?? null);
  const [mode, setMode] = useState<FieldMode | null>(initial?.mode ?? null);
  const [name, setName] = useState(initial?.mode === "rename" ? type.fields.find((f) => f.key === initial.field)?.title ?? "" : "");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("text");
  const [newRequired, setNewRequired] = useState(false);
  const [layout, setLayout] = useState<readonly LayoutSection[]>(givenLayout ?? []);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; text: string } | null>(null);
  const readTrash = (): void => { void call("schema.trash.list", {}).then((out) => setTrash((out as CapMap["schema.trash.list"]["out"]).items), () => undefined); };
  const change = useSchemaChange(call, () => { readTrash(); });
  useEffect(() => {
    let live = true;
    if (given === undefined) void call("schema.field_types", {}).then((out) => { if (live) setFieldTypes((out as CapMap["schema.field_types"]["out"]).fieldTypes); }, () => undefined);
    if (givenLayout === undefined) void call("schema.layout.get", { type: type.key }).then((out) => { if (live) setLayout((out as CapMap["schema.layout.get"]["out"]).sections); }, () => undefined);
    if (givenTrash === undefined) void call("schema.trash.list", {}).then((out) => { if (live) setTrash((out as CapMap["schema.trash.list"]["out"]).items); }, () => undefined);
    return () => { live = false; };
  }, [call]);
  // a field that was dropped is gone from the list: close what was open on it
  useEffect(() => { if (open !== null && !type.fields.some((f) => f.key === open)) { setOpen(null); setMode(null); } }, [type.fields, open]);

  const order = type.fields.map((f) => f.key);
  const choices = addableTypes(fieldTypes);
  const keys = order;
  const pick = (f: FieldDef): void => {
    change.cancel();
    if (open === f.key) { setOpen(null); setMode(null); return; }
    setOpen(f.key); setMode(null); setName(f.title);
  };
  const doRun = (ops: Parameters<typeof change.run>[0], done?: () => void): void => { void change.run(ops).then((ok) => { if (ok) { setMode(null); done?.(); } }); };
  const fieldKeys = order;
  const groups = groupsIn(layout, fieldKeys);
  // one layout write per change; the page redraws from the saved layout
  const saveLayout = (next: LayoutSection[], done?: () => void): void => {
    setGroupBusy(true); setGroupError(null);
    call("schema.layout.set", { type: type.key, sections: next }).then(() => { setLayout(next); done?.(); }, (e: unknown) => setGroupError(e instanceof Error && e.message ? e.message : "Could not save the groups.")).finally(() => setGroupBusy(false));
  };
  const lost = trash.filter((t) => t.type === type.key && t.field !== undefined);

  const rows: ReactElement[] = [];
  for (const f of type.fields) {
    const isTitle = f.key === type.titleField;
    const shown = isTitle || !hidden.includes(f.key);
    const expanded = open === f.key;
    rows.push(
      <View key={f.key} testID={`panel-field-${f.key}`}>
        <Row
          id={`panel-field-${f.key}`} title={f.title} note={`${fieldMark(f.type).name}${f.required ? " · Required" : ""}${groupOf(layout, fieldKeys, f.key) ? ` · ${groupOf(layout, fieldKeys, f.key)!.title}` : ""}`} selected={expanded}
          leading={<FieldMark type={f.type} />}
          trailing={!viewToggles ? undefined : (
            <Pressable
              accessibilityRole="checkbox" accessibilityLabel={isTitle ? `${f.title} always shows` : `${shown ? "Hide" : "Show"} ${f.title} in this view`} accessibilityState={{ checked: shown, disabled: isTitle }} disabled={isTitle} testID={`panel-show-${f.key}`}
              onPress={() => onToggleHidden(f.key)} style={({ hovered }: { hovered?: boolean }) => [s.eye, hovered === true && !isTitle && s.eyeOver, isTitle && s.eyeOff]}
            >
              <Glyph name={shown ? "check" : "plus"} size={14} color={shown ? "var(--accent)" : "var(--ink-4)"} />
            </Pressable>
          )}
          onPress={() => pick(f)}
        />
        {expanded ? <FieldEdit f={f} type={type} order={order} mode={mode} setMode={(m) => { change.cancel(); setMode(m); }} name={name} setName={setName} choices={choices} change={change} run={doRun} groups={groups} inGroup={groupOf(layout, fieldKeys, f.key)?.key ?? null} groupBusy={groupBusy} onGroup={(to) => saveLayout(moveField(layout, fieldKeys, f.key, to), () => setMode(null))} /> : null}
      </View>,
    );
  }
  const addReady = newName.trim() !== "" && slugOf(newName, "f") !== "";
  const submitAdd = (): void => {
    if (!addReady) return;
    const made = addFieldOps({ type: type.key, name: newName, fieldType: newType, required: newRequired, takenKeys: keys });
    doRun(made.ops, () => { setAdding(false); setNewName(""); setNewType("text"); setNewRequired(false); });
  };
  const groupRows: ReactElement[] = groups.map((g) => (
    <View key={g.key} testID={`panel-group-${g.key}`}>
      {renaming?.key === g.key ? (
        <View style={s.inline}>
          <View style={s.grow}><TextField value={renaming.text} onChangeText={(t) => setRenaming({ key: g.key, text: t })} accessibilityLabel={`Rename ${g.title}`} testID={`panel-group-input-${g.key}`} autoFocus onSubmitEditing={() => { if (renaming.text.trim()) saveLayout(renameGroup(layout, fieldKeys, g.key, renaming.text), () => setRenaming(null)); }} /></View>
          <TextButton label="Cancel" testID={`panel-group-rename-cancel-${g.key}`} onPress={() => setRenaming(null)} />
          <TextButton label="Save" primary testID={`panel-group-rename-save-${g.key}`} off={renaming.text.trim() === "" || groupBusy ? true : undefined} onPress={() => saveLayout(renameGroup(layout, fieldKeys, g.key, renaming.text), () => setRenaming(null))} />
        </View>
      ) : (
        <Row
          id={`panel-group-row-${g.key}`} title={g.title} note={`${g.fields.length} ${g.fields.length === 1 ? "field" : "fields"}`}
          trailing={<View style={s.inline}>
            <TextButton label="Rename" testID={`panel-group-rename-${g.key}`} onPress={() => setRenaming({ key: g.key, text: g.title })} />
            <TextButton label="Delete" danger testID={`panel-group-delete-${g.key}`} off={groupBusy ? true : undefined} onPress={() => saveLayout(deleteGroup(layout, fieldKeys, g.key))} />
          </View>}
        />
      )}
    </View>
  ));
  const groupReady = newGroup !== null && newGroup.trim() !== "";
  const submitGroup = (): void => { if (groupReady) saveLayout(addGroup(layout, fieldKeys, newGroup!).sections, () => setNewGroup(null)); };
  return (
    <Dialog title="Fields" onClose={onClose} width={520} testID="fields-panel" actions={[{ label: "Done", primary: true, onPress: onClose, testID: "fields-panel-done" }]}>
      <ScrollView style={s.scroll} contentContainerStyle={s.list} testID="fields-panel-list">
        {rows}
        {adding ? (
          <View style={s.add} testID="panel-add-form">
            <TextField value={newName} onChangeText={(t) => { setNewName(t); change.clearError(); }} placeholder="Field name" accessibilityLabel="Field name" testID="panel-add-name" autoFocus onSubmitEditing={submitAdd} />
            <View style={s.chips} accessibilityRole="radiogroup">
              {choices.map((t) => (
                <TextButton key={t.key} label={t.title} selected={newType === t.key} testID={`panel-add-type-${t.key}`} onPress={() => setNewType(t.key)} />
              ))}
            </View>
            <View style={s.addRow}>
              <TextButton label={newRequired ? "Required" : "Not required"} selected={newRequired} testID="panel-add-required" onPress={() => setNewRequired((r) => !r)} />
              <View style={s.grow} />
              <TextButton label="Cancel" testID="panel-add-cancel" onPress={() => { setAdding(false); change.cancel(); }} />
              <TextButton label="Add field" primary testID="panel-add-save" off={!addReady || change.busy ? true : undefined} onPress={submitAdd} />
            </View>
            {change.error && open === null ? <Text style={s.error} accessibilityRole="alert" testID="panel-error">{change.error}</Text> : null}
          </View>
        ) : (
          <View style={s.addLink}><TextButton label="Add field" testID="panel-add" onPress={() => { change.cancel(); setOpen(null); setMode(null); setAdding(true); }} /></View>
        )}
        <View style={s.trash} testID="panel-groups">
          <Text style={s.head}>Groups</Text>
          {groupRows}
          {newGroup !== null ? (
            <View style={s.inline}>
              <View style={s.grow}><TextField value={newGroup} onChangeText={setNewGroup} placeholder="Group name" accessibilityLabel="Group name" testID="panel-group-name" autoFocus onSubmitEditing={submitGroup} /></View>
              <TextButton label="Cancel" testID="panel-group-cancel" onPress={() => setNewGroup(null)} />
              <TextButton label="Add group" primary testID="panel-group-save" off={!groupReady || groupBusy ? true : undefined} onPress={submitGroup} />
            </View>
          ) : <View style={s.addLink}><TextButton label="New group" testID="panel-group-new" onPress={() => { setGroupError(null); setNewGroup(""); }} /></View>}
          {groupError ? <Text style={s.error} accessibilityRole="alert" testID="panel-group-error">{groupError}</Text> : null}
        </View>
        {lost.length > 0 ? (
          <View style={s.trash} testID="panel-trash">
            <Text style={s.head}>Recently deleted</Text>
            {lost.map((t) => (
              <Row
                key={`${t.type}:${t.field}`} id={`panel-trash-${t.field}`} title={t.field!} note={`${t.rows} ${t.rows === 1 ? "value" : "values"} · Kept until ${new Date(t.expiresAt).toLocaleDateString()}`}
                trailing={<TextButton label="Restore" testID={`panel-restore-${t.field}`} onPress={() => { void call("schema.restore_field", { type: t.type, field: t.field }).then(readTrash, (e: unknown) => { void e; }); }} />}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Dialog>
  );
}

function FieldEdit({ f, type, order, mode, setMode, name, setName, choices, change, run, groups, inGroup, groupBusy, onGroup }: {
  f: FieldDef; type: PanelType; order: readonly string[]; mode: FieldMode | null; setMode(m: FieldMode | null): void; name: string; setName(n: string): void;
  choices: readonly FieldTypeInfo[]; change: ReturnType<typeof useSchemaChange>; run(ops: Parameters<ReturnType<typeof useSchemaChange>["run"]>[0], done?: () => void): void;
  groups: readonly LayoutSection[]; inGroup: string | null; groupBusy: boolean; onGroup(to: string | null): void;
}): ReactElement {
  const retypeOff = retypeBlocked(type, f, type.titleField, f.key);
  const deleteOff = fieldDeleteBlocked(type, f);
  const at = order.indexOf(f.key);
  const up = moveFieldOps(type.key, order, f.key, -1), down = moveFieldOps(type.key, order, f.key, 1);
  const staged = change.staged;
  return (
    <View style={s.edit} testID={`panel-edit-${f.key}`}>
      {mode === null ? (
        <View style={s.actions}>
          <TextButton label="Rename" testID={`panel-rename-${f.key}`} onPress={() => { setName(f.title); setMode("rename"); }} />
          <TextButton label="Change type" testID={`panel-retype-${f.key}`} off={retypeOff ?? undefined} onPress={() => setMode("type")} />
          <TextButton label={f.required ? "Make optional" : "Make required"} testID={`panel-required-${f.key}`} off={type.system ? "Built in fields keep this setting" : change.busy ? true : undefined} onPress={() => run(requiredOps(type.key, f.key, f.required !== true))} />
          <TextButton label="Move up" testID={`panel-up-${f.key}`} off={up === null || at <= 0 ? "Already first" : change.busy ? true : undefined} onPress={() => { if (up) run(up); }} />
          <TextButton label="Move down" testID={`panel-down-${f.key}`} off={down === null ? "Already last" : change.busy ? true : undefined} onPress={() => { if (down) run(down); }} />
          <TextButton label="Move to group" testID={`panel-group-move-${f.key}`} off={f.key === type.titleField ? "The title stays at the top" : undefined} onPress={() => setMode("group")} />
          <TextButton label="Delete" danger testID={`panel-delete-${f.key}`} off={deleteOff ?? undefined} onPress={() => { setMode("delete"); run(dropFieldOps(type.key, f.key)); }} />
        </View>
      ) : null}
      {mode === "rename" ? (
        <View style={s.inline}>
          <View style={s.grow}><TextField value={name} onChangeText={(t) => { setName(t); change.clearError(); }} accessibilityLabel={`Rename ${f.title}`} testID={`panel-rename-input-${f.key}`} autoFocus onSubmitEditing={() => { if (name.trim()) run(renameFieldOps(type.key, f.key, name)); }} /></View>
          <TextButton label="Cancel" onPress={() => setMode(null)} testID="panel-rename-cancel" />
          <TextButton label="Save" primary testID="panel-rename-save" off={name.trim() === "" || change.busy ? true : undefined} onPress={() => run(renameFieldOps(type.key, f.key, name))} />
        </View>
      ) : null}
      {mode === "type" && staged === null ? (
        <View>
          <View style={s.chips} accessibilityRole="radiogroup">
            {choices.map((t) => {
              const why = retypeTarget(f.type, t.key);
              return <TextButton key={t.key} label={t.title} selected={f.type === t.key} testID={`panel-to-${t.key}`} off={why ?? (change.busy ? true : undefined)} onPress={() => run(retypeFieldOps(type.key, f.key, t.key))} />;
            })}
          </View>
          <View style={s.addRow}><View style={s.grow} /><TextButton label="Cancel" onPress={() => setMode(null)} testID="panel-retype-cancel" /></View>
        </View>
      ) : null}
      {mode === "group" ? (
        <View>
          {groups.length === 0 ? <Text style={s.hint} testID="panel-group-none">Make a group first, under Groups below.</Text> : (
            <View style={s.chips} accessibilityRole="radiogroup">
              <TextButton label="Ungrouped" selected={inGroup === null} testID={`panel-to-group-${OVERVIEW}`} off={groupBusy ? true : undefined} onPress={() => onGroup(null)} />
              {groups.map((g) => <TextButton key={g.key} label={g.title} selected={inGroup === g.key} testID={`panel-to-group-${g.key}`} off={groupBusy ? true : undefined} onPress={() => onGroup(g.key)} />)}
            </View>
          )}
          <View style={s.addRow}><View style={s.grow} /><TextButton label="Back" onPress={() => setMode(null)} testID="panel-group-back" /></View>
        </View>
      ) : null}
      {mode === "delete" && staged === null && !change.busy ? <View style={s.addRow}><View style={s.grow} /><TextButton label="Back" onPress={() => { change.cancel(); setMode(null); }} testID="panel-delete-back" /></View> : null}
      {staged !== null ? (
        <ConfirmLine
          text={confirmLine(staged.ops[0]?.op === "field.drop" ? "field.drop" : "field.retype", f.title, staged.rows)} busy={change.busy}
          confirmLabel={staged.ops[0]?.op === "field.drop" ? "Delete" : "Change type"}
          onConfirm={() => { void change.confirm().then((ok) => { if (ok) setMode(null); }); }} onCancel={() => { change.cancel(); setMode(null); }}
        />
      ) : null}
      {change.error ? <Text style={s.error} accessibilityRole="alert" testID="panel-error">{change.error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { maxHeight: 460 },
  list: { gap: 2 },
  eye: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  eyeOver: { backgroundColor: "var(--hover)" as string },
  eyeOff: { opacity: 0.4 },
  edit: { paddingHorizontal: 10, paddingBottom: 8, paddingTop: 2, gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  grow: { flex: 1 },
  add: { gap: 8, padding: 10, marginTop: 6, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  addLink: { marginTop: 6, alignItems: "flex-start" },
  trash: { marginTop: 14, gap: 2 },
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingBottom: 4 },
  hint: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingVertical: 4 },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
