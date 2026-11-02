// The one status mark of a task: a ring that fills as the work moves, To do to Done, the same in a list, on a card and on the page. A press opens the status menu; a live agent adds the moving ring.
// Web draws it with one stylesheet, so a long list pays for no extra elements. Colours are skin tokens.
import { createElement, memo } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { injectCss } from "../theme/css.ts";
import type { TaskState } from "./model.ts";
import { TASK_STATES } from "./model.ts";

const CSS = [
  ".vy-sd{flex:none;display:inline-grid;place-items:center;border:0;padding:0;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--ink-4);background:none;color:var(--accent-ink);position:relative;cursor:pointer;transition:transform .12s}",
  "button.vy-sd:hover{transform:scale(1.12)}",
  ".vy-sd.s-doing{box-shadow:inset 0 0 0 1.5px var(--accent);background:conic-gradient(var(--accent) 0 50%,transparent 0)}",
  ".vy-sd.s-in_review{box-shadow:inset 0 0 0 1.5px var(--accent);background:conic-gradient(var(--accent) 0 75%,transparent 0)}",
  ".vy-sd.s-awaiting_approval{box-shadow:inset 0 0 0 1.5px var(--warn);background:conic-gradient(var(--warn) 0 85%,transparent 0)}",
  ".vy-sd.s-done{box-shadow:none;background:var(--ok)}",
  ".vy-sd.s-canceled{box-shadow:inset 0 0 0 1.5px var(--line-2)}",
  ".vy-sd.lv:after{content:\"\";position:absolute;inset:-3px;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 50%,var(--accent) 78%,var(--beacon) 100%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 0);mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 0);animation:vy-sd-spin 1.6s linear infinite}",
  "@keyframes vy-sd-spin{to{transform:rotate(1turn)}}",
  "@media (prefers-reduced-motion:reduce){.vy-sd.lv:after{animation:none}}",
].join("\n");

export const stateTitle = (s: TaskState): string => TASK_STATES.find((x) => x.key === s)?.title ?? s;

export interface StatusDotProps {
  state: TaskState;
  size?: number;
  live?: boolean;
  /** Left out: the mark only says, it cannot be pressed. */
  onPress?: (at: { x: number; y: number }) => void;
  testID?: string;
}

export const StatusDot = memo(function StatusDot({ state, size = 20, live = false, onPress, testID }: StatusDotProps): ReactElement {
  const title = stateTitle(state);
  if (Platform.OS === "web") {
    const doc = (globalThis as { document?: Parameters<typeof injectCss>[0] }).document;
    if (doc) injectCss(doc, "vyre-status-dot", CSS);
    const tick = state === "done" ? createElement("svg", { width: Math.round(size * 0.55), height: Math.round(size * 0.55), viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, createElement("path", { d: "M2.5 6.5l2.5 2.5 4.5-5.5" })) : null;
    return createElement(onPress ? "button" : "span", {
      className: `vy-sd s-${state}${live ? " lv" : ""}`, style: { width: size, height: size }, title, "aria-label": `Status: ${title}`, "data-testid": testID, ...(onPress ? {
        type: "button",
        onClick: (e: { stopPropagation(): void; currentTarget: { getBoundingClientRect(): { left: number; bottom: number } } }) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onPress({ x: r.left, y: r.bottom + 6 }); },
      } : {}),
    }, tick);
  }
  const body = <View style={[s.ring, { width: size, height: size, borderRadius: size / 2 }, state === "done" && s.done, (state === "doing" || state === "in_review") && s.on, state === "awaiting_approval" && s.waiting]}>{state === "done" ? <Text style={[s.tick, { fontSize: size * 0.55 }]}>{"✓"}</Text> : null}</View>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Status: ${title}`} testID={testID} onPress={() => onPress({ x: 8, y: 48 })}>{body}</Pressable> : body;
});

const s = StyleSheet.create({
  ring: { borderWidth: 1.5, borderColor: "var(--ink-4)" as string, alignItems: "center", justifyContent: "center" },
  on: { borderColor: "var(--accent)" as string },
  waiting: { borderColor: "var(--warn)" as string },
  done: { backgroundColor: "var(--ok)" as string, borderColor: "var(--ok)" as string },
  tick: { color: "var(--accent-ink)" as string },
});
