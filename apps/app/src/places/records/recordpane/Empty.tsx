// A pane's empty state: an icon and one short line. Never a paragraph.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const PATH = {
  activity: ["M3 8h2.5l1.5-4 2 8 1.5-4H13"],
  comment: ["M3 4.5A1.5 1.5 0 014.5 3h7A1.5 1.5 0 0113 4.5v5A1.5 1.5 0 0111.5 11H8l-3 2.5V11h-.5A1.5 1.5 0 013 9.5z"],
  files: ["M4 2.5h5l3 3v8H4z", "M9 2.5v3h3"],
  chat: ["M2.5 8a5.5 4.5 0 1111 0c0 2.5-2.5 4.5-5.5 4.5-.8 0-1.6-.1-2.3-.4L3 13l.8-2.2C3 10 2.5 9 2.5 8z"],
} as const;
export type EmptyIcon = keyof typeof PATH;

export function PaneEmpty({ icon, text, testID }: { icon: EmptyIcon; text: string; testID?: string }): ReactElement {
  const paths: ReactElement[] = [];
  if (Platform.OS === "web") for (const d of PATH[icon]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return (
    <View style={s.box} testID={testID}>
      {Platform.OS === "web" ? createElement("svg", { viewBox: "0 0 16 16", width: 26, height: 26, "aria-hidden": true, style: { display: "block", stroke: "var(--ink-4)", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } }, ...paths) : null}
      <Text style={s.text}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 36, paddingHorizontal: 16 },
  text: { fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center" },
});
