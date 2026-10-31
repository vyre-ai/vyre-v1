// ui/Tooltip: the browser's own tooltip on whatever it wraps, for the help that would otherwise be a line of text on the page. The wrapper takes no box of its own (display: contents),
// so a flex row lays out exactly as it did without it. Off the web it draws the children as they are.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

export function Tooltip({ text, children }: { text: string; children: ReactElement }): ReactElement {
  if (Platform.OS !== "web" || text === "") return children;
  return createElement("div", { title: text, style: { display: "contents" } }, children);
}
