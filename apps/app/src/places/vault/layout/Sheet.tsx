// Vault sheet: the one overlay for Add and Edit. A dimmed backdrop, a panel centred on wide windows and full height on a phone, Escape closes, focus stays inside.
import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { IconBtn } from "./parts.tsx";

export function Sheet({ title, onClose, children, footer, testID, icon }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; testID?: string; icon?: ReactNode }): ReactElement {
  const narrow = useWindowDimensions().width < 640;
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    doc.addEventListener("keydown", onKey, true as never);
    return () => doc.removeEventListener("keydown", onKey, true as never);
  }, [onClose]);
  return (
    <View style={s.layer} testID={testID} accessibilityViewIsModal accessibilityRole="dialog" accessibilityLabel={title}>
      <Pressable accessible={false} style={s.backdrop} onPress={onClose} testID={testID ? `${testID}-backdrop` : undefined} />
      <View style={[s.panel, narrow ? s.panelNarrow : s.panelWide]}>
        <View style={s.head}>
          {icon ? <View style={s.icon} testID={testID ? `${testID}-icon` : undefined}>{icon}</View> : null}
          <Text accessibilityRole="header" style={s.title}>{title}</Text>
          <View style={{ flex: 1 }} />
          <IconBtn icon="x" label="Close" onPress={onClose} testID={testID ? `${testID}-close` : undefined} />
        </View>
        <ScrollView style={s.bodyScroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        {footer ? <View style={s.foot}>{footer}</View> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  layer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 50, alignItems: "center", justifyContent: "center" },
  backdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.32)" },
  panel: { backgroundColor: "var(--raised)" as string, overflow: "hidden", boxShadow: "var(--sh-pop)" as string },
  panelWide: { width: 700, maxWidth: "92%", maxHeight: "88%", borderRadius: 14 },
  panelNarrow: { width: "100%", height: "100%", borderRadius: 0 },
  head: { height: 48, flexDirection: "row", alignItems: "center", paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  icon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 10, backgroundColor: "var(--accent-wash)" as string },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  bodyScroll: { flexShrink: 1 },
  body: { padding: 18, gap: 12 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
});
