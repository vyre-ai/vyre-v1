// ui/Dialog: the one dialog. A veil over the window, a centred card with a title, the caller's content and a row of actions (the quiet ones left of the primary one). It draws in the
// Overlay layer so nothing in the app covers it, Escape and a press on the veil close it, and the first field inside takes focus. Every sheet that asks the person
// something uses this card, so the radius, padding, veil and buttons are the same everywhere.
import { loudLayers, useEscapeLayer, watchEscapeLayers } from "../Overlay/escape.ts";
import { returnFocus, watchSheetKeys } from "./sheet-keys.ts";
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
  /** Card width in px (default 440); it never exceeds the window less a 16 px gutter. Wins over `size`. */
  width?: number;
  /** s 360, m 440 (the default), l 720, or full: the window less a gutter, no padding, a header and a bar slot, a Close control always, and a body that is a live surface. */
  size?: "s" | "m" | "l" | "full";
  /** Full size only: replaces the plain title row (a name, an owner, a small status). */
  header?: ReactNode;
  /** Full size only: one fixed-height line under the header (who is typing, who has the keyboard). */
  bar?: ReactNode;
  /** The surface inside holds the keyboard (a terminal): the sheet takes no Escape, Cmd+W or Tab, this chord leaves it and moves focus to Close, and the header tells the chord in `hint`. */
  captureKeys?: { chord: string; hint: string };
  /** One quiet line above the actions. */
  note?: string;
  /** A phone-height sheet: below 560 px wide the card fills the window (no gutter, no radius) and its body scrolls; wider windows keep the centred card. */
  fill?: boolean;
  testID?: string;
  veilTestID?: string;
  titleTestID?: string;
  /**
   * "composer": a card that sits where the caller put it (above the composer) instead of a veil over the window. No veil, no `aria-modal`, no focus move or trap: the composer keeps the keyboard.
   * Escape (one layer) and the Close control close it; a press outside is handed to `onPressOutside` with its target, so the owner can leave the composer out of it. The owner also closes it on the next send.
   */
  anchor?: "composer";
  onPressOutside?(target: unknown): void;
}

const web = Platform.OS === "web";
type Fn = (t: string, f: (e: { target?: unknown }) => void, capture?: boolean) => void;
const SIZE_PX = { s: 360, m: 440, l: 720, full: 0 } as const;
// the card eases in; the rules go through the sheet so a page that drops injected style text still gets them
function ensureCss(): void {
  injectCss(
    (globalThis as { document?: Parameters<typeof injectCss>[0] }).document,
    "vyre-ui-dialog",
    "@keyframes vyre-dlg-veil{from{opacity:0}to{opacity:1}}@keyframes vyre-dlg-card{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}" +
      "@media (prefers-reduced-motion: reduce){[role=dialog]{animation:none!important}}",
  );
}

function ActionButton({ a }: { a: DialogAction }): ReactElement {
  const fill = a.primary || a.danger;
  return (
    <Tip help={a.disabled === true ? a.why : undefined}>
      <Pressable
        testID={a.testID}
        accessibilityRole="button"
        accessibilityLabel={a.label}
        accessibilityState={{ disabled: a.disabled === true }}
        disabled={a.disabled === true}
        onPress={a.onPress}
        style={({ hovered }: { hovered?: boolean }) => [
          s.btn,
          fill ? { backgroundColor: a.danger ? "var(--danger)" : "var(--accent)" } : s.btnQuiet,
          hovered === true ? (fill ? { opacity: 0.9 } : { backgroundColor: "var(--hover)" }) : null,
          a.disabled === true ? { opacity: 0.45 } : null,
        ]}
      >
        <Text
          style={[
            s.btnText,
            fill ? { color: a.danger ? "#FFFFFF" : "var(--accent-ink, #fff)", fontWeight: "600" } : null,
          ]}
        >
          {a.label}
        </Text>
      </Pressable>
    </Tip>
  );
}

export function Dialog({
  title,
  children,
  actions = [],
  onClose,
  width,
  size = "m",
  header,
  bar,
  captureKeys,
  note,
  fill = false,
  testID,
  veilTestID,
  titleTestID,
  anchor,
  onPressOutside,
}: DialogProps): ReactElement {
  const card = useRef<unknown>(null);
  const win = useWindowDimensions();
  const winW = win.width;
  const winH = win.height;
  const full = fill && winW > 0 && winW < 560;
  const closeBtn = useRef<unknown>(null);
  const isFull = size === "full";
  const wide = width ?? SIZE_PX[size];
  // a sheet whose surface holds the keyboard does not take Escape: it reaches the surface
  useEscapeLayer(captureKeys === undefined, onClose);
  // an anchored card gives way when a sheet, menu or full-screen view opens above it (its own layer is the one just added)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (anchor === undefined) return undefined;
    const mine = loudLayers();
    return watchEscapeLayers(() => {
      if (loudLayers() > mine) closeRef.current();
    });
  }, [anchor]);
  const outside = useRef(onPressOutside);
  outside.current = onPressOutside;
  useEffect(() => {
    if (!web || anchor === undefined) return undefined;
    const d = (globalThis as { document?: { addEventListener?: Fn; removeEventListener?: Fn } }).document;
    const hear = (e: { target?: unknown }): void => {
      const el = card.current as { contains?: (n: unknown) => boolean } | null;
      if (el?.contains?.(e.target)) return;
      outside.current?.(e.target);
    };
    d?.addEventListener?.("pointerdown", hear, true);
    return () => d?.removeEventListener?.("pointerdown", hear, true);
  }, [anchor]);
  useEffect(() => {
    if (!web || !captureKeys) return undefined;
    const doc = (globalThis as { document?: Parameters<typeof watchSheetKeys>[0]["doc"] }).document;
    if (!doc) return undefined;
    return watchSheetKeys({
      doc,
      chord: captureKeys.chord,
      focusClose: () => (closeBtn.current as { focus?: () => void } | null)?.focus?.(),
    });
  }, [captureKeys?.chord]);
  useEffect(() => {
    // an anchored card leaves focus where it is (the composer); any other sheet puts focus back on what opened it
    if (!web || anchor !== undefined) return undefined;
    const doc = (globalThis as { document?: Parameters<typeof returnFocus>[0] }).document;
    return doc ? returnFocus(doc) : undefined;
  }, []);
  useEffect(() => {
    if (!web || captureKeys || anchor !== undefined) return;
    ensureCss();
    // the first field inside the card takes focus (a dialog with only buttons keeps none, so no button wears a focus ring before a key is pressed), so the keyboard works at once
    const el = card.current as { querySelector?: (q: string) => { focus?: () => void } | null } | null;
    el?.querySelector?.("input,textarea,select")?.focus?.();
  }, []);
  if (anchor !== undefined)
    return (
      <View
        ref={card as never}
        role="dialog"
        accessibilityLabel={title}
        testID={testID}
        style={[s.anchored, { maxHeight: Math.max(280, Math.floor(winH * 0.7)) }]}
      >
        <View style={s.anchoredHead}>
          <Text accessibilityRole="header" testID={titleTestID} style={s.anchoredTitle}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="dialog-close"
            onPress={onClose}
            style={({ hovered }: { hovered?: boolean }) => [
              s.anchoredClose,
              hovered === true ? { backgroundColor: "var(--hover)" } : null,
            ]}
          >
            <Text style={s.closeX}>{"\u00d7"}</Text>
          </Pressable>
        </View>
        <ScrollView style={s.anchoredBody} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    );
  // quiet buttons first, then the primary or danger one, each built in a loop (not a list of rows)
  const buttons: ReactElement[] = [];
  for (const a of actions) if (!a.primary && !a.danger) buttons.push(<ActionButton key={a.label} a={a} />);
  for (const a of actions) if (a.primary || a.danger) buttons.push(<ActionButton key={a.label} a={a} />);
  return (
    <Overlay>
      <View
        testID={veilTestID}
        style={[
          s.veil,
          isFull && s.veilBig,
          full && s.veilFull,
          web ? ({ animation: "vyre-dlg-veil 140ms ease-out both" } as object) : null,
        ]}
      >
        <Pressable accessibilityLabel="Close" accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          ref={card as never}
          role="dialog"
          aria-modal
          accessibilityLabel={title}
          testID={testID}
          style={[
            s.card,
            { maxWidth: isFull ? "100%" : wide },
            isFull && s.cardBig,
            full && s.cardFull,
            web ? ({ animation: "vyre-dlg-card 180ms cubic-bezier(.2,.8,.2,1) both" } as object) : null,
          ]}
        >
          {isFull ? (
            <View style={s.head}>
              <View style={s.headMain}>
                {header ?? (
                  <Text accessibilityRole="header" testID={titleTestID} style={s.title}>
                    {title}
                  </Text>
                )}
              </View>
              {captureKeys ? (
                <Text testID="sheet-hint" style={s.hint}>
                  {captureKeys.hint}
                </Text>
              ) : null}
              <Pressable
                ref={closeBtn as never}
                accessibilityRole="button"
                accessibilityLabel="Close"
                testID="sheet-close"
                onPress={onClose}
                style={({ hovered }: { hovered?: boolean }) => [
                  s.close,
                  hovered === true ? { backgroundColor: "var(--hover)" } : null,
                ]}
              >
                <Text style={s.btnText}>Close</Text>
              </Pressable>
            </View>
          ) : (
            <Text accessibilityRole="header" testID={titleTestID} style={s.title}>
              {title}
            </Text>
          )}
          {isFull && bar ? <View style={s.bar}>{bar}</View> : null}
          {children && isFull ? (
            <View style={s.bodyBig}>{children}</View>
          ) : children ? (
            full ? (
              <ScrollView style={s.bodyFull} contentContainerStyle={s.bodyIn} keyboardShouldPersistTaps="handled">
                {children}
              </ScrollView>
            ) : (
              <View style={s.body}>{children}</View>
            )
          ) : null}
          {note ? <Text style={s.note}>{note}</Text> : null}
          {actions.length ? <View style={s.actions}>{buttons}</View> : null}
        </View>
      </View>
    </Overlay>
  );
}

const s = StyleSheet.create({
  veil: {
    position: (web ? "fixed" : "absolute") as unknown as "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99998,
    backgroundColor: "rgba(8,8,10,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  card: {
    width: "100%",
    backgroundColor: "var(--raised)" as string,
    borderRadius: 16,
    paddingTop: 22,
    paddingBottom: 18,
    paddingHorizontal: 24,
    boxShadow: "0 0 0 1px var(--line-2), 0 30px 80px -20px rgba(0,0,0,.55), 0 8px 24px rgba(0,0,0,.18)",
  } as never,
  veilBig: { paddingVertical: 16 },
  veilFull: { paddingHorizontal: 0, alignItems: "stretch", justifyContent: "flex-start" },
  cardFull: {
    maxWidth: "100%",
    height: "100%",
    borderRadius: 0,
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: 16,
  } as never,
  anchored: {
    width: "100%",
    maxHeight: 420,
    backgroundColor: "var(--raised)" as string,
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "var(--sh-pop)",
  } as never,
  anchoredHead: { flexDirection: "row", alignItems: "center", height: 44, paddingLeft: 16, paddingRight: 8 },
  anchoredTitle: { flex: 1, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  anchoredBody: { paddingHorizontal: 16, minHeight: 0 },
  anchoredClose: { width: 28, height: 28, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  closeX: { fontSize: 18, lineHeight: 20, color: "var(--ink-3)" as string },
  cardBig: { height: "100%", paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0, overflow: "hidden" } as never,
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  headMain: { flex: 1, minWidth: 0 },
  hint: { fontSize: 12, color: "var(--ink-3)" as string },
  close: { height: 28, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  bar: {
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  bodyBig: { flex: 1, minHeight: 0 },
  note: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string, marginTop: 14 },
  bodyIn: { gap: 12 },
  bodyFull: { flex: 1, minHeight: 0, marginTop: 12 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: "var(--ink)" as string, letterSpacing: -0.2 },
  body: { marginTop: 12, gap: 12 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    columnGap: 8,
    rowGap: 8,
    marginTop: 22,
  },
  btn: { height: 32, paddingHorizontal: 14, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnQuiet: { backgroundColor: "transparent" },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink-2)" as string },
});
