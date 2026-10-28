// Preview is a product mark, not a catalog flag. AI and code stay visibly unfinished.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { shelfLines } from "./fields.ts";
import { PREVIEW_NOTE } from "../catalog/model.ts";
import { literalFromEditor, mappingIssues, presenceOf, refValue, typeOf } from "../values/typed.ts";
import type { Presence, TypeRef } from "../values/typed.ts";
import type { Definition } from "../canvas/model.ts";

export function PreviewMark({ testID }: { testID: string }): ReactElement {
  return (
    <View testID={testID} accessibilityLabel={PREVIEW_NOTE} style={m.badge}>
      <Text style={m.badgeText}>Preview</Text>
    </View>
  );
}

export function SectionRow({ section, onSection }: { section: "configure" | "data" | "test"; onSection(next: "configure" | "data" | "test"): void }): ReactElement {
  const items: { key: "configure" | "data" | "test"; label: string }[] = [
    { key: "configure", label: "Configure" },
    { key: "data", label: "Data" },
    { key: "test", label: "Test" },
  ];
  return (
    <View style={m.secs} accessibilityRole="tablist">
      {items.map((item) => (
        <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: section === item.key }} testID={`section-${item.key}`} onPress={() => onSection(item.key)} style={[m.sec, section === item.key && m.secOn]}>
          <Text style={[m.secText, section === item.key && m.secTextOn]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function isRef(value: unknown): value is { kind: "ref"; nodeId: string; path: string; valueType?: string } {
  return !!value && typeof value === "object" && (value as { kind?: string }).kind === "ref" && typeof (value as { nodeId?: unknown }).nodeId === "string";
}

/** Writes a field back without collapsing missing, null, empty, numbers, or booleans. */
export function commitTyped(current: unknown, text: string, presence: Presence): unknown {
  if (isRef(current)) {
    const dot = text.indexOf(".");
    const nodeId = dot > 0 ? text.slice(0, dot) : current.nodeId;
    const path = dot > 0 ? text.slice(dot + 1) : current.path;
    return refValue(nodeId, path, (current.valueType as TypeRef | undefined) ?? "unknown");
  }
  const kind = typeOf(current);
  const valueType: TypeRef = kind === "unknown" ? "string" : kind;
  return literalFromEditor(presence, text, valueType);
}

export function TypedValue({ label, value, hasKey, onCommit, testID }: {
  label: string;
  value: unknown;
  hasKey: boolean;
  onCommit(next: unknown, presence: Presence): void;
  testID?: string;
}): ReactElement {
  const presence = presenceOf(hasKey, value);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (presence === "null" ? "" : presence === "missing" ? "" : isRef(value) ? `${value.nodeId}.${value.path}` : value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));
  const done = (): void => {
    if (draft === null) return;
    const nextPresence: Presence = presence === "null" && draft === "" ? "null" : presence === "empty" && draft === "" ? "empty" : presence === "missing" && draft === "" ? "missing" : "value";
    onCommit(commitTyped(value, draft, nextPresence), nextPresence);
    setDraft(null);
  };
  return (
    <View style={m.field}>
      <Text style={m.label}>{`${label}${presence === "value" ? "" : ` (${presence})`}`}</Text>
      <TextInput accessibilityLabel={label} testID={testID} value={shown} onChangeText={setDraft} onBlur={done} onSubmitEditing={done} style={m.input} />
    </View>
  );
}

export function MappingFix({ nodeIds, value }: { nodeIds: ReadonlySet<string>; value: unknown }): ReactElement | null {
  const issues = mappingIssues(nodeIds, value);
  if (issues.length === 0) return null;
  const first = issues[0]!;
  const why = first.reason === "missing" ? `node ${first.nodeId} is not in this Automation` : `the type at ${first.nodeId}.${first.path} does not match the field`;
  return <Text testID="fix-mapping" style={m.fix}>{`Fix this mapping. ${why}.`}</Text>;
}

export function DataShelf({ triggerSample, steps }: { triggerSample: unknown; steps: readonly { id: string; title: string; output: unknown }[] }): ReactElement {
  const lines = shelfLines(triggerSample, steps);
  if (lines.length === 0) {
    return <Text testID="data-shelf-empty" style={m.hint}>No sample yet. Test a step or run to fill this shelf.</Text>;
  }
  return (
    <View testID="data-shelf" style={m.shelf}>
      {lines.map((line) => <Text key={line.id} style={m.hint}>{line.text}</Text>)}
    </View>
  );
}

export function nodeIdSet(def: Definition): Set<string> {
  return new Set(def.nodes.map((node) => node.id));
}

const m = StyleSheet.create({
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "var(--hover)" as string, borderWidth: 1, borderColor: "var(--warn)" as string },
  badgeText: { fontSize: 10, fontWeight: "700", color: "var(--warn)" as string, letterSpacing: 0.2 },
  secs: { flexDirection: "row", gap: 4 },
  sec: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  secOn: { backgroundColor: "var(--hover)" as string },
  secText: { fontSize: 12, color: "var(--ink-3)" as string },
  secTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  field: { gap: 4 },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string },
  input: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 9, fontSize: 13, color: "var(--ink)" as string },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  fix: { fontSize: 12.5, lineHeight: 17, color: "var(--warn)" as string },
  shelf: { gap: 6 },
});
