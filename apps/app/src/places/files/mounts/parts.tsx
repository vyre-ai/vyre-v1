// Pieces of the mount sheets: the sheet frame, its header, buttons, a labelled field, the text box, a menu button, a two-way switch.
// Sizes and colours are the prototype's mount dialog (vyre-v1.html, .dlg.mx): a 16 px radius raised card, 18 px padding, 34 px action buttons, 48 px field rows with a hairline above,
// 34 px text boxes on the sunk surface. Every colour is a skin token, so a skin switch repaints with no re-render.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ViewStyle } from "react-native";
import { Glyph } from "./icons.tsx";

export const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
const style = (s: Record<string, unknown>): ViewStyle => s as unknown as ViewStyle;

interface KeyLike { key: string; preventDefault?: () => void; stopPropagation?: () => void; target?: { tagName?: string } }

/** The anchor for a menu opened from a press: under the pressed control on web, else where the press landed. */
export function anchorOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  if (box) return { x: box.left, y: box.bottom + 4 };
  return { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

/** The dialog: dimmed backdrop (press closes), centred raised card, Escape closes, focus lands in the card so the keyboard works at once. */
export function Sheet({ label, onClose, onKey, children, testID }: { label: string; onClose: () => void; onKey?: (e: KeyLike) => boolean; children: ReactNode; testID?: string }): ReactElement {
  const ref = useRef<unknown>(null);
  useEffect(() => {
    const node = ref.current as { focus?: (o?: { preventScroll?: boolean }) => void } | null;
    if (Platform.OS === "web") node?.focus?.({ preventScroll: true });
  }, []);
  const onKeyDown = (e: KeyLike): void => {
    if (e.key === "Escape") { e.preventDefault?.(); e.stopPropagation?.(); onClose(); return; }
    if (onKey?.(e)) { e.preventDefault?.(); e.stopPropagation?.(); }
  };
  return (
    <View style={s.wrap} testID={testID ?? "sheet"}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={s.backdrop} {...webProps({ tabIndex: -1 })} testID="sheet-backdrop" />
      <View ref={ref as never} role="dialog" aria-modal aria-label={label} style={s.panel} {...webProps({ tabIndex: -1, onKeyDown })}>
        {children}
      </View>
    </View>
  );
}

export function SheetHead({ title, mark, onBack, onClose }: { title: string; mark?: ReactNode; onBack?: (() => void) | undefined; onClose: () => void }): ReactElement {
  return (
    <View style={s.head}>
      {onBack ? <IconButton glyph="back" label="Back" onPress={onBack} testID="sheet-back" /> : null}
      <View style={s.headTitle}>
        {mark}
        <Text accessibilityRole="header" aria-level={3} numberOfLines={1} style={s.h3}>{title}</Text>
      </View>
      <IconButton glyph="x" label="Close" onPress={onClose} testID="sheet-close" />
    </View>
  );
}

export function IconButton({ glyph, label, onPress, testID }: { glyph: "back" | "x" | "chev"; label: string; onPress: () => void; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} testID={testID} style={[s.ib, over && s.ibOver]} {...webProps({ title: label })}>
      <Glyph name={glyph} size={glyph === "x" ? 14 : 15} color="var(--ink-3)" />
    </Pressable>
  );
}

export function Actions({ children }: { children: ReactNode }): ReactElement {
  return <View style={s.acts}>{children}</View>;
}

/** The sheet's buttons: quiet by default, the primary one in the accent wash. A disabled one dims to 35 percent and does nothing. */
export function Btn({ label, onPress, primary = false, disabled = false, testID }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      testID={testID}
      style={[s.btn, primary ? s.btnPri : over && s.btnOver, disabled && s.dim]}
    >
      <Text style={[s.btnText, primary && s.btnTextPri]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, children, first = false }: { label: string; children: ReactNode; first?: boolean }): ReactElement {
  return (
    <View style={[s.fld, first && s.fldFirst]}>
      <Text style={s.fldLabel}>{label}</Text>
      <View style={s.fldControl}>{children}</View>
    </View>
  );
}

export function TextField({ value, onChange, label, placeholder, onSubmit, testID, width = 260, autoFocus = false }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; onSubmit?: () => void; testID?: string; width?: number; autoFocus?: boolean }): ReactElement {
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      accessibilityLabel={label}
      placeholder={placeholder}
      placeholderTextColor="var(--ink-4)"
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onSubmitEditing={onSubmit}
      autoFocus={autoFocus}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      testID={testID}
      style={[s.input, { width }, focus && s.inputFocus]}
    />
  );
}

/** A value with a chevron that opens a menu (Who can see it, Into). */
export function MenuButton({ value, label, onPress, leading, testID }: { value: string; label: string; onPress: (e: unknown) => void; leading?: ReactNode; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      testID={testID}
      style={[s.mb, over && s.btnOver]}
      {...webProps({ "aria-haspopup": "menu" })}
    >
      {leading}
      <Text numberOfLines={1} style={s.mbValue}>{value}</Text>
      <Glyph name="chevd" size={9} color="var(--ink-3)" width={1.8} />
    </Pressable>
  );
}

/** Two or three choices in one pill; the chosen one sits raised. */
export function Segmented<T extends string>({ options, value, onChange, label, testID }: { options: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; testID?: string }): ReactElement {
  const buttons: ReactElement[] = [];
  for (const o of options) {
    buttons.push(
      <Pressable key={o.id} role="radio" aria-checked={o.id === value} accessibilityState={{ selected: o.id === value }} accessibilityLabel={o.label} onPress={() => onChange(o.id)} testID={`${testID ?? "seg"}-${o.id}`} style={[s.segBtn, o.id === value && s.segOn]}>
        <Text style={[s.segText, o.id === value && s.segTextOn]}>{o.label}</Text>
      </Pressable>,
    );
  }
  return <View role="radiogroup" aria-label={label} style={s.seg} testID={testID}>{buttons}</View>;
}

export function Switch({ on, onChange, label, testID }: { on: boolean; onChange: (v: boolean) => void; label: string; testID?: string }): ReactElement {
  return (
    <Pressable role="switch" aria-checked={on} accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={() => onChange(!on)} testID={testID} style={[s.sw, on && s.swOn]}>
      <View style={[s.knob, on && s.knobOn]} />
    </Pressable>
  );
}

export function ErrorLine({ text, testID = "sheet-error" }: { text: string; testID?: string }): ReactElement {
  return <Text accessibilityRole="alert" role="alert" testID={testID} style={s.error}>{text}</Text>;
}

const s = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, zIndex: 30, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.28)" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  panel: style({
    width: "100%", maxWidth: 520, maxHeight: "92%", marginHorizontal: 16, padding: 18, gap: 8, borderRadius: 16, backgroundColor: "var(--raised)",
    boxShadow: "var(--sh-pop), 0 40px 80px -20px rgba(0,0,0,.5)", overflow: "hidden",
  }),
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: -4, marginTop: -4, marginBottom: 2 },
  headTitle: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  h3: { flexShrink: 1, fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  ib: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  ibOver: { backgroundColor: "var(--hover)" as string },
  acts: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 },
  btn: { height: 34, paddingHorizontal: 14, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnPri: { backgroundColor: "var(--accent-wash)" as string },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink-2)" as string },
  btnTextPri: { color: "var(--accent)" as string },
  dim: { opacity: 0.35 },
  fld: style({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, minHeight: 48, borderTopWidth: 1, borderTopColor: "var(--line)" }),
  fldFirst: { borderTopWidth: 0 },
  fldLabel: { fontSize: 13, color: "var(--ink-2)" as string },
  fldControl: { flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  input: style({
    height: 34, maxWidth: "100%", borderRadius: 8, backgroundColor: "var(--sunk)", boxShadow: "inset 0 0 0 1px var(--line)", paddingHorizontal: 11, color: "var(--ink)", fontSize: 13.5, outlineStyle: "none",
  }),
  inputFocus: style({ boxShadow: "inset 0 0 0 1px var(--accent-line), 0 0 0 3px var(--accent-wash)" }),
  mb: { height: 28, paddingHorizontal: 8, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 280 },
  mbValue: { flexShrink: 1, fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  seg: { flexDirection: "row", height: 28, padding: 2, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  segBtn: { paddingHorizontal: 10, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segOn: style({ backgroundColor: "var(--raised)", boxShadow: "var(--sh-1)" }),
  segText: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  segTextOn: { color: "var(--ink)" as string },
  sw: { width: 34, height: 20, borderRadius: 99, padding: 2, backgroundColor: "var(--ink-4)" as string, justifyContent: "center" },
  swOn: { backgroundColor: "var(--accent)" as string },
  knob: { width: 16, height: 16, borderRadius: 99, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  error: { fontSize: 12.5, lineHeight: 18, color: "var(--danger)" as string },
});
