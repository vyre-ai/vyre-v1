// The pieces every Settings page is made of: the grouped card, the one row anatomy (lead mark, label, a sub line only when it adds information, control on the right), the switch, the
// choice, the field and the small button. Sizes follow the prototype's Settings (vyre-settings.html); colours are skin tokens, so a skin switch repaints with no re-render.
import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ViewStyle } from "react-native";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";

export const web = Platform.OS === "web";
export const webOnly = (o: Record<string, unknown>): Record<string, unknown> => (web ? o : {});
export const pointer = (web ? { cursor: "pointer" } : {}) as ViewStyle;
export const shadow = (v: string): ViewStyle => (web ? ({ boxShadow: v } as ViewStyle) : {});
export interface KeyEventLike { key?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void }

// ---------------------------------------------------------------- icons

export const PATHS: Readonly<Record<string, readonly string[]>> = {
  person: ["M10.5 5.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z", "M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"],
  bell: ["M4 11V7.5a4 4 0 118 0V11l1 1.5H3z", "M6.5 13.5a1.5 1.5 0 003 0"],
  mail: ["M2.5 4.5h11v7h-11z", "M2.8 5l5.2 3.8L13.2 5"],
  chip: ["M5 5h6v6H5z", "M8 2v3M8 11v3M2 8h3M11 8h3"],
  link: ["M6.5 9.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.5.5", "M9.5 6.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l.5-.5"],
  shield: ["M8 2l5 1.8v4c0 3-2.2 5-5 6.2C5.2 12.8 3 10.8 3 7.8v-4z"],
  key: ["M6 9.5a3 3 0 110-6 3 3 0 010 6z", "M8.2 7.8L13 12.5M11 10.5l1.5 1.5"],
  palette: ["M8 2.5a5.5 5.5 0 100 11c1 0 1.5-.7 1.2-1.5-.3-.8.2-1.500 1-1.500H11.500a2 2 0 002-2A5.500 5.500 0 008 2.500z", "M5.500 7.500h.01M8 5.500h.01M10.500 7h.01"],
  keyboard: ["M2.5 4.5h11v7h-11z", "M5 7h.01M8 7h.01M11 7h.01M5.500 9.500h5"],
  laptop: ["M3.500 4.500h9v6h-9z", "M2 12.500h12"],
  grid: ["M3 3h4.500v4.500H3zM8.500 3H13v4.500H8.500zM3 8.500h4.500V13H3zM8.500 8.500H13V13H8.500z"],
  search: ["M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z", "M10.4 10.4L13.500 13.500"],
  chevD: ["M3.500 6L8 10.500 12.500 6"],
  chevR: ["M6 3.500L10.500 8 6 12.500"],
  check: ["M3.500 8.500l3 3 6-7"],
  copy: ["M5 5h8.500v8.500H5z", "M3.500 10.500V4A1.500 1.500 0 015 2.500h6.500"],
  star: ["M8 2.500l1.600 3.300 3.600.5-2.600 2.500.6 3.600L8 10.700l-3.200 1.700.6-3.600L2.800 6.300l3.600-.5z"],
  globe: ["M8 2.500a5.500 5.500 0 100 11 5.500 5.500 0 000-11z", "M2.500 8h11M8 2.500c1.800 1.600 1.800 9.400 0 11M8 2.500c-1.800 1.600-1.800 9.400 0 11"],
  x: ["M4 4l8 8M12 4l-8 8"],
  plus: ["M8 3.500v9M3.500 8h9"],
  github: ["M8 2a6 6 0 00-1.900 11.700c.3.1.4-.1.4-.3v-1.100c-1.700.4-2-.8-2-.8-.3-.7-.7-.9-.7-.9-.5-.4 0-.4 0-.4.600 0 .9.600.9.600.5.9 1.400.7 1.700.5.1-.4.2-.7.4-.8-1.300-.2-2.700-.7-2.700-3 0-.7.2-1.200.6-1.600-.1-.1-.3-.8.1-1.600 0 0 .5-.2 1.600.6a5.500 5.500 0 013 0c1.100-.8 1.600-.6 1.600-.6.4.8.2 1.500.1 1.600.4.4.6.9.6 1.600 0 2.300-1.400 2.800-2.700 3 .2.2.4.600.4 1.100v1.700c0 .2.1.4.4.3A6 6 0 008 2z"],
  phone: ["M5 2.500h6a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9a1 1 0 011-1z", "M7 11.500h2"],
  globe2: ["M8 2.500a5.500 5.500 0 100 11 5.500 5.500 0 000-11z"],
};

export function Glyph({ name, size = 15, color = "var(--ink-3)", fill }: { name: string; size?: number; color?: string; fill?: string }): ReactElement | null {
  if (!web) return null;
  const d = PATHS[name] ?? PATHS["person"]!;
  const paths: ReactElement[] = [];
  for (const p of d) paths.push(createElement("path", { key: p, d: p }));
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", fill: fill ?? "none" } }, ...paths);
}

// ---------------------------------------------------------------- the card and the row

export function Section({ title, note, children, testID }: { title?: string; note?: string; children: ReactNode; testID?: string }): ReactElement {
  return (
    <View style={s.section} testID={testID ?? (title ? `section-${title}` : undefined)} accessibilityLabel={title}>
      {title ? <Text accessibilityRole="header" style={s.sTitle}>{title}</Text> : null}
      <View style={s.card}>{children}</View>
      {note ? <Text style={s.sNote}>{note}</Text> : null}
    </View>
  );
}

export interface SettingsRowProps {
  id: string;
  label: string;
  sub?: string;
  lead?: ReactNode;
  control?: ReactNode;
  first?: boolean;
  onPress?: () => void;
  /** An indented row under another (the "Also when they succeed" row). */
  indent?: boolean;
  /** The search found this row: it takes a quiet accent outline for a moment. */
  found?: boolean;
  danger?: boolean;
}

/** One row anatomy: lead mark, label, a sub line only when it adds information, control on the right. Hover paints the whole row when it can be pressed. */
export function SettingsRow({ id, label, sub, lead, control, first = false, onPress, indent = false, found = false, danger = false }: SettingsRowProps): ReactElement {
  const [over, setOver] = useState(false);
  const body = (
    <>
      {lead ? <View style={s.lead}>{lead}</View> : null}
      <View style={s.text}>
        <Text numberOfLines={1} style={[s.label, indent && { color: "var(--ink-2)" as string }, danger && { color: "var(--danger)" as string }]}>{label}</Text>
        {sub ? <Text numberOfLines={2} style={s.sub}>{sub}</Text> : null}
      </View>
      {control ? <View style={s.control}>{control}</View> : null}
    </>
  );
  const common = [s.row, !first && s.rowLine, indent && { paddingLeft: 28 }, found && { backgroundColor: "var(--accent-wash)" as string }] as const;
  return onPress ? (
    <Pressable
      accessibilityRole="button" accessibilityLabel={sub ? `${label}. ${sub}` : label} testID={`row-${id}`} onPress={onPress}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} {...webOnly({ dataSet: { sid: id } })}
      style={[...common, over && { backgroundColor: "var(--hover)" as string }, pointer]}
    >
      {body}
    </Pressable>
  ) : (
    <View testID={`row-${id}`} accessibilityLabel={label} {...webOnly({ dataSet: { sid: id } })} style={common}>{body}</View>
  );
}

// ---------------------------------------------------------------- controls

export function Switch({ on, onChange, label, disabled = false, testID }: { on: boolean; onChange(next: boolean): void; label: string; disabled?: boolean; testID?: string }): ReactElement {
  return (
    <Pressable
      accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on, disabled }} aria-checked={on} testID={testID} disabled={disabled}
      onPress={() => onChange(!on)} {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === " " || e.key === "Enter") { e.preventDefault?.(); onChange(!on); } } })}
      style={[s.sw, { backgroundColor: (on ? "var(--accent)" : "var(--press)") as string }, disabled && { opacity: 0.5 }, pointer]}
    >
      <View style={[s.knob, { left: on ? 17 : 2 }]} />
    </Pressable>
  );
}

/** A quiet button that opens a menu of choices; the label is the current choice and a chevron. */
export function Choice({ value, options, onChange, label, testID, mono = false }: { value: string; options: readonly { value: string; label: string }[]; onChange(v: string): void; label: string; testID?: string; mono?: boolean }): ReactElement {
  const { element, show } = useMenu();
  const [over, setOver] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;
  const open = (e: unknown): void => {
    const ev = e as { currentTarget?: { getBoundingClientRect?: () => { right: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
    const r = ev.currentTarget?.getBoundingClientRect?.();
    const entries: MenuEntry[] = [];
    for (const o of options) entries.push({ label: o.label, checked: o.value === value, onSelect: () => onChange(o.value) });
    show(entries, Math.max(8, (r?.right ?? ev.nativeEvent?.pageX ?? 300) - 200), (r?.bottom ?? ev.nativeEvent?.pageY ?? 0) + 4, "other");
  };
  return (
    <>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${label}: ${current}`} testID={testID} onPress={open} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
        style={[s.choice, over && { backgroundColor: "var(--hover)" as string }, pointer]}
      >
        <Text numberOfLines={1} style={[s.choiceText, mono && s.mono]}>{current}</Text>
        <Glyph name="chevD" size={12} color="var(--ink-3)" />
      </Pressable>
      {element}
    </>
  );
}

/** A text field that saves when you leave it or press Enter; Escape puts the old value back. A value that breaks `pattern` is not saved and says why. */
export function Field({ value, onCommit, label, placeholder, mono = false, pattern, width = 200, testID, prefix, secureTextEntry = false }: {
  value: string; onCommit(v: string): void; label: string; placeholder?: string; mono?: boolean; pattern?: string; width?: number; testID?: string; prefix?: string; secureTextEntry?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const shown = draft ?? value;
  const bad = (v: string): boolean => (pattern ? !new RegExp(pattern).test(v) : false);
  const done = (): void => {
    if (draft === null) return;
    if (bad(draft)) { setErr(true); return; }
    setErr(false);
    if (draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <View style={s.fieldWrap}>
      {prefix ? <Text style={s.prefix}>{prefix}</Text> : null}
      <TextInput
        accessibilityLabel={label} testID={testID} value={shown} placeholder={placeholder} placeholderTextColor="var(--ink-4)" secureTextEntry={secureTextEntry}
        onChangeText={(t) => { setDraft(t); setErr(false); }} onBlur={done} onSubmitEditing={done}
        {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Escape") { setDraft(null); setErr(false); } } })}
        style={[s.input, { width }, mono && s.mono, err && { borderColor: "var(--danger)" as string }]}
      />
    </View>
  );
}

/** A number with minus and plus; typing works too. Stays inside min and max. */
export function Stepper({ value, onChange, min = 0, max = 1_000_000, step = 1, label, unit, format, testID }: { value: number; onChange(n: number): void; min?: number; max?: number; step?: number; label: string; unit?: string; format?: (n: number) => string; testID?: string }): ReactElement {
  const set = (n: number): void => { const c = Math.max(min, Math.min(max, n)); if (c !== value) onChange(c); };
  return (
    <View style={s.stepper} accessibilityLabel={label} testID={testID}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Less ${label}`} onPress={() => set(value - step)} style={[s.stepBtn, pointer]}><Glyph name="chevD" size={11} color="var(--ink-2)" /></Pressable>
      <Text style={s.stepVal}>{format ? format(value) : `${value}${unit ? ` ${unit}` : ""}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`More ${label}`} onPress={() => set(value + step)} style={[s.stepBtn, pointer]}><View style={{ transform: [{ rotate: "180deg" }] }}><Glyph name="chevD" size={11} color="var(--ink-2)" /></View></Pressable>
    </View>
  );
}

export function SmallButton({ label, onPress, danger = false, primary = false, testID, disabled = false }: { label: string; onPress?: () => void; danger?: boolean; primary?: boolean; testID?: string; disabled?: boolean }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} testID={testID} disabled={disabled} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.small, primary && { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string }, over && !primary && { backgroundColor: "var(--hover)" as string }, disabled && { opacity: 0.45 }, pointer]}
    >
      <Text style={[s.smallText, danger && { color: "var(--danger)" as string }, primary && { color: "var(--accent-ink)" as string }]}>{label}</Text>
    </Pressable>
  );
}

/** A quiet text value at the right of a row. */
export function Value({ text, accent = false, testID }: { text: string; accent?: boolean; testID?: string }): ReactElement {
  return <Text numberOfLines={1} testID={testID} style={[s.value, accent && { color: "var(--accent)" as string }]}>{text}</Text>;
}

/** Two or three equal modes in one quiet control (density). The chosen one is raised. */
export function Segmented({ value, options, onChange, label, testID }: { value: string; options: readonly { value: string; label: string }[]; onChange(v: string): void; label: string; testID?: string }): ReactElement {
  const items: ReactElement[] = [];
  for (const o of options) {
    const on = o.value === value;
    items.push(
      <Pressable
        key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={o.label} testID={testID ? `${testID}-${o.value}` : undefined} onPress={() => onChange(o.value)}
        style={[s.segItem, on && s.segOn, pointer]}
      >
        <Text style={[s.segText, on && { color: "var(--ink)" as string, fontWeight: "500" }]}>{o.label}</Text>
      </Pressable>,
    );
  }
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID} style={s.seg}>{items}</View>;
}

/** A stepped slider with a small A at each end and the value after it; arrow keys move it by one step, a tap on the track picks the nearest step. */
export function Slider({ value, min, max, step, onChange, label, format, testID }: { value: number; min: number; max: number; step: number; onChange(n: number): void; label: string; format?: (n: number) => string; testID?: string }): ReactElement {
  const hits: ReactElement[] = [];
  for (let n = min; n <= max; n += step) hits.push(<Pressable key={n} accessibilityLabel={`${label} ${format ? format(n) : n}`} onPress={() => onChange(n)} style={[{ flex: 1, height: 22 }, pointer]} />);
  const ratio = (value - min) / Math.max(1, max - min);
  const move = (d: number): void => { const n = Math.max(min, Math.min(max, value + d * step)); if (n !== value) onChange(n); };
  return (
    <View style={s.sliderWrap}>
      <Text style={[s.aSmall]} aria-hidden>A</Text>
      <View
        accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: value, text: format ? format(value) : String(value) }} testID={testID} focusable
        {...webOnly({ tabIndex: 0, role: "slider", "aria-valuemin": min, "aria-valuemax": max, "aria-valuenow": value, "aria-label": label, onKeyDown: (e: KeyEventLike) => { if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault?.(); move(1); } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault?.(); move(-1); } } })}
        style={s.sliderTrack}
      >
        <View style={s.sliderLine} />
        <View style={[s.sliderThumb, { left: `${Math.round(ratio * 100)}%` as unknown as number }]} />
        <View style={s.sliderHits}>{hits}</View>
      </View>
      <Text style={s.aBig} aria-hidden>A</Text>
      <Text style={s.sliderVal} testID={testID ? `${testID}-value` : undefined}>{format ? format(value) : String(value)}</Text>
    </View>
  );
}

/** A small round mark with a letter: a Space or a person. */
export function Mark({ name, size = 22, square = true }: { name: string; size?: number; square?: boolean }): ReactElement {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  const hue = (h % 12) * 30;
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: square ? Math.round(size * 0.28) : size, backgroundColor: `hsla(${hue}, 60%, 52%, 0.24)` as string, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: Math.round(size * 0.5), fontWeight: "600", color: `hsl(${hue}, 55%, 46%)` as string }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  section: { marginTop: 26 },
  sTitle: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string, marginBottom: 8, paddingHorizontal: 2 },
  sNote: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, marginTop: 8, paddingHorizontal: 2 },
  card: { borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  rowLine: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  lead: { width: 34, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, justifyContent: "center" },
  label: { fontSize: 13.5, lineHeight: 18, color: "var(--ink)" as string },
  sub: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  control: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "62%" },
  sw: { width: 34, height: 20, borderRadius: 10, justifyContent: "center" },
  knob: { position: "absolute", top: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" },
  choice: { height: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 7 },
  choiceText: { fontSize: 13, color: "var(--ink)" as string, flexShrink: 1 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  fieldWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  prefix: { fontSize: 13, color: "var(--ink-3)" as string },
  input: { height: 32, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 10, fontSize: 13, color: "var(--ink)" as string },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: { width: 26, height: 26, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center" },
  stepVal: { fontSize: 13, color: "var(--ink)" as string, minWidth: 64, textAlign: "center" },
  small: { height: 28, paddingHorizontal: 11, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center" },
  smallText: { fontSize: 13, color: "var(--ink)" as string },
  value: { fontSize: 13, color: "var(--ink-3)" as string },
  seg: { flexDirection: "row", padding: 2, gap: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  segItem: { height: 26, paddingHorizontal: 12, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  segText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  sliderWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  aSmall: { fontSize: 11, color: "var(--ink-3)" as string },
  aBig: { fontSize: 16, color: "var(--ink-3)" as string },
  sliderTrack: { width: 170, height: 22, justifyContent: "center" },
  sliderLine: { height: 3, borderRadius: 2, backgroundColor: "var(--press)" as string },
  sliderThumb: { position: "absolute", top: 3, width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  sliderHits: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row" },
  sliderVal: { fontSize: 13, color: "var(--ink-3)" as string, minWidth: 40, textAlign: "right" },
});

/** The small leading mark of a nav row: an icon, 16 px, in the quiet ink. */
export function IconBox({ name }: { name: string }): ReactElement {
  return <View style={{ width: 22, alignItems: "center", marginRight: 4 }}><Glyph name={name} size={15} color="var(--ink-3)" /></View>;
}
