// The chapter rail (G10, prototype .map): a thin column of dots on the right edge of the message column, one per chapter, the current one lit. Press a dot to go to the chapter; hover or focus names it
// with the line it settled. Shown only where there are chapters and the column is wide enough; the keys alt up and alt down step between chapters.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { Dot } from "./model.ts";

/** A phone has no rail: its chapters are the folded lines in the column. */
export const RAIL_MIN_WIDTH = 640;
const MAX_DOTS = 40;

export function ChapterRail({
  dots,
  onJump,
  width: given,
}: {
  dots: readonly Dot[];
  onJump: (startSeq: number) => void;
  /** The width the rail is judged against; the window's own when not given. */
  width?: number;
}): ReactElement | null {
  const win = useWindowDimensions().width;
  const width = given ?? win;
  const [on, setOn] = useState<number | null>(null);
  if (dots.length < 2 || width < RAIL_MIN_WIDTH) return null;
  // a very long chat keeps the newest dots; the older ones stay reachable as folded lines
  const shown = dots.length > MAX_DOTS ? dots.slice(dots.length - MAX_DOTS) : dots;
  return (
    <View
      testID="chapter-rail"
      accessibilityRole="toolbar"
      accessibilityLabel="Chapters"
      style={st.rail}
      pointerEvents="box-none"
    >
      {shown.map((d) => (
        <View key={d.startSeq} style={st.slot}>
          <Pressable
            testID={`chapter-dot-${d.startSeq}`}
            accessibilityRole="button"
            accessibilityLabel={`${d.title}${d.current ? ", now" : ""}`}
            onPress={() => onJump(d.startSeq)}
            onHoverIn={() => setOn(d.startSeq)}
            onHoverOut={() => setOn((s) => (s === d.startSeq ? null : s))}
            onFocus={() => setOn(d.startSeq)}
            onBlur={() => setOn((s) => (s === d.startSeq ? null : s))}
            style={st.hit}
          >
            <View style={[st.dot, d.lit ? st.lit : on === d.startSeq ? st.hover : undefined]} />
          </Pressable>
          {on === d.startSeq ? (
            <View testID={`chapter-tip-${d.startSeq}`} pointerEvents="none" style={st.tip}>
              <Text numberOfLines={1} style={st.tipTitle}>
                {d.title}
              </Text>
              <Text numberOfLines={2} style={st.tipSummary}>
                {d.current ? "Now" : d.summary}
              </Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  rail: {
    position: "absolute",
    right: 6,
    top: 0,
    bottom: 0,
    width: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
  },
  slot: { width: 24, alignItems: "center" },
  hit: { width: 24, height: 20, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string, opacity: 0.55 },
  lit: { backgroundColor: "var(--accent)" as string, opacity: 1 },
  hover: { backgroundColor: "var(--ink-2)" as string, opacity: 1 },
  tip: {
    position: "absolute",
    right: 28,
    top: -6,
    width: 220,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "var(--win)" as string,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
  tipTitle: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  tipSummary: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 2 },
});
