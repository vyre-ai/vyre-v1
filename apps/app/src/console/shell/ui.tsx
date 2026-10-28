// The pieces every Console page is made of: a section head and a grouped card. Colours are skin tokens, so a skin switch repaints with no re-render.
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";

export const web = Platform.OS === "web";
export const pointer = (web ? { cursor: "pointer" } : {}) as ViewStyle;

export function Section({ title, count, right, children, testID }: { title: string; count?: number | string; right?: ReactNode; children: ReactNode; testID?: string }): ReactElement {
  return (
    <View style={s.section} testID={testID ?? `section-${title}`} accessibilityLabel={title}>
      <View style={s.head}>
        <Text accessibilityRole="header" style={s.title}>{title}</Text>
        {count !== undefined && count !== "" ? <Text style={s.count}>{count}</Text> : null}
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

/** The grouped card rows sit in. */
export function Group({ children, testID }: { children: ReactNode; testID?: string }): ReactElement {
  return <View style={s.group} testID={testID}>{children}</View>;
}

export function LinkButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }): ReactElement {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} testID={testID} onPress={onPress} style={pointer}>
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}

export function Empty({ children, testID }: { children: ReactNode; testID?: string }): ReactElement {
  return <View style={s.empty} testID={testID}><Text style={s.emptyText}>{children}</Text></View>;
}

const s = StyleSheet.create({
  section: { marginBottom: 22 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, height: 28, marginBottom: 6, paddingHorizontal: 2 },
  title: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-3)" as string },
  count: { fontSize: 12, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  group: { padding: 4, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  link: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  empty: { minHeight: 40, justifyContent: "center", paddingHorizontal: 12 },
  emptyText: { fontSize: 13, color: "var(--ink-3)" as string },
});
