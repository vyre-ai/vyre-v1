// ui/Tip: hover help. The words a row, a button or a section used to carry as a sentence live in the browser's own tooltip instead, so the page shows an icon or a state and the
// explanation waits for the pointer. A `display: contents` span carries the tooltip without touching the layout; off the web there is nothing to hover and the child draws alone.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, Text, View } from "react-native";

const web = Platform.OS === "web";

export function Tip({ help, children }: { help: string | undefined; children: ReactElement }): ReactElement {
  if (!web || !help) return children;
  return createElement("span", { title: help, style: { display: "contents" } }, children);
}

const INFO = ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 7.2v3.6M8 5.2h.01"];

/** A small round "i" whose tooltip is the help text. It reads as a quiet mark, never as a line of text; a screen reader gets the sentence as the label. */
export function Info({ help, testID }: { help: string; testID?: string }): ReactElement {
  const icon = web
    ? createElement("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true, style: { display: "block", stroke: "var(--ink-4)", fill: "none", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } }, ...INFO.map((d) => createElement("path", { key: d, d })))
    : <Text style={{ color: "var(--ink-4)" as string, fontSize: 12 }}>i</Text>;
  return (
    <Tip help={help}>
      <View accessible accessibilityRole="image" accessibilityLabel={help} testID={testID} style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>{icon}</View>
    </Tip>
  );
}
