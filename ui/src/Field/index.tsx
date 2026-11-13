// ui/Field: a Row whose right side is one control, or two side by side (a text and its button). The controls are a switch, a select, a number, a text and a button, so a setting in a page, a sheet
// or the Console is drawn by one piece. Pressing a switch row toggles it; a text commits on Enter or blur and Escape puts the old value back; a number clamps on blur and says its range in one plain
// line; a select opens its choices where it was pressed; a disabled control does nothing and says why. (The hours control, "Reset to default" on right-click and the phone stacking arrive with Group and Page.)
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../Row/index.tsx";
import { Switch } from "../Switch/index.tsx";
import { TextField } from "../TextField/index.tsx";
import { useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";

export type Control =
  | { kind: "switch"; on: boolean; onChange(on: boolean): void }
  | {
      kind: "select";
      value: string;
      options: readonly { value: string; label: string }[];
      onChange(v: string): void;
    }
  | {
      kind: "number";
      value: number;
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
      onChange(n: number): void;
    }
  | { kind: "text"; value: string; onCommit(v: string): void; placeholder?: string; secret?: boolean; mono?: boolean }
  | { kind: "button"; label: string; onPress(): void; tone?: "primary" | "danger" };

export interface FieldProps {
  label: string;
  hint?: string;
  control: Control | readonly [Control, Control];
  disabled?: boolean;
  /** Said on hover when the control is disabled. */
  why?: string;
  danger?: boolean;
  /** The search found this row. */
  found?: boolean;
  lead?: ReactElement;
  testID?: string;
}

const isPair = (c: FieldProps["control"]): c is readonly [Control, Control] => Array.isArray(c);
const clamp = (n: number, min?: number, max?: number): number =>
  Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));
const rangeLine = (c: Extract<Control, { kind: "number" }>): string | null => {
  const unit = c.unit ? ` ${c.unit}` : "";
  if (c.min !== undefined && c.max !== undefined) return `${c.min} to ${c.max}${unit}`;
  if (c.min !== undefined) return `${c.min}${unit} or more`;
  if (c.max !== undefined) return `${c.max}${unit} or less`;
  return null;
};

function Text1({
  c,
  label,
  disabled,
  id,
}: {
  c: Extract<Control, { kind: "text" }>;
  label: string;
  disabled: boolean;
  id: string;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? c.value;
  const done = (): void => {
    if (draft !== null && draft !== c.value) c.onCommit(draft);
    setDraft(null);
  };
  return (
    <TextField
      testID={id}
      accessibilityLabel={label}
      value={shown}
      editable={!disabled}
      secureTextEntry={c.secret === true}
      {...(c.placeholder ? { placeholder: c.placeholder } : {})}
      onChangeText={setDraft}
      onBlur={done}
      onKeyPress={(e) => {
        const k = (e as { nativeEvent?: { key?: string } }).nativeEvent?.key;
        if (k === "Enter") done();
        if (k === "Escape") setDraft(null);
      }}
      style={[st.text, c.mono === true && st.mono]}
    />
  );
}

function Number1({
  c,
  label,
  disabled,
  id,
}: {
  c: Extract<Control, { kind: "number" }>;
  label: string;
  disabled: boolean;
  id: string;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const done = (): void => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() === "" || Number.isNaN(n)) return;
    const next = clamp(n, c.min, c.max);
    if (next !== c.value) c.onChange(next);
  };
  return (
    <TextField
      testID={id}
      accessibilityLabel={label}
      value={draft ?? String(c.value)}
      editable={!disabled}
      keyboardType="numeric"
      onChangeText={setDraft}
      onBlur={done}
      onKeyPress={(e) => {
        if ((e as { nativeEvent?: { key?: string } }).nativeEvent?.key === "Enter") done();
      }}
      style={st.number}
    />
  );
}

function Select1({
  c,
  label,
  disabled,
  id,
}: {
  c: Extract<Control, { kind: "select" }>;
  label: string;
  disabled: boolean;
  id: string;
}): ReactElement {
  const { element, show } = useMenu();
  const current = c.options.find((o) => o.value === c.value)?.label ?? c.value;
  const open = (e: unknown): void => {
    const ev = e as {
      currentTarget?: { getBoundingClientRect?: () => { right: number; bottom: number } };
      nativeEvent?: { pageX?: number; pageY?: number };
    };
    const r = ev.currentTarget?.getBoundingClientRect?.();
    const entries: MenuEntry[] = c.options.map((o) => ({
      label: o.label,
      checked: o.value === c.value,
      onSelect: () => c.onChange(o.value),
    }));
    show(
      entries,
      Math.max(8, (r?.right ?? ev.nativeEvent?.pageX ?? 300) - 200),
      (r?.bottom ?? ev.nativeEvent?.pageY ?? 0) + 4,
      "other",
    );
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        aria-haspopup="menu"
        testID={id}
        disabled={disabled}
        onPress={open}
        style={st.choice}
      >
        <Text numberOfLines={1} style={st.choiceText}>
          {current}
        </Text>
      </Pressable>
      {element}
    </>
  );
}

function One({ c, label, disabled, id }: { c: Control; label: string; disabled: boolean; id: string }): ReactElement {
  switch (c.kind) {
    case "switch":
      return <Switch on={c.on} label={label} disabled={disabled} onChange={c.onChange} testID={id} />;
    case "text":
      return <Text1 c={c} label={label} disabled={disabled} id={id} />;
    case "number":
      return <Number1 c={c} label={label} disabled={disabled} id={id} />;
    case "select":
      return <Select1 c={c} label={label} disabled={disabled} id={id} />;
    case "button":
      return (
        <Pressable
          accessibilityRole="button"
          testID={id}
          disabled={disabled}
          onPress={c.onPress}
          style={[st.btn, disabled && st.dim]}
        >
          <Text style={[st.btnText, c.tone === "danger" && st.danger, c.tone === "primary" && st.primary]}>
            {c.label}
          </Text>
        </Pressable>
      );
  }
}

export function Field({
  label,
  hint,
  control,
  disabled = false,
  why,
  danger = false,
  found = false,
  lead,
  testID,
}: FieldProps): ReactElement {
  const id = testID ?? label;
  const controls = isPair(control) ? control : [control];
  const first = controls[0]!;
  const range = first.kind === "number" ? rangeLine(first) : null;
  const note = [hint, range].filter(Boolean).join(" · ");
  const toggles = first.kind === "switch" && !disabled && controls.length === 1;
  return (
    <View testID={testID} style={found ? st.found : undefined} {...(disabled && why ? { accessibilityHint: why } : {})}>
      <Row
        id={id}
        title={label}
        {...(note ? { note } : {})}
        {...(lead ? { leading: lead } : {})}
        {...(danger ? { titleMarks: <View style={st.dot} /> } : {})}
        {...(toggles ? { onPress: () => first.onChange(!first.on) } : { inert: true })}
        {...(disabled && why ? { hint: why } : {})}
        trailing={
          <View style={st.controls}>
            {/* ui-rows-lint: not a list (the one or two controls of a single field) */}
            {controls.map((c, i) => (
              <One key={i} c={c} label={label} disabled={disabled} id={`${id}-control${i === 0 ? "" : `-${i}`}`} />
            ))}
          </View>
        }
      />
      {disabled && why ? (
        <Text testID={`${id}-why`} style={st.why}>
          {why}
        </Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "center", gap: 8 },
  found: { backgroundColor: "var(--accent-wash)" as string },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--danger)" as string },
  text: { width: 200, height: 32 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  number: { width: 80, height: 32 },
  choice: { height: 32, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderRadius: 8 },
  choiceText: { fontSize: 13, color: "var(--ink)" as string },
  btn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
  btnText: { fontSize: 13, color: "var(--ink)" as string },
  primary: { color: "var(--accent)" as string, fontWeight: "600" },
  danger: { color: "var(--danger)" as string },
  dim: { opacity: 0.5 },
  why: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingBottom: 4 },
});
