// The two layers the screens of this folder open: a popover that hangs under the control that opened it (All agents, the terminal list) and a sheet in the middle of the window
// (Connect an outside agent, the terminal rules). Both draw in the shared Overlay layer over a veil that closes them, both close on Escape, and both hand back the focus they took.
import { useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { Tool } from "../rightpane/parts.tsx";

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as "absolute";

interface DocLike {
  addEventListener(t: string, f: (e: { key: string; preventDefault(): void }) => void): void;
  removeEventListener(t: string, f: (e: { key: string; preventDefault(): void }) => void): void;
  activeElement?: { focus?: () => void } | null;
}

/** Escape closes the layer; the control that had the focus before it opened gets it back. */
function useDismiss(onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: DocLike }).document;
    if (!doc) return undefined;
    const before = doc.activeElement ?? null;
    const onKey = (e: { key: string; preventDefault(): void }): void => { if (e.key === "Escape") { e.preventDefault(); close.current(); } };
    doc.addEventListener("keydown", onKey);
    return () => { doc.removeEventListener("keydown", onKey); before?.focus?.(); };
  }, []);
}

export interface PopoverProps {
  /** The corner under the control that opened it. */
  x: number;
  y: number;
  width?: number;
  label: string;
  testID: string;
  onClose: () => void;
  children: ReactNode;
}

export function Popover({ x, y, width = 340, label, testID, onClose, children }: PopoverProps): ReactElement {
  const win = useWindowDimensions();
  useDismiss(onClose);
  const left = win.width > 0 ? Math.max(8, Math.min(x, win.width - width - 8)) : x;
  const maxH = win.height > 0 ? Math.max(160, win.height - y - 16) : 420;
  return (
    <Overlay>
      <Pressable accessibilityLabel="Close" accessibilityRole="button" testID={`${testID}-veil`} onPress={onClose} style={st.veil} />
      <View testID={testID} role="dialog" aria-label={label} style={[st.pop, { left, top: y, width, maxHeight: maxH }]}>{children}</View>
    </Overlay>
  );
}

export interface SheetProps {
  label: string;
  testID: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ label, testID, width = 460, onClose, children }: SheetProps): ReactElement {
  useDismiss(onClose);
  return (
    <Overlay>
      <View testID={`${testID}-veil`} style={st.sheetVeil}>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={st.fill} />
        <View testID={testID} role="dialog" aria-modal aria-label={label} style={[st.sheet, { width }]}>{children}</View>
      </View>
    </Overlay>
  );
}

/** The head of a sheet or popover: a title, a quiet line under it, and a close button. */
export function LayerHead({ title, sub, onClose, lead }: { title: string; sub?: string; onClose: () => void; lead?: ReactNode }): ReactElement {
  return (
    <View style={st.head}>
      {lead ? <View style={st.lead}>{lead}</View> : null}
      <View style={st.headText}>
        <Text accessibilityRole="header" numberOfLines={1} style={st.title}>{title}</Text>
        {sub ? <Text numberOfLines={2} style={st.sub}>{sub}</Text> : null}
      </View>
      <Tool icon="x" label="Close" onPress={onClose} testID="layer-close" />
    </View>
  );
}

const st = StyleSheet.create({
  veil: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "transparent" },
  pop: { position: FIXED, borderRadius: 12, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string, overflow: "hidden", zIndex: 2 },
  sheetVeil: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.32)" as string },
  fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  sheet: { maxWidth: "92%", maxHeight: "90%", borderRadius: 14, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 },
  lead: { flexShrink: 0 },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
});
