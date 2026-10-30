// ui/TeamOnly: where a feature needs a Team Space and this Space is Personal. One designed card: an icon, two or three words, and one quiet action. No sentence, no pill.
// The icon is a 16 px path set (the same viewBox as ui/States); colours are skin tokens, so a skin switch repaints with no re-render.
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

export interface TeamOnlyProps {
  /** Two or three words: what is locked, such as "Agent computers". */
  title: string;
  /** SVG path data on a 16 px grid. */
  icon: readonly string[];
  /** One short line, shown only when the title alone would not say it. */
  line?: string;
  /** The action's words. */
  action?: string;
  onAction?: () => void;
  testID?: string;
}

export const TEAM_ONLY_ACTION = "Set up a team";

/** A small monitor, for agent computers. */
export const COMPUTER_ICON: readonly string[] = ["M2.5 3.5h11a1 1 0 011 1v6a1 1 0 01-1 1h-11a1 1 0 01-1-1v-6a1 1 0 011-1z", "M5.5 13.5h5M8 11.5v2"];

const web = Platform.OS === "web";

function Glyph({ paths }: { paths: readonly string[] }): ReactElement {
  if (!web) return <Text style={st.fallback}>+</Text>;
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: 26, height: 26, "aria-hidden": true, style: { fill: "none", stroke: "var(--accent)", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", display: "block" } },
    ...paths.map((d) => createElement("path", { key: d, d })),
  );
}

export function TeamOnly({ title, icon, line, action = TEAM_ONLY_ACTION, onAction, testID }: TeamOnlyProps): ReactElement {
  const [focus, setFocus] = useState(false);
  return (
    <View testID={testID ?? "team-only"} accessibilityLabel={`${title}. Needs a Team Space.`} style={st.card}>
      <View style={st.tile}><Glyph paths={icon} /></View>
      <Text accessibilityRole="header" style={st.title}>{title}</Text>
      {line ? <Text style={st.line}>{line}</Text> : null}
      <Pressable
        accessibilityRole="button" accessibilityLabel={action} onPress={onAction} testID="team-only-action" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [st.button, hovered === true && st.hover, pressed === true && st.down, focus && st.ring]}
      >
        <Text style={st.buttonText}>{action}</Text>
      </Pressable>
    </View>
  );
}

const RING = { boxShadow: "0 0 0 2px var(--accent)" } as object;
const st = StyleSheet.create({
  card: { alignSelf: "center", alignItems: "center", gap: 10, paddingVertical: 28, paddingHorizontal: 20, maxWidth: 320 },
  tile: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent-wash)" as string, borderWidth: 1, borderColor: "var(--accent-line)" as string },
  fallback: { color: "var(--accent)" as string, fontSize: 22 },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string, textAlign: "center", marginTop: 4 },
  line: { fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center" },
  button: { height: 32, paddingHorizontal: 14, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 4, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  hover: { backgroundColor: "var(--hover)" as string },
  down: { backgroundColor: "var(--press, var(--hover))" as string },
  ring: RING,
  buttonText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
});
