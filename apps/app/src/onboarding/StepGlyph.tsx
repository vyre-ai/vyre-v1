// A step's icon: the 16 px stroke path from stepStyle on a gradient tile (or the bare glyph), drawn as plain SVG on the web.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, View } from "react-native";
import type { FlowKind } from "./flow.ts";
import { stepLook } from "./stepStyle.ts";

const CHECK = ["M3.500 8.500l3 3 6-7"], DASH = ["M4 8h8"];

export function Glyph({ paths, size = 16, color = "#fff", width = 1.6 }: { paths: readonly string[]; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const kids: ReactElement[] = [];
  for (const d of paths) kids.push(createElement("path", { key: d, d }));
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } }, ...kids);
}

export const CHECK_PATH = CHECK, DASH_PATH = DASH;

/** The step's tile: gradient with its icon, or the plain-fill states (done green with a check, dim for a step not reached). */
export function StepTile({ flow, k, size = 28, state = "open", testID }: { flow: FlowKind; k: string; size?: number; state?: "open" | "done" | "dim"; testID?: string }): ReactElement {
  const look = stepLook(flow, k);
  const fill = state === "done" ? { backgroundColor: "var(--ok)" } : state === "dim" ? { backgroundColor: "var(--sunk)", borderWidth: 1, borderColor: "var(--line)" } : { backgroundImage: `linear-gradient(180deg, ${look.from}, ${look.to})` };
  const glyph = Math.round(size * 0.54);
  return (
    <View testID={testID} style={[{ width: size, height: size, borderRadius: Math.round(size * 0.29), alignItems: "center", justifyContent: "center" }, fill as object]}>
      <Glyph paths={state === "done" ? CHECK : look.icon} size={glyph} color={state === "dim" ? "var(--ink-4)" : "#fff"} width={state === "done" ? 2.2 : 1.6} />
    </View>
  );
}
