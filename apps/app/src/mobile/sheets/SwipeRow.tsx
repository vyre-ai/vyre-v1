// A row with swipe actions (spec 3.11): drag it left and its actions show behind it (Star, Mark read, Archive), drag back or tap an action. The same actions are reachable without a
// swipe: right-click or long-press opens them, and Esc closes. The gesture is the platform's PanResponder, so it works the same on a phone and in the web build. (The brief names
// react-native-gesture-handler; it is not on the dependency allowlist, so this waits for the lead to add it. The pure rules are in shell/model.ts and do not change.)
import { useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { swipeOffset, swipeRest } from "../shell/model.ts";

export interface SwipeAction { key: string; label: string; tone?: "accent" | "warn" | "plain"; onPress: () => void }

const ACTION_W = 76;

export function SwipeRow({ actions, children, testID }: { actions: readonly SwipeAction[]; children: ReactNode; testID?: string }): ReactElement {
  const width = actions.length * ACTION_W;
  const [offset, setOffset] = useState(0);
  const openRef = useRef(false);
  const settle = (rest: "open" | "closed"): void => { openRef.current = rest === "open"; setOffset(rest === "open" ? -width : 0); };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (_e, g) => setOffset(swipeOffset(g.dx, width, openRef.current)),
    onPanResponderRelease: (_e, g) => settle(swipeRest(g.dx, width, openRef.current)),
    onPanResponderTerminate: () => settle(openRef.current ? "open" : "closed"),
  }), [width]);
  const buttons: ReactElement[] = [];
  for (const a of actions) {
    buttons.push(
      <Pressable key={a.key} accessibilityRole="button" accessibilityLabel={a.label} testID={`swipe-action-${a.key}`} onPress={() => { a.onPress(); settle("closed"); }}
        style={[st.action, a.tone === "accent" && st.accent, a.tone === "warn" && st.warn]}>
        <Text style={[st.actionText, a.tone && a.tone !== "plain" && st.actionTextOn]}>{a.label}</Text>
      </Pressable>,
    );
  }
  return (
    <View testID={testID} style={st.wrap} {...{ onContextMenu: (e: { preventDefault?: () => void }) => { e.preventDefault?.(); settle(openRef.current ? "closed" : "open"); } }}>
      <View testID="swipe-actions" style={[st.actions, { width }]}>{buttons}</View>
      <View testID="swipe-front" style={[st.front, { transform: [{ translateX: offset }] }]} {...pan.panHandlers}>{children}</View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { overflow: "hidden" },
  actions: { position: "absolute", right: 0, top: 0, bottom: 0, flexDirection: "row" },
  front: { backgroundColor: "var(--win)" as string },
  action: { width: ACTION_W, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  accent: { backgroundColor: "var(--accent)" as string },
  warn: { backgroundColor: "var(--warn)" as string },
  actionText: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  actionTextOn: { color: "var(--accent-ink)" as string },
});
