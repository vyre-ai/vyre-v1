// The pieces every Console page is made of: a section head and a grouped card. Colours are skin tokens, so a skin switch repaints with no re-render.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { Dot, Glyph } from "./glyphs.tsx";
import type { Tone } from "./glyphs.tsx";

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
/** Whether a Help is inside a Group: it then sits in the card's corner instead of on a line of its own. */
export const InGroup = createContext(false);
export function Group({ children, testID }: { children: ReactNode; testID?: string }): ReactElement {
  return <View style={s.group} testID={testID}><InGroup.Provider value>{children}</InGroup.Provider></View>;
}
/** The page header collects the help of Helps that sit on no card: one info mark next to the title instead of a stray icon. */
export const PageHelpContext = createContext<((text: string) => () => void) | null>(null);
export const useInGroup = (): boolean => useContext(InGroup);

export function LinkButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }): ReactElement {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} testID={testID} onPress={onPress} style={pointer}>
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}

/** A designed empty state: an icon on a quiet tile, two or three words, and at most one action. */
export function Empty({ children, testID, icon = "data", action }: { children: ReactNode; testID?: string; icon?: string; action?: { label: string; onPress: () => void } }): ReactElement {
  return (
    <View style={s.empty} testID={testID}>
      <View style={s.emptyTile}><Glyph name={icon} size={18} color="var(--ink-3)" /></View>
      <Text style={s.emptyText}>{children}</Text>
      {action ? <Pressable accessibilityRole="button" testID={testID ? `${testID}-action` : "empty-action"} onPress={action.onPress} style={[s.emptyAction, pointer]}><Text style={s.emptyActionText}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

/** The leading slot of a Row: the icon or face, with the gap the text needs. The shared Row sets none. */
export function Lead({ children }: { children: ReactNode }): ReactElement {
  return <View style={s.lead}>{children}</View>;
}

const STATUS_TONE: Readonly<Record<string, Tone>> = { active: "ok", awake: "ok", working: "ok", healthy: "ok", pending: "warn", paused: "warn", degraded: "warn", suspended: "warn", failed: "bad", down: "bad", revoked: "off", asleep: "off", disabled: "off", archived: "off" };
/** A state as a dot and a capitalised word, never "active ·" in a note. */
export function StatusLabel({ status }: { status: string }): ReactElement {
  const word = status ? `${status[0]!.toUpperCase()}${status.slice(1)}` : "";
  return <View style={s.status} testID={`status-${status}`}><Dot tone={STATUS_TONE[status] ?? "off"} size={7} /><Text style={s.statusText}>{word}</Text></View>;
}

const s = StyleSheet.create({
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { fontSize: 12, color: "var(--ink-3)" as string },
  section: { marginBottom: 22 },
  head: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, minHeight: 28, marginBottom: 6, paddingHorizontal: 2 },
  title: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-3)" as string },
  count: { fontSize: 12, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  group: { padding: 4, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  link: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  empty: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 28, paddingHorizontal: 16 },
  emptyTile: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  emptyText: { fontSize: 13, fontWeight: "500", color: "var(--ink-2)" as string, textAlign: "center" },
  emptyAction: { height: 28, paddingHorizontal: 12, borderRadius: 7, justifyContent: "center", backgroundColor: "var(--ink)" as string },
  emptyActionText: { fontSize: 12.5, fontWeight: "500", color: "var(--win)" as string },
  lead: { marginRight: 10, alignItems: "center", justifyContent: "center" },
});
