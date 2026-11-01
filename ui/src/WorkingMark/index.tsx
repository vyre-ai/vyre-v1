// ui/WorkingMark: the Vyre mark as the sign that an agent is working. The V stroke with its short right arm and the purple dot (the geometry of AppIcon's `vyre`), at about 16 px, moved only by real work:
//   thinking  the dot breathes slowly (2.4 s)                        writing   a soft light travels down and up the V (1.8 s)
//   a step    the dot dips along the right arm toward the V's point and rises back once (700 ms), on every real step change, so the mark moves with the work and is never a loop of its own
//   done      the dot settles into place and the mark fades away      still    the mark at rest (a finished reply's row)
// CSS and SVG only: no animation loop and no re-render per frame. The ink is currentColor, so both themes work. Reduced motion: the mark is still. The rules go in through the sheet (injectCss), so the
// packaged app's style nonce does not drop them. Native has no svg here: a plain dot.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, View } from "react-native";
import { injectCss } from "../theme/css.ts";

export type WorkingMarkState = "thinking" | "writing" | "done" | "still";
export interface WorkingMarkProps {
  state: WorkingMarkState;
  /** Changes with each real step (a call starting, a result arriving): each change is one nod of the dot. Empty or absent: none. */
  step?: string;
  size?: number;
  testID?: string;
}

const V = "M5.2 6.4l6.3 11.2 4.9-8.6";
const DOT = "#7C6CF0";

export const WORKING_MARK_CSS = [
  ".vyre-wm .vyre-wm-dot{transform-box:fill-box;transform-origin:center}",
  "@keyframes vyre-wm-breathe{0%,100%{transform:scale(.82);opacity:.75}50%{transform:scale(1);opacity:1}}",
  "@keyframes vyre-wm-nod{0%{transform:translate(0,0)}45%{transform:translate(-4.1px,6.9px)}100%{transform:translate(0,0)}}",
  "@keyframes vyre-wm-light{from{stroke-dashoffset:18}to{stroke-dashoffset:-82}}",
  "@keyframes vyre-wm-settle{0%{transform:scale(1.25)}60%{transform:scale(.92)}100%{transform:scale(1)}}",
  "@keyframes vyre-wm-out{to{opacity:0}}",
  ".vyre-wm-thinking .vyre-wm-dot,.vyre-wm-writing .vyre-wm-dot{animation:vyre-wm-breathe 2.4s ease-in-out infinite}",
  ".vyre-wm-step{animation:vyre-wm-nod 700ms ease-in-out 1}",
  ".vyre-wm-light{stroke-dasharray:18 100;stroke-dashoffset:18;opacity:.9;animation:vyre-wm-light 1.8s ease-in-out infinite alternate}",
  ".vyre-wm-done .vyre-wm-dot{animation:vyre-wm-settle 500ms ease-out 1 both}",
  ".vyre-wm-done{animation:vyre-wm-out 600ms ease-in 500ms 1 forwards}",
  "@media (prefers-reduced-motion:reduce){.vyre-wm *{animation:none!important}.vyre-wm{animation:none!important}.vyre-wm .vyre-wm-light{display:none}}",
].join("\n");

export function WorkingMark({ state, step, size = 16, testID }: WorkingMarkProps): ReactElement {
  if (Platform.OS !== "web") return <View testID={testID} style={{ width: size / 2.2, height: size / 2.2, borderRadius: size, backgroundColor: DOT, margin: size / 4.4 }} />;
  injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-ui-working-mark", WORKING_MARK_CSS);
  const kids = [
    createElement("path", { key: "v", d: V, fill: "none", stroke: "currentColor", strokeWidth: 3.1, strokeLinecap: "round", strokeLinejoin: "round" }),
    ...(state === "writing" ? [createElement("path", { key: "light", className: "vyre-wm-light", d: V, pathLength: 100, fill: "none", stroke: "var(--accent)", strokeWidth: 3.1, strokeLinecap: "round", strokeLinejoin: "round" })] : []),
    // the key restarts the nod: one new key, one dip
    createElement("g", { key: `dot-${step ?? ""}`, className: step ? "vyre-wm-step" : undefined }, createElement("circle", { className: "vyre-wm-dot", cx: 18.6, cy: 5.6, r: 2.7, fill: DOT })),
  ];
  return createElement("svg", { className: `vyre-wm vyre-wm-${state}`, viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, "data-testid": testID, "data-state": state, style: { flexShrink: 0, overflow: "visible" } }, ...kids);
}
