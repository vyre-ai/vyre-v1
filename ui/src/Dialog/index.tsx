// ui/Dialog: the one dialog. A veil over the window, a centred card with a title, the caller's content and a row of actions (the quiet ones left of the primary one). It draws in the
// Overlay layer so nothing in the app covers it, Escape and a press on the veil close it, and the first field inside takes focus. Every sheet that asks the person
// something uses this card, so the radius, padding, veil and buttons are the same everywhere.
import { useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Overlay } from "../Overlay/index.tsx";
import { injectCss } from "../theme/css.ts";
import { Tip } from "../Tip/index.tsx";

export interface DialogAction {
  label: string;
  onPress(): void;
  /** The one action the dialog is for: filled with the accent. */
  primary?: boolean;
  /** An action that destroys something: filled with the danger colour in place of the accent. */
  danger?: boolean;
  disabled?: boolean;
  /** Why the action is off, shown as its tooltip while it is. */
  why?: string;
  testID?: string;
}

export interface DialogProps {
  title: string;
  children?: ReactNode;
  actions?: readonly DialogAction[];
  onClose(): void;
  /** Card width in px (default 440); it never exceeds the window less a 16 px gutter. */
  width?: number;
  /** A phone-height sheet: below 560 px wide the card fills the window (no gutter, no radius) and its body scrolls; wider windows keep the centred card. */
  fill?: boolean;
  testID?: string;
  veilTestID?: string;
  titleTestID?: string;
}

const web = Platform.OS === "web";
// the card eases in; the rules go through the sheet so a page that drops injected style text still gets them
function ensureCss(): void {
  injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-ui-dialog",
    "@keyframes vyre-dlg-veil{from{opacity:0}to{opacity:1}}@keyframes vyre-dlg-card{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}"
    + "@media (prefers-reduced-motion: reduce){[role=dialog]{animation:none!important}}");
}

function ActionButton({ a }: { a: DialogAction }): ReactElement {
  const fill = a.primary || a.danger;
  return (
    <Tip help={a.disabled === true ? a.why : undefined}>
    <Pressable
      testID={a.testID} accessibilityRole="button" accessibilityLabel={a.label} accessibilityState={{ disabled: a.disabled === true }} disabled={a.disabled === true} onPress={a.onPress}
      style={({ hovered }: { hovered?: boolean }) => [s.btn, fill ? { backgroundColor: a.danger ? "var(--danger)" : "var(--accent)" } : s.btnQuiet, hovered === true ? (fill ? { opacity: 0.9 } : { backgroundColor: "var(--hover)" }) : null, a.disabled === true ? { opacity: 0.45 } : null]}
    >
      <Text style={[s.btnText, fill ? { color: a.danger ? "#FFFFFF" : "var(--accent-ink, #fff)", fontWeight: "600" } : null]}>{a.label}</Text>
    </Pressable>
    </Tip>
  );
}

export function Dialog({ title, children, actions = [], onClose, width = 440, fill = false, testID, veilTestID, titleTestID }: DialogProps): ReactElement {
  const card = useRef<unknown>(null);
  const winW = useWindowDimensions().width;
  const full = fill && winW > 0 && winW < 560;
  useEffect(() => {
    if (!web) return;
    ensureCss();
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: { key: string; stopPropagation(): void }) => void): void; removeEventListener(t: string, f: (e: { key: string; stopPropagation(): void }) => void): void } }).document;
    if (!doc) return;
    const key = (e: { key: string; stopPropagation(): void }): void => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    doc.addEventListener("keydown", key);
    // the first field inside the card takes focus (a dialog with only buttons keeps none, so no button wears a focus ring before a key is pressed), so the keyboard works at once
    const el = card.current as { querySelector?: (q: string) => { focus?: () => void } | null } | null;
    el?.querySelector?.("input,textarea,select")?.focus?.();
    return () => doc.removeEventListener("keydown", key);
  }, [onClose]);
  // quiet buttons first, then the primary or danger one, each built in a loop (not a list of rows)
  const buttons: ReactElement[] = [];
  for (const a of actions) if (!a.primary && !a.danger) buttons.push(<ActionButton key={a.label} a={a} />);
  for (const a of actions) if (a.primary || a.danger) buttons.push(<ActionButton key={a.label} a={a} />);
  return (
    <Overlay>
      <View testID={veilTestID} style={[s.veil, full && s.veilFull, web ? ({ animation: "vyre-dlg-veil 140ms ease-out both" } as object) : null]}>
        <Pressable accessibilityLabel="Close" accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View ref={card as never} role="dialog" aria-modal accessibilityLabel={title} testID={testID} style={[s.card, { maxWidth: width }, full && s.cardFull, web ? ({ animation: "vyre-dlg-card 180ms cubic-bezier(.2,.8,.2,1) both" } as object) : null]}>
          <Text accessibilityRole="header" testID={titleTestID} style={s.title}>{title}</Text>
          {children ? (full ? <ScrollView style={s.bodyFull} contentContainerStyle={s.bodyIn} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={s.body}>{children}</View>) : null}
          {actions.length ? (
            <View style={s.actions}>
              {buttons}
            </View>
          ) : null}
        </View>
      </View>
    </Overlay>
  );
}

const s = StyleSheet.create({
  veil: { position: (web ? "fixed" : "absolute") as unknown as "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99998, backgroundColor: "rgba(8,8,10,0.5)", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  card: { width: "100%", backgroundColor: "var(--raised)" as string, borderRadius: 16, paddingTop: 22, paddingBottom: 18, paddingHorizontal: 24, boxShadow: "0 0 0 1px var(--line-2), 0 30px 80px -20px rgba(0,0,0,.55), 0 8px 24px rgba(0,0,0,.18)" } as never,
  veilFull: { paddingHorizontal: 0, alignItems: "stretch", justifyContent: "flex-start" },
  cardFull: { maxWidth: "100%", height: "100%", borderRadius: 0, paddingTop: 18, paddingBottom: 14, paddingHorizontal: 16 } as never,
  bodyIn: { gap: 12 },
  bodyFull: { flex: 1, minHeight: 0, marginTop: 12 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: "var(--ink)" as string, letterSpacing: -0.2 },
  body: { marginTop: 12, gap: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", columnGap: 8, rowGap: 8, marginTop: 22 },
  btn: { height: 32, paddingHorizontal: 14, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnQuiet: { backgroundColor: "transparent" },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink-2)" as string },
});
