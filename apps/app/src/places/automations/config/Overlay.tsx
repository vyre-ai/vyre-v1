// A sheet over the pane: a quiet backdrop that closes it, the content centred, Escape closes. The shell has no shared sheet frame yet, so the config pane and the Journey designer share this one.
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import type { ViewStyle } from "react-native";
import { webOnly } from "../canvas/parts.tsx";

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as ViewStyle["position"];

export function Overlay({ children, onClose, label, testID }: { children: ReactNode; onClose(): void; label: string; testID?: string }): ReactElement {
  return (
    <View testID={testID ?? "overlay"} accessibilityLabel={label} style={o.layer} {...webOnly({ role: "dialog", "aria-modal": true, onKeyDown: (e: { key: string; stopPropagation?: () => void }) => { if (e.key === "Escape") { e.stopPropagation?.(); onClose(); } } })}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={o.backdrop} />
      <View style={o.center} pointerEvents="box-none">{children}</View>
    </View>
  );
}

const o = StyleSheet.create({
  layer: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, zIndex: 2147482000 },
  backdrop: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.28)" as string },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
});
