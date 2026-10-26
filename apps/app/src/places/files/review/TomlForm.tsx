// agent.toml as a form (spec 2.14, vyre-v1.html .tform): the keys of each table as ui/Row lines with the value on the right: a switch for true and false, a text box for the rest.
// Every edit rewrites its own line of the text, so the Form and the Text view are the same file and the diff before a save shows exactly what the form changed.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { TOML_CHOICES, choiceOf, choiceRaw, formValue, humanKey, parseToml, rawFromForm, setTomlValue, tomlGroups, tomlKind } from "./model.ts";
import type { TomlEntry } from "./model.ts";
import { Select, Switch, TextField } from "./parts.tsx";

export interface TomlFormProps {
  text: string;
  onChange(text: string): void;
  readOnly?: boolean;
}

function Control({ entry, text, onChange, readOnly }: { entry: TomlEntry; text: string; onChange(t: string): void; readOnly: boolean }): ReactElement {
  const kind = tomlKind(entry.raw);
  const label = `${entry.section ? `${humanKey(entry.section)} ` : ""}${humanKey(entry.key)}`;
  if (entry.end > entry.line || readOnly) return <Text style={st.fixed} numberOfLines={1} testID={`toml-fixed:${entry.line}`}>{formValue(entry.raw)}</Text>;
  const pick = choiceOf(entry.key, entry.raw);
  const choices = TOML_CHOICES[entry.key];
  if (pick && choices) return <Select value={pick.id} choices={choices} label={humanKey(entry.key)} testID={`toml-select:${entry.line}`} onChange={(id) => onChange(setTomlValue(text, entry, choiceRaw(id, pick.list)))} />;
  if (kind === "bool") return <Switch on={entry.raw.trim() === "true"} onChange={(on) => onChange(setTomlValue(text, entry, on ? "true" : "false"))} label={label} testID={`toml-switch:${entry.line}`} />;
  return <TextField compact mono={kind !== "string"} width={260} value={formValue(entry.raw)} onChange={(v) => onChange(setTomlValue(text, entry, rawFromForm(kind, v)))} label={label} testID={`toml-field:${entry.line}`} />;
}

export function TomlForm({ text, onChange, readOnly = false }: TomlFormProps): ReactElement {
  const groups = tomlGroups(parseToml(text));
  if (!groups.length) return <View style={st.wrap} testID="toml-form"><Text style={st.empty}>Nothing in agent.toml yet. Switch to Text to write the first line.</Text></View>;
  return (
    <View style={st.wrap} testID="toml-form" role="form" aria-label="agent.toml as a form">
      {/* ui-rows-lint: not a list (table sections; each section is a heading and its ui/Row lines) */}
      {groups.map((g) => (
        <View key={g.section || "top"} style={st.group}>
          <Text accessibilityRole="header" aria-level={3} style={st.head}>{humanKey(g.section || "General")}</Text>
          {g.entries.map((e) => (
            <Row key={e.line} id={`toml:${e.line}`} title={humanKey(e.key)} trailing={<Control entry={e} text={text} onChange={onChange} readOnly={readOnly} />} />
          ))}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 760, paddingHorizontal: 20, paddingVertical: 8, alignSelf: "center" },
  group: { paddingTop: 14, paddingBottom: 6 },
  head: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingBottom: 6 },
  fixed: { maxWidth: 210, fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink-3)" as string },
  empty: { fontSize: 13, color: "var(--ink-3)" as string, paddingVertical: 20 },
});
