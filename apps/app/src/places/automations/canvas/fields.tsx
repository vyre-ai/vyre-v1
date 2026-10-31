// The small inputs the step panel is made of: a labelled text field (one line or several), a choice that opens a menu, a group with a head, a hint, and rows of name and value. They were the
// Inspector's own; the HTTP request, Run code and AI forms (steps/) use the same ones so every step panel looks and behaves alike.
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Glyph } from "./icons.tsx";
import { IconButton, pointer, webOnly } from "./parts.tsx";
import { dropChip, joinTemplate, splitTemplate } from "./steps/edits.ts";
import type { Pair, Seg } from "./steps/edits.ts";

/** The field a person last had in hand. The Data shelf puts the data a person picks into it, so mapping works from the keyboard and the mouse alike. */
export interface MapTarget { label: string; value: string; commit(next: string): void }
export const MapTargetContext = createContext<{ set(t: MapTarget | null): void } | null>(null);

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/** A labelled text field. The value commits on blur and on Enter (one line); Escape puts the old value back. `rows` makes it a box of several lines. */
export function Field({ label, value, onCommit, placeholder, mono = false, readOnly = false, testID, rows, invalid, hint }: {
  label: string; value: string; onCommit(v: string): void; placeholder?: string; mono?: boolean; readOnly?: boolean; testID?: string; rows?: number; invalid?: boolean; /** What the field is for, on hover. */ hint?: string;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const map = useContext(MapTargetContext);
  const shown = draft ?? value;
  const done = (): void => { if (draft !== null && draft !== value) onCommit(draft); map?.set({ label, value: shown, commit: onCommit }); setDraft(null); };
  return (
    <View style={f.field}>
      <Text style={f.label}>{label}</Text>
      <TextInput
        {...(hint ? webOnly({ title: hint }) : {})}
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

export function Choice({ label, value, onOpen, testID, hint, face }: { label: string; value: string; onOpen(x: number, y: number): void; testID?: string; /** What the choice is for, on hover. */ hint?: string; /** A face drawn before the value (a person, an agent). */ face?: ReactNode }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <View style={f.field}>
      <Text style={f.label}>{label}</Text>
      <Pressable
        {...(hint ? webOnly({ title: hint }) : {})}
        accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} testID={testID}
        onPress={(e) => { const ev = e as unknown as { nativeEvent?: { pageX?: number; pageY?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }; const r = ev.currentTarget?.getBoundingClientRect?.(); onOpen(r?.left ?? ev.nativeEvent?.pageX ?? 0, (r?.bottom ?? ev.nativeEvent?.pageY ?? 0) + 4); }}
        onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
        style={[f.choice, over && { backgroundColor: "var(--hover)" as string }, pointer]}
      >
        {face ?? null}
        <Text numberOfLines={1} style={f.choiceText}>{value}</Text>
        <Glyph name="chevD" size={12} color="var(--ink-3)" />
      </Pressable>
    </View>
  );
}

/**
 * Text with data chips: the pieces of text are typed in place and each {{ }} reference is a small pill that says what it brings in (the x takes it out). What is stored is the template string, so
 * nothing else reads it differently; the chips are how it is drawn. Commits when a piece of text loses focus or a chip goes.
 */
export function ChipText({ label, value, onCommit, chipLabel, placeholder, testID, hint }: {
  label: string; value: string; onCommit(v: string): void; chipLabel(ref: string): string; placeholder?: string; testID?: string; hint?: string;
}): ReactElement {
  const [draft, setDraft] = useState<Seg[] | null>(null);
  const segs = draft ?? splitTemplate(value);
  const done = (next: readonly Seg[]): void => { const text = joinTemplate(next); setDraft(null); if (text !== value) onCommit(text); };
  const edit = (i: number, text: string): void => setDraft(segs.map((x, at) => (at === i ? { kind: "text", text } : x)));
  const pieces: ReactElement[] = [];
  segs.forEach((seg, i) => {
    if (seg.kind === "text") {
      const first = i === 0;
      pieces.push(
        <TextInput
          key={`t${i}`} accessibilityLabel={first ? label : `${label} part ${i / 2 + 1}`} testID={first ? testID : testID ? `${testID}-${i}` : undefined} value={seg.text} multiline
          placeholder={first && segs.length === 1 ? placeholder : undefined} placeholderTextColor="var(--ink-4)"
          onChangeText={(t) => edit(i, t)} onBlur={() => done(segs)} {...(hint && first ? webOnly({ title: hint }) : {})}
          style={[f.chipInput, i < segs.length - 1 ? { flexGrow: 0, flexShrink: 1, height: 22, width: Math.min(280, Math.max(14, Math.round(seg.text.length * 7.4) + 8)) } : { flexGrow: 1, minWidth: 40, minHeight: 22 }]}
        />,
      );
    } else {
      pieces.push(
        <View key={`c${i}`} testID={testID ? `${testID}-chip-${i}` : undefined} accessibilityLabel={`Data: ${chipLabel(seg.ref)}`} style={f.chip}>
          <Text numberOfLines={1} style={f.chipLabel}>{chipLabel(seg.ref)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${chipLabel(seg.ref)}`} onPress={() => done(dropChip(segs, i))} style={pointer}><Glyph name="x" size={10} color="var(--ink-3)" /></Pressable>
        </View>,
      );
    }
  });
  return (
    <View style={f.field}>
      <Text style={f.label}>{label}</Text>
      <View style={f.chipBox}>{pieces}</View>
    </View>
  );
}

/** Two options side by side, one lit: the Answer or Task switch of the AI step. */
export function Segmented({ options, value, onPick, testID }: { options: ReadonlyArray<{ key: string; label: string; hint?: string }>; value: string; onPick(key: string): void; testID?: string }): ReactElement {
  return (
    <View testID={testID} accessibilityRole="radiogroup" style={f.seg}>
      {/* ui-rows-lint: not a list (two options of a switch) */}
      {options.map((o) => (
        <Pressable key={o.key} accessibilityRole="radio" accessibilityLabel={o.label} accessibilityState={{ checked: value === o.key }} testID={`${testID ?? "seg"}-${o.key}`} onPress={() => onPick(o.key)} {...webOnly({ title: o.hint ?? o.label, "aria-checked": value === o.key })} style={[f.segOpt, value === o.key && f.segOn, pointer]}>
          <Text style={[f.segText, value === o.key && { color: "var(--ink)" as string, fontWeight: "600" }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A group that starts closed: the settings most people leave alone (More). */
export function More({ head, children, testID }: { head: string; children: ReactNode; testID?: string }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <View style={f.group} testID={testID}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={head} testID={testID ? `${testID}-toggle` : undefined} onPress={() => setOpen(!open)} style={[f.moreHead, pointer]}>
        <Glyph name="chevD" size={11} color="var(--ink-3)" />
        <Text style={f.groupHead}>{head}</Text>
      </Pressable>
      {open ? children : null}
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
export function Rows({ label, pairs, onCommit, keyLabel = "Name", valueLabel = "Value", addLabel, testID, check, onPickValue, newValue = "" }: {
  label: string; pairs: readonly Pair[]; onCommit(valid: Pair[]): void; keyLabel?: string; valueLabel?: string; addLabel: string; testID: string;
  check?: (name: string) => string | null;
  /** The value is picked from a menu, not typed: called with the row's current value and where to open the menu; `set` writes the pick. */
  onPickValue?: (current: string, x: number, y: number, set: (v: string) => void) => void;
  /** The value a new row starts with. */
  newValue?: string;
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
        {onPickValue ? (
          <Pressable
            accessibilityRole="button" accessibilityLabel={`${label} ${valueLabel.toLowerCase()} ${n + 1}: ${p.value}`} testID={`${testID}-value-${n}`}
            onPress={(e) => { const ev = e as unknown as { nativeEvent?: { pageX?: number; pageY?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }; const r = ev.currentTarget?.getBoundingClientRect?.(); onPickValue(p.value, r?.left ?? ev.nativeEvent?.pageX ?? 0, r?.bottom ?? ev.nativeEvent?.pageY ?? 0, (v) => write(local.map((q, at) => (at === n ? { ...q, value: v } : q)))); }}
            style={[f.choice, f.pairValue, pointer]}
          >
            <Text numberOfLines={1} style={f.choiceText}>{p.value || valueLabel}</Text>
            <Glyph name="chevD" size={12} color="var(--ink-3)" />
          </Pressable>
        ) : (
        <TextInput
            accessibilityLabel={`${label} ${valueLabel.toLowerCase()} ${n + 1}`} testID={`${testID}-value-${n}`} value={p.value} placeholder={valueLabel} placeholderTextColor="var(--ink-4)"
            onChangeText={(t) => edit(n, { value: t })} onBlur={() => { write(local); map?.set({ label: `${label} ${valueLabel.toLowerCase()} ${n + 1}`, value: local[n]?.value ?? "", commit: (v) => write(local.map((q, at) => (at === n ? { ...q, value: v } : q))) }); }}
            onFocus={() => map?.set({ label: `${label} ${valueLabel.toLowerCase()} ${n + 1}`, value: p.value, commit: (v) => write(local.map((q, at) => (at === n ? { ...q, value: v } : q))) })}
            style={[f.input, f.pairValue]}
          />
        )}
        <IconButton icon="x" label={`Remove ${label.toLowerCase()} row ${n + 1}`} testID={`${testID}-remove-${n}`} onPress={() => write(local.filter((_, at) => at !== n))} />
      </View>,
    );
  });
  return (
    <View style={f.field} testID={testID}>
      <Text style={f.label}>{label}</Text>
      {rowEls}
      {problems.length > 0 ? <Text style={[f.hint, { color: "var(--danger)" as string }]} accessibilityRole="alert" testID={`${testID}-problem`}>{problems[0]}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={addLabel} testID={`${testID}-add`} onPress={() => setLocal([...local, { key: "", value: newValue }])} style={[f.add, pointer]}>
        <Glyph name="plus" size={12} color="var(--ink-3)" />
        <Text style={f.addText}>{addLabel}</Text>
      </Pressable>
    </View>
  );
}

export const f = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string },
  input: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, paddingHorizontal: 9, fontSize: 13, color: "var(--ink)" as string },
  choice: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  choiceText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  group: { gap: 8, paddingTop: 6 },
  chipBox: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, minHeight: 70, alignContent: "flex-start", borderRadius: 7, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, padding: 7 },
  chipInput: { minWidth: 10, fontSize: 13, color: "var(--ink)" as string, paddingVertical: 2, paddingHorizontal: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: "var(--accent-wash)" as string, maxWidth: 220 },
  chipLabel: { fontSize: 12, color: "var(--ink)" as string, flexShrink: 1 },
  moreHead: { flexDirection: "row", alignItems: "center", gap: 6, height: 24 },
  seg: { flexDirection: "row", borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, padding: 2, gap: 2 },
  segOpt: { flex: 1, height: 26, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--hover)" as string },
  segText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  groupHead: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-2)" as string },
  pair: { flexDirection: "row", alignItems: "center", gap: 6 },
  pairKey: { flex: 2, minWidth: 0 },
  pairValue: { flex: 3, minWidth: 0 },
  add: { flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 4 },
  addText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
