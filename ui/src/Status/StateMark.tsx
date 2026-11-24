// ui/Status StateMark: the state a row's work is in, as one small glyph and never a word in the row (owner, 19 Nov 2026: "come up with indicators for Needs review and things like that or Blocked ...
// Less text, more let the design do the talking"). It sits at the row's trailing edge, where the word used to be. Ten states, ten outlines, so a state is never told by colour alone; three colours
// carry meaning and the rest stay ink:
//   yours (accent)   review: an eye · allow: a shield with a check · answer: a speech bubble with a question · sign: a signature
//   wrong            blocked: a stop sign, overdue: a clock (warn) · failed: a triangle (danger)
//   calm (ink)       waiting: an hourglass · done: a check             live (beacon)   running: an open ring that turns (still under reduced motion)
// The words are in the tip (hover and keyboard focus, through ui/Tooltip) and in the accessible name. The mark is never its own button: a press on it is a press on its row, and the row's menu leads
// with what the state asks. Where a row already has a tooltip that says the state, pass `tip={false}` so one tip shows, not two. Off the web there is no svg: the short word is drawn instead.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Tooltip } from "../Tooltip/index.tsx";
import { injectCss } from "../theme/css.ts";
import { MARK_COLOR, STATE_MARKS, stateWords } from "./states.ts";
import type { WorkState } from "./states.ts";
export { MARK_COLOR, STATE_MARKS, WORK_STATES, stateWords } from "./states.ts";
export type { MarkTone, WorkState } from "./states.ts";

export const STATE_MARK_CSS = [
  "@keyframes vyre-sm-turn{to{transform:rotate(360deg)}}",
  ".vyre-sm-running{animation:vyre-sm-turn 2.4s linear infinite;transform-origin:50% 50%}",
  "@media (prefers-reduced-motion:reduce){.vyre-sm-running{animation:none}}",
].join("\n");

export interface StateMarkProps {
  state: WorkState;
  /** The reason, said after the words: "Sol needs a key to continue". */
  note?: string;
  size?: number;
  /** False where the row's own tooltip already says the state. */
  tip?: boolean;
  testID?: string;
}

export function StateMark({ state, note, size = 16, tip = true, testID }: StateMarkProps): ReactElement {
  const m = STATE_MARKS[state];
  const color = MARK_COLOR[m.tone];
  const label = stateWords(state, note);
  const id = testID ?? `state-${state}`;
  if (Platform.OS !== "web")
    return (
      <Text testID={id} accessibilityLabel={label} style={[st.word, { color }]}>
        {m.short}
      </Text>
    );
  if (state === "running")
    injectCss(
      (globalThis as { document?: Parameters<typeof injectCss>[0] }).document,
      "vyre-ui-state-mark",
      STATE_MARK_CSS,
    );
  const kids = [
    ...m.d.map((d) => createElement("path", { key: d, d, fill: "none" })),
    ...(m.fill ?? []).map((d) => createElement("path", { key: d, d, fill: color, stroke: "none" })),
  ];
  const mark = (
    <View
      testID={id}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={st.box}
      {...({ dataSet: { state, tone: m.tone } } as object)}
    >
      {createElement(
        "svg",
        {
          viewBox: "0 0 16 16",
          width: size,
          height: size,
          "aria-hidden": true,
          ...(state === "running" ? { className: "vyre-sm-running" } : {}),
          style: {
            display: "block",
            flex: "none",
            overflow: "visible",
            stroke: color,
            strokeWidth: 1.5,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
        },
        ...kids,
      )}
    </View>
  );
  return tip ? <Tooltip text={note ? `${m.words}\n${note}` : m.words}>{mark}</Tooltip> : mark;
}

const st = StyleSheet.create({
  box: { width: 18, height: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  word: { fontSize: 12, fontWeight: "600" },
});
