// Small pieces of the runbook viewer shared by the blocks and the History list: the face of who ran it, the spinner, the exit dot, the output text.
import { useRef } from "react";
import type { ReactElement } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";

export const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
export const sx = (o: Record<string, unknown>): ViewStyle => o as unknown as ViewStyle;

const hue = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return (h % 12) * 30;
};

/** A person is a circle, an agent or a computer a rounded square; the colour comes from the name and is translucent so it reads on every skin. A name with a space is a person. */
export function Tile({ name, size = 16 }: { name: string; size?: number }): ReactElement {
  const person = /\s/.test(name.trim());
  const h = hue(name);
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <View aria-hidden testID={`tile-${name}`} style={{ width: size, height: size, borderRadius: person ? size : Math.round(size * 0.3), backgroundColor: `hsla(${h}, 65%, 52%, 0.22)` as string, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: `hsl(${h}, 55%, 46%)` as string, fontSize: Math.max(9, Math.round(size * 0.5)), fontWeight: "600" }}>{letter}</Text>
    </View>
  );
}

export function Spinner({ size = 12 }: { size?: number }): ReactElement {
  return (
    <View testID="spinner" accessibilityLabel="Running" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="small" color="var(--ink-3)" style={{ transform: [{ scale: size / 20 }] }} />
    </View>
  );
}

export function Dot({ tone }: { tone: "ok" | "bad" | "run" | "quiet" }): ReactElement {
  const bg = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--danger)" : tone === "run" ? "var(--accent)" : "var(--ink-4)";
  return <View aria-hidden testID={`dot-${tone}`} style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: bg as string }} />;
}

/** Command output: monospace, wraps, scrolls past 260 px, follows the end while the command is still printing. */
export function OutputPre({ text, follow = false, small = false, testID }: { text: string; follow?: boolean; small?: boolean; testID?: string }): ReactElement {
  const ref = useRef<ScrollView>(null);
  return (
    <ScrollView ref={ref} nestedScrollEnabled style={[st.pre, small && st.preSmall]} testID={testID} onContentSizeChange={() => { if (follow) ref.current?.scrollToEnd({ animated: false }); }}>
      <Text selectable style={[st.preText, small && st.preTextSmall]}>{text || " "}</Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  pre: { maxHeight: 260 },
  preSmall: { maxHeight: 160 },
  preText: { fontFamily: "var(--mono)" as string, fontSize: 12, lineHeight: 19, color: "var(--ink-2)" as string, paddingTop: 4, paddingBottom: 14, paddingLeft: 18, paddingRight: 16 },
  preTextSmall: { paddingLeft: 0, paddingTop: 6, paddingBottom: 2 },
});
