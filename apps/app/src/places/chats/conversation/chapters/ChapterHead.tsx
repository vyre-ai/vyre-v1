// The heading of a chapter (prototype .ch). The open chapter: its title large, the time it began at the right. A folded one: one line, the title and what it settled, the time on hover. Press or
// Enter opens and closes it. It fades in over 160 ms (G73) and never moves what is under it.
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ChapterRow } from "./model.ts";

/** One 160 ms ease for everything that arrives in a chat (owner, prototype d-logic). */
export const ENTER_MS = 160;

export function useEnter(): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: ENTER_MS, useNativeDriver: Platform.OS !== "web" }).start();
  }, [v]);
  return v;
}

export function ChapterHead({
  row,
  onToggle,
}: {
  row: ChapterRow;
  onToggle: (startSeq: number) => void;
}): ReactElement {
  const fade = useEnter();
  return (
    <Animated.View style={{ opacity: fade }}>
      <Pressable
        testID={row.key}
        accessibilityRole="button"
        accessibilityState={{ expanded: row.open }}
        accessibilityLabel={row.open ? `${row.title}, ${row.time}` : `${row.title}. ${row.summary}. ${row.time}`}
        accessibilityHint={row.open ? "Folds this part of the chat" : "Opens this part of the chat"}
        onPress={() => onToggle(row.startSeq)}
        style={({ hovered, focused }: { hovered?: boolean; focused?: boolean }) => [
          row.open ? st.open : st.closed,
          row.open ? undefined : (hovered === true || focused === true) && st.hover,
        ]}
      >
        {({ hovered, focused }: { hovered?: boolean; focused?: boolean }) => (
          <View style={st.line}>
            <Text numberOfLines={1} style={row.open ? st.titleOpen : st.titleClosed}>
              {row.title}
            </Text>
            {row.open ? null : (
              <Text numberOfLines={1} style={st.summary}>
                {row.summary}
              </Text>
            )}
            <Text
              style={[
                st.time,
                row.open ? st.timeOpen : st.timeClosed,
                (hovered === true || focused === true) && st.timeOn,
              ]}
            >
              {row.time}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  open: { marginTop: 44, marginBottom: 12 },
  closed: {
    marginVertical: 3,
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  hover: { backgroundColor: "var(--hover)" as string },
  line: { flexDirection: "row", alignItems: "baseline", gap: 10, minWidth: 0 },
  titleOpen: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "600",
    letterSpacing: -0.25,
    color: "var(--ink)" as string,
    flexShrink: 1,
  },
  titleClosed: { fontSize: 13.5, fontWeight: "500", color: "var(--ink-2)" as string, flexShrink: 0 },
  summary: { fontSize: 13, color: "var(--ink-3)" as string, flex: 1, minWidth: 0 },
  time: { fontSize: 12, color: "var(--ink-4)" as string, flexShrink: 0 },
  timeOpen: { marginLeft: "auto" },
  timeClosed: { opacity: 0 },
  timeOn: { opacity: 1 },
});
