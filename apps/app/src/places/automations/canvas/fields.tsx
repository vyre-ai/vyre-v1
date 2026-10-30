// The small inputs the step panel is made of: a labelled text field (one line or several), a choice that opens a menu, a group with a head, a hint, and rows of name and value. They were the
// Inspector's own; the HTTP request, Run code and AI forms (steps/) use the same ones so every step panel looks and behaves alike.
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Glyph } from "./icons.tsx";
import { IconButton, pointer, webOnly } from "./parts.tsx";
import type { Pair } from "./steps/edits.ts";

/** The field a person last had in hand. The Data shelf puts the data a person picks into it, so mapping works from the keyboard and the mouse alike. */
export interface MapTarget { label: string; value: string; commit(next: string): void }
export const MapTargetContext = createContext<{ set(t: MapTarget | null): void } | null>(null);

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/** A labelled text field. The value commits on blur and on Enter (one line); Escape puts the old value back. `rows` makes it a box of several lines. */
export function Field({ label, value, onCommit, placeholder, mono = false, readOnly = false, testID, rows, invalid }: {
  label: string; value: string; onCommit(v: string): void; placeholder?: string; mono?: boolean; readOnly?: boolean; testID?: string; rows?: number; invalid?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const map = useContext(MapTargetContext);
  const shown = draft ?? value;
  const done = (): void => { if (draft !== null && draft !== value) onCommit(draft); map?.set({ label, value: shown, commit: onCommit }); setDraft(null); };
  return (
    <View style={f.field}>
      <Text style={f.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        testID={testID}
        value={shown}
        editable={!readOnly}
        placeholder={placeholder}
        placeholderTextColor="var(--ink-4)"
        onChangeText={setDraft}
        onFocus={() => map?.set({ label, value: shown, commit: onCommit })}
        onBlur={done}
        {...(rows ? { multiline: true, numberOfLines: rows } : { onSubmitEditing: done })}
        {...webOnly({ onKeyDown: (e: { key?: string }) => { if (e.key === "Escape") setDraft(null); } })}
        style={[f.input, rows ? { height: Math.max(60, rows * 18 + 12), paddingTop: 7, textAlignVertical: "top" } : null, mono && { fontFamily: MONO }, readOnly && { opacity: 0.6 }, invalid && { borderColor: "var(--danger)" as string }]}
      />
    </View>
  );
}

export function Choice({ label, value, onOpen, testID }: { label: string; value: string; onOpen(x: number, y: number): void; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <View style={f.field}>
      <Text style={f.label}>{label}</Text>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} testID={testID}
        onPress={(e) => { const ev = e as unknown as { nativeEvent?: { pageX?: number; pageY?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }; const r = ev.currentTarget?.getBoundingClientRect?.(); onOpen(r?.left ?? ev.nativeEvent?.pageX ?? 0, (r?.bottom ?? ev.nativeEvent?.pageY ?? 0) + 4); }}
        onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
        style={[f.choice, over && { backgroundColor: "var(--hover)" as string }, pointer]}
      >
        <Text numberOfLines={1} style={f.choiceText}>{value}</Text>
        <Glyph name="chevD" size={12} color="var(--ink-3)" />
      </Pressable>
    </View>
  );
}

export function Hint({ children, testID, danger = false }: { children: ReactNode; testID?: string; danger?: boolean }): ReactElement {
  return <Text testID={testID} style={[f.hint, danger && { color: "var(--danger)" as string }]}>{children}</Text>;
}

export function Group({ head, children, testID }: { head: string; children: ReactNode; testID?: string }): ReactElement {
  return (
    <View style={f.group} testID={testID}>
      <Text style={f.groupHead}>{head}</Text>
      {children}
    </View>
  );
}

/**
 * Rows of a name and a value (the query, the headers, the data a step is given). Each row commits on blur; the x takes a row away; Add puts a blank row at the end.
 * The rows are kept here while they are typed: a row whose name `check` refuses stays on the screen with the reason, and is not in what the parent was given (`valid` rows only).
 * When the saved rows change from outside (Undo, the JSON editor) the rows here follow them.
 */
export function Rows({ label, pairs, onCommit, keyLabel = "Name", valueLabel = "Value", addLabel, testID, check }: {
  label: string; pairs: readonly Pair[]; onCommit(valid: Pair[]): void; keyLabel?: string; valueLabel?: string; addLabel: string; testID: string;
  check?: (name: string) => string | null;
}): ReactElement {
  const [local, setLocal] = useState<Pair[]>(() => [...pairs]);
  const map = useContext(MapTargetContext);
  const isValid = (p: Pair): boolean => p.key.trim() !== "" && !(check && check(p.key));
  const saved = JSON.stringify(pairs);
  useEffect(() => {
    if (JSON.stringify(local.filter(isValid)) !== saved) setLocal([...pairs]);
    // follow the saved rows only when they change from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
  const write = (next: Pair[]): void => { setLocal(next); onCommit(next.filter(isValid)); };
  const edit = (n: number, patch: Partial<Pair>): void => setLocal(local.map((p, at) => (at === n ? { ...p, ...patch } : p)));
  const problems: string[] = [];
  const rowEls: ReactElement[] = [];
  local.forEach((p, n) => {
    const problem = check ? check(p.key) : null;
    if (problem) problems.push(problem);
    rowEls.push(
      <View key={`${testID}-${n}`} style={f.pair}>
        <TextInput
          accessibilityLabel={`${label} ${keyLabel.toLowerCase()} ${n + 1}`} testID={`${testID}-key-${n}`} value={p.key} placeholder={keyLabel} placeholderTextColor="var(--ink-4)"
          onChangeText={(t) => edit(n, { key: t })} onBlur={() => write(local)}
          style={[f.input, f.pairKey, problem ? { borderColor: "var(--danger)" as string } : null]}
        />
        <TextInput
          accessibilityLabel={`${label} ${valueLabel.toLowerCase()} ${n + 1}`} testID={`${testID}-value-${n}`} value={p.value} placeholder={valueLabel} placeholderTextColor="var(--ink-4)"
          onChangeText={(t) => edit(n, { value: t })} onBlur={() => { write(local); map?.set({ label: `${label} ${valueLabel.toLowerCase()} ${n + 1}`, value: local[n]?.value ?? "", commit: (v) => write(local.map((q, at) => (at === n ? { ...q, value: v } : q))) }); }}
          onFocus={() => map?.set({ label: `${label} ${valueLabel.toLowerCase()} ${n + 1}`, value: p.value, commit: (v) => write(local.map((q, at) => (at === n ? { ...q, value: v } : q))) })}
          style={[f.input, f.pairValue]}
        />
        <IconButton icon="x" label={`Remove ${label.toLowerCase()} row ${n + 1}`} testID={`${testID}-remove-${n}`} onPress={() => write(local.filter((_, at) => at !== n))} />
      </View>,
    );
  });
  return (
    <View style={f.field} testID={testID}>
      <Text style={f.label}>{label}</Text>
      {rowEls}
      {problems.length > 0 ? <Text style={[f.hint, { color: "var(--danger)" as string }]} accessibilityRole="alert" testID={`${testID}-problem`}>{problems[0]}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={addLabel} testID={`${testID}-add`} onPress={() => setLocal([...local, { key: "", value: "" }])} style={[f.add, pointer]}>
        <Glyph name="plus" size={12} color="var(--ink-3)" />
        <Text style={f.addText}>{addLabel}</Text>
      </Pressable>
    </View>
  );
}

export const f = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string },
  input: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 9, fontSize: 13, color: "var(--ink)" as string },
  choice: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  choiceText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  group: { gap: 8, paddingTop: 6 },
  groupHead: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-2)" as string },
  pair: { flexDirection: "row", alignItems: "center", gap: 6 },
  pairKey: { flex: 2, minWidth: 0 },
  pairValue: { flex: 3, minWidth: 0 },
  add: { flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 4 },
  addText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
