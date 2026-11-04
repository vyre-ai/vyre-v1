// A profile on a phone: a full-screen page over the shell, with a back arrow and the person's name in its own header. It sits in the shared Overlay layer, so the bottom nav, the tab chip and the
// pane toggle of the computer's side pane are not drawn above it (owner, 4 Nov: phone sheets have a back arrow and a title and no bottom nav).
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { Glyph } from "../conversation/parts.tsx";

export function PhoneProfile({ title, onBack, children }: { title: string; onBack(): void; children: ReactNode }): ReactElement {
  return (
    <Overlay>
      <View testID="phone-profile" role="dialog" aria-label={title} aria-modal style={st.page}>
        <View style={st.head}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} testID="phone-profile-back" style={st.back}>
            <Glyph name="back" size={18} color="var(--accent)" />
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={st.title}>{title}</Text>
          <View style={st.back} />
        </View>
        <View style={st.body}>{children}</View>
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  page: { position: "fixed" as "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "var(--side)" as string, paddingTop: "env(safe-area-inset-top)" as unknown as number },
  head: { flexDirection: "row", alignItems: "center", height: 48, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  body: { flex: 1, minHeight: 0 },
});
