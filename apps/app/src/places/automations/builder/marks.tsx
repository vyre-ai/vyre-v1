// Preview is a product mark, not a catalog flag. AI and code stay visibly unfinished.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { filterShelf, shelfRows } from "./fields.ts";
import { ABSENCE, DATA_SHELF_NAME, INSPECTOR_TABS, SHELF_SEARCH } from "../chrome.ts";
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
  const items = INSPECTOR_TABS.map((label) => ({ key: label.toLowerCase() as "configure" | "data" | "test", label }));
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

/** Basic and Advanced both write this object. A number stays a number. Null and empty stay apart. */
export function basicFieldEdit(input: Record<string, unknown>, name: string, text: string): Record<string, unknown> {
  const has = Object.prototype.hasOwnProperty.call(input, name);
  const current = has ? input[name] : undefined;
  const presence = presenceOf(has, current);
  const nextPresence: Presence = presence === "null" && text === "" ? "null" : presence === "empty" && text === "" ? "empty" : presence === "missing" && text === "" ? "missing" : "value";
  const written = commitTyped(has ? current : "", text, nextPresence);
  const next = { ...input };
  if (written === undefined) delete next[name];
  else next[name] = written;
  return next;
}

/** The Advanced JSON editor. The object it returns is the same input Basic edits one field at a time. */
export function advancedInputEdit(text: string): { ok: true; input: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, message: "That is not valid JSON." };
    return { ok: true, input: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: "That is not valid JSON." };
  }
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
  const [query, setQuery] = useState("");
  const rows = filterShelf(shelfRows(triggerSample, steps), query);
  const empty = shelfRows(triggerSample, steps).length === 0;
  return (
    <View testID="data-shelf" style={m.shelf}>
      <Text style={m.label}>{DATA_SHELF_NAME}</Text>
      <TextInput accessibilityLabel={SHELF_SEARCH} placeholder={SHELF_SEARCH} value={query} onChangeText={setQuery} testID="data-shelf-search" style={m.input} />
      {empty ? <Text testID="data-shelf-empty" style={m.hint}>No sample yet. Test a step or run to fill this shelf.</Text> : null}
      {!empty && rows.length === 0 ? <Text style={m.hint}>No fields match.</Text> : null}
      {rows.map((row) => (
        <View key={row.id} style={m.row}>
          <Text style={m.hint}>{row.name}</Text>
          <Text style={m.hint}>{`${row.source} · ${row.typeName}${row.presence === "value" ? "" : ` · ${row.presence}`}`}</Text>
        </View>
      ))}
      <Text style={m.label}>Typed absence</Text>
      <View style={m.secs}>
        {ABSENCE.map((label) => <Text key={label} style={m.hint}>{label}</Text>)}
      </View>
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
  row: { gap: 2, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
});
