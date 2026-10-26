// agent.toml as a form (spec 2.14, vyre-v1.html .tform): the groups in the prototype's order (Identity, Model, Whose AI account, then the tables the file has: Tools, Permissions, Approvals, Vault, Limits, Memory,
// Computer, Routines, Watchers, Handoff, Logging), each key a ui/Row with its words on the left and a full-width control: a text box, a switch, or a picker whose menu changes the draft (Owner with the person's face,
// Primary and Fallback by model name). A key the file does not have yet reads Not set and is written into its table when it gets a value. Keys the form has no field for still show, as text.
// Every edit rewrites its own line of the text, so the Form and the Text view are the same file and the history pane's diff shows exactly what the form changed.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useReviewData } from "./data.tsx";
import { MODEL_CHOICES, formValue, humanKey, parseToml, rawFromForm, setTomlValue, tomlKind } from "./model.ts";
import type { TomlEntry } from "./model.ts";
import { PickerButton, Switch, TextField, anchorOf } from "./parts.tsx";
import { FORM_GROUPS, extraEntries, fieldText, isNumberText, listItems, listRaw, modelLabel, pickLabel, rawFor, tablesNamed, tomlTables, writeField } from "./tomlFields.ts";
import type { FormField, FormGroup, TomlTable } from "./tomlFields.ts";

/** A problem the lint found, shown under the key on its line. */
export interface TomlIssue {
  line?: number;
  severity: "info" | "warn" | "error";
  message: string;
}

export interface TomlFormProps {
  text: string;
  onChange(text: string): void;
  readOnly?: boolean;
  /** The lint's problems; the ones with a line show under that key. */
  issues?: readonly TomlIssue[];
}

/** What a field is for the control: where it is written, and what it holds now. */
interface Slot {
  field: FormField;
  entry: TomlEntry | undefined;
  table: TomlTable | undefined;
  section: string;
  /** A stable id for test ids and keys. */
  id: string;
}

interface Shared {
  text: string;
  onChange(text: string): void;
  readOnly: boolean;
}

/** A text box that keeps what is being typed until it reads as a value: a number field holds back a half-typed number and says what it needs. */
function TextBox({ slot, shared, label }: { slot: Slot; shared: Shared; label: string }): ReactElement {
  const { field, entry } = slot;
  const value = fieldText(field, entry);
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [bad, setBad] = useState(false);
  if (value !== seen) { setSeen(value); setDraft(value); setBad(false); }
  const write = (v: string): void => {
    setDraft(v);
    if (field.kind === "number" && v.trim() !== "" && !isNumberText(v)) { setBad(true); return; }
    setBad(false);
    if (field.kind === "number" && v.trim() === "") return;
    shared.onChange(writeField(shared.text, field, entry, slot.table, slot.section, rawFor(field, v, entry)));
  };
  return (
    <View style={st.box}>
      <TextField form value={draft} onChange={write} label={label} placeholder={entry ? "" : "Not set"} testID={`toml-field:${slot.id}`} />
      {bad ? <Text style={[st.hint, st.hintErr]} testID={`toml-hint:${slot.id}`} role="alert">That field needs a number</Text> : null}
    </View>
  );
}

/** The control of one key. */
function Control({ slot, shared, people }: { slot: Slot; shared: Shared; people: readonly { id: string; name: string }[] }): ReactElement {
  const { field, entry } = slot;
  const { element, show } = useMenu();
  const label = field.label;
  const write = (raw: string): void => shared.onChange(writeField(shared.text, field, entry, slot.table, slot.section, raw));
  if (entry && (entry.end > entry.line || shared.readOnly)) return <Text style={st.fixed} numberOfLines={1} testID={`toml-fixed:${slot.id}`}>{formValue(entry.raw)}</Text>;
  if (!entry && shared.readOnly) return <Text style={st.fixed} testID={`toml-fixed:${slot.id}`}>Not set</Text>;
  const open = (items: readonly MenuEntry[]) => (e: unknown): void => {
    const at = anchorOf(e);
    show(items, at.x, at.y, "other");
  };
  const raw = entry?.raw ?? "";
  const value = entry ? formValue(raw) : "";
  const tid = `toml-select:${slot.id}`;
  if (field.kind === "bool") {
    return <View style={st.sw}><Switch on={raw.trim() === "true"} onChange={(on) => write(on ? "true" : "false")} label={label} testID={`toml-switch:${slot.id}`} /></View>;
  }
  if (field.kind === "enum" && field.choices) {
    const choices = field.choices;
    const items: MenuEntry[] = choices.map((c) => ({ label: c.label, checked: c.id === value, onSelect: () => write(`"${c.id}"`) }));
    return <><PickerButton label={label} shown={entry ? pickLabel(choices, value) : "Not set"} onPress={open(items)} testID={tid} />{element}</>;
  }
  if (field.kind === "model") {
    const items: MenuEntry[] = [{ head: "Model" }, ...MODEL_CHOICES.map((c): MenuEntry => ({ label: c.label, checked: c.id === value, onSelect: () => write(`"${c.id}"`) }))];
    return <><PickerButton label={label} shown={entry && value ? modelLabel(value) : "Not set"} onPress={open(items)} testID={tid} />{element}</>;
  }
  if (field.kind === "models") {
    const have = entry ? listItems(raw) : [];
    const toggle = (id: string): void => write(listRaw(have.includes(id) ? have.filter((x) => x !== id) : [...have, id]));
    const items: MenuEntry[] = [{ head: "Tried in order if the main model fails" }, ...MODEL_CHOICES.map((c): MenuEntry => ({ label: c.label, checked: have.includes(c.id), onSelect: () => toggle(c.id) }))];
    return <><PickerButton label={label} shown={have.length ? have.map(modelLabel).join(", ") : "None"} onPress={open(items)} testID={tid} />{element}</>;
  }
  if (field.kind === "owner") {
    const who = people.some((p) => p.id === value) || !value ? people : [...people, { id: value, name: value }];
    const name = who.find((p) => p.id === value)?.name ?? "";
    const items: MenuEntry[] = who.map((p) => ({ label: p.name, checked: p.id === value, onSelect: () => write(`"${p.id}"`) }));
    return (
      <>
        <PickerButton label={label} shown={name || "Not set"} onPress={open(items)} testID={tid} {...(name ? { leading: <Avatar name={name} seedId={value} kind="person" size={18} /> } : {})} />
        {element}
      </>
    );
  }
  return <TextBox slot={slot} shared={shared} label={label} />;
}

/** A key the form has no field for: a switch for true and false, a text box for the rest, the way the file reads. */
function ExtraControl({ entry, shared, section }: { entry: TomlEntry; shared: Shared; section: string }): ReactElement {
  const kind = tomlKind(entry.raw);
  const label = `${section ? `${humanKey(section)} ` : ""}${humanKey(entry.key)}`;
  if (entry.end > entry.line || shared.readOnly) return <Text style={st.fixed} numberOfLines={1} testID={`toml-fixed:${entry.line}`}>{formValue(entry.raw)}</Text>;
  if (kind === "bool") return <View style={st.sw}><Switch on={entry.raw.trim() === "true"} onChange={(on) => shared.onChange(setTomlValue(shared.text, entry, on ? "true" : "false"))} label={label} testID={`toml-switch:${entry.line}`} /></View>;
  return <TextField form mono={kind !== "string"} value={formValue(entry.raw)} onChange={(v) => shared.onChange(setTomlValue(shared.text, entry, rawFromForm(kind, v)))} label={label} testID={`toml-field:${entry.line}`} />;
}

function Hints({ issues, line }: { issues: readonly TomlIssue[]; line: number | undefined }): ReactElement | null {
  if (line === undefined) return null;
  const here = issues.filter((i) => i.line === line);
  if (!here.length) return null;
  // ui-rows-lint: not a list (the lint's messages under a key, plain text lines)
  return <View style={st.hints}>{here.map((i) => <Text key={`${i.severity}${i.message}`} style={[st.hint, i.severity === "error" ? st.hintErr : st.hintWarn]}>{i.message}</Text>)}</View>;
}

export function TomlForm({ text, onChange, readOnly = false, issues = [] }: TomlFormProps): ReactElement {
  const data = useReviewData();
  const [width, setWidth] = useState(0);
  const found = parseToml(text);
  if (!found.length) return <View style={st.wrap} testID="toml-form"><Text style={st.empty}>Nothing in agent.toml yet. Switch to Text to write the first line.</Text></View>;
  const shared: Shared = { text, onChange, readOnly };
  const tables = tomlTables(text);
  const people = data.people ?? [];
  // The label takes what the control leaves: 170 px on a desktop page, less on a phone (the prototype's .ff grid).
  const inner = Math.max(0, (width || 760) - 40);
  const label = inner < 460 ? 110 : 170;
  const box = Math.max(150, inner - 24 - label);
  const known = new Set(FORM_GROUPS.map((g) => g.section));

  const line = (key: string, title: string, control: ReactElement, at: number | undefined): ReactElement => (
    <View key={key}>
      <Row id={key} title={title} trailing={<View style={[st.ctl, { width: box }]}>{control}</View>} domProps={{ style: ROW_STYLE }} />
      <Hints issues={issues} line={at} />
    </View>
  );

  const groupBlock = (g: FormGroup): ReactElement | null => {
    const ts = tablesNamed(tables, g.section);
    if (!ts.length && !g.always) return null;
    const blocks: (TomlTable | undefined)[] = ts.length ? ts : [undefined];
    return (
      <View key={g.section} style={st.group} testID={`toml-group:${g.section}`}>
        <Text accessibilityRole="header" aria-level={3} style={st.head}>{g.title}{g.multi ? <Text style={st.count}>{`  ${ts.length}`}</Text> : null}</Text>
        {/* ui-rows-lint: not a list (one block per [[table]]; each block's lines are ui/Row) */}
        {blocks.map((t, ti) => {
          const rows: ReactElement[] = [];
          g.fields.forEach((f) => {
            const entry = t?.entries.find((e) => e.key === f.key);
            const idn = `${g.section}${g.multi ? `#${ti + 1}` : ""}.${f.key}`;
            const slot: Slot = { field: f, entry, table: t, section: g.section, id: entry ? String(entry.line) : idn };
            rows.push(line(`toml:${slot.id}`, f.label, <Control slot={slot} shared={shared} people={people} />, entry?.line));
          });
          if (t) for (const e of extraEntries(t, g)) rows.push(line(`toml:${e.line}`, humanKey(e.key), <ExtraControl entry={e} shared={shared} section={g.section} />, e.line));
          const idKey = t?.entries.find((e) => e.key === "id");
          return (
            <View key={t ? t.line : "none"} style={ti > 0 ? st.block : undefined}>
              {g.multi && ts.length > 1 ? <Text style={st.blockName}>{`${g.title.replace(/s$/, "")} ${ti + 1}${idKey ? ` · ${formValue(idKey.raw)}` : ""}`}</Text> : null}
              {rows}
            </View>
          );
        })}
      </View>
    );
  };

  // Tables the form has no group for, and keys above the first table, as plain groups in file order.
  const strays: ReactElement[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    if (t.name !== "" && known.has(t.name)) continue;
    const entries = t.entries.filter((e) => !(t.name === "" && e.key === "schema"));
    if (!entries.length) continue;
    const title = t.name === "" ? "General" : humanKey(t.name.replace(/\[\]$/, ""));
    const key = `${t.name || "top"}@${t.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    strays.push(
      <View key={key} style={st.group} testID={`toml-group:${t.name || "top"}`}>
        <Text accessibilityRole="header" aria-level={3} style={st.head}>{title}</Text>
        {entries.map((e) => line(`toml:${e.line}`, humanKey(e.key), <ExtraControl entry={e} shared={shared} section={t.name} />, e.line))}
      </View>,
    );
  }

  return (
    <View style={st.wrap} testID="toml-form" role="form" aria-label="agent.toml as a form" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {/* ui-rows-lint: not a list (table sections; each section is a heading and its ui/Row lines) */}
      {FORM_GROUPS.map(groupBlock)}
      {strays}
      {readOnly ? <Text style={st.note}>Only the owner edits agent.toml. Changes go through a diff first.</Text> : null}
    </View>
  );
}

/** A form line is 38 px (the prototype's .ff: a 30 px control with 4 px above and below), and it does not look pressable. */
const ROW_STYLE = { height: 38, cursor: "default" };

const st = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 760, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, alignSelf: "center" },
  group: { paddingTop: 18, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" },
  head: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingBottom: 8 },
  count: { fontWeight: "500", color: "var(--ink-4)" as string },
  block: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "var(--line)", borderStyle: "dashed" },
  blockName: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingBottom: 6 },
  ctl: { justifyContent: "center" },
  box: { width: "100%" },
  sw: { flexDirection: "row", alignItems: "center", height: 30 },
  fixed: { fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink-3)" as string },
  hints: { paddingLeft: 8, paddingBottom: 4 },
  hint: { fontSize: 12, marginTop: 4, color: "var(--ink-3)" as string },
  hintErr: { color: "var(--danger)" as string },
  hintWarn: { color: "var(--warn)" as string },
  note: { marginTop: 18, fontSize: 12.5, color: "var(--ink-3)" as string },
  empty: { fontSize: 13, color: "var(--ink-3)" as string, paddingVertical: 20 },
});
