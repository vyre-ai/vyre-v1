// A sheet for detail on the phone (spec 3.11): it rises from the bottom over the screen, with a grabber, a title and a close; a tap outside or Esc closes it. Drawn in the shared Overlay layer
// so no list or header can cover it.
import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Overlay } from "../../../../../ui/src/Overlay/index.tsx";

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }): ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <Overlay>
      <View testID="sheet" style={st.layer}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} testID="sheet-scrim" style={st.scrim} />
        <View role="dialog" aria-label={title} aria-modal style={st.panel}>
          <View style={st.grab} />
          <View style={st.head}>
            <Text accessibilityRole="header" style={st.title}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} testID="sheet-close" style={st.close}><Text style={st.closeText}>Done</Text></Pressable>
          </View>
          <View style={st.body}>{children}</View>
        </View>
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  layer: { position: "fixed" as "absolute", left: 0, top: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
  scrim: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.32)" },
  panel: { maxHeight: "80%", backgroundColor: "var(--raised)" as string, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 20, alignSelf: "center", width: "100%", maxWidth: 520 },
  grab: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "var(--line-2)" as string, marginTop: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, height: 44 },
  title: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  close: { height: 32, paddingHorizontal: 8, justifyContent: "center" },
  closeText: { fontSize: 15, fontWeight: "500", color: "var(--accent)" as string },
  body: { paddingHorizontal: 8 },
});
