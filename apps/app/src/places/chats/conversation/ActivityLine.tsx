// The live line under a reply that is being written: one calm line that says what the agent is really doing ("Thinking", "Reading", "Searching the web", the last of its thinking), changing with a soft
// crossfade, with a small mark that breathes. Press it for the trail (the steps so far and the thinking); press again to fold it. All of it comes from the host's step and thinking frames over the live
// link: nothing here is invented, nothing is saved, and the thinking is the person's chat content and is only ever drawn, never logged. Reduced motion stops the shimmer, the fade and the breathing.
import { createElement, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ActivityStore } from "../../../shell/session/turn-streams.ts";
import { activityLine, elapsedWords, stepLabel, thinkingExcerpt } from "./activity.ts";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import { injectCss } from "../../../../../../ui/src/theme/css.ts";
import { useStream } from "../../../../../../ui/src/stream/useStream.ts";
import { StreamText, createStreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { StreamStore } from "../../../../../../ui/src/stream/index.ts";

const CSS = [
  "@keyframes vy-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}",
  "@keyframes vy-fade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}",
  ".vy-shimmer{background:linear-gradient(90deg,var(--ink-3) 0%,var(--ink) 50%,var(--ink-3) 100%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:vy-shimmer 2.6s linear infinite}",
  ".vy-fade{animation:vy-fade 220ms ease-out;display:inline-block;white-space:nowrap;padding-right:1px}",
  ".vy-done-wrap{overflow:hidden;animation:vy-out 600ms ease-in 500ms 1 forwards}",
  "@keyframes vy-out{to{opacity:0;max-height:0;margin-top:0}}",
  "@media (prefers-reduced-motion:reduce){.vy-shimmer{animation:none;background:none;-webkit-text-fill-color:currentColor}.vy-fade{animation:none}.vy-done-wrap{animation:none}}",
].join("\n");
function ensureCss(): void {
  if (Platform.OS !== "web") return;
  injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-chat-activity", CSS);
}

const NO_STREAM = createStreamStore();

const web = (cls: string, children: string): ReactElement | string => (Platform.OS === "web" ? createElement("span", { className: cls }, children) : children);

/** The body of a reply being written. Before its first word, while the activity line says what the agent is doing, it draws nothing: the line takes that spot and there is no lone caret on an empty line. */
export function LiveBody({ store, hideEmpty, testID, style }: { store: StreamStore; hideEmpty: boolean; testID: string; style: object }): ReactElement | null {
  const snap = useStream(store);
  if (hideEmpty && snap.blocks.length === 0 && !snap.done) return null;
  return <View testID={testID} style={style}><StreamText store={store} /></View>;
}

export function ActivityLine({ store, stream }: { store: ActivityStore; stream?: StreamStore | undefined }): ReactElement {
  ensureCss();
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const words = useStream(stream ?? NO_STREAM).blocks.length > 0;
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  const secs = Math.max(0, Math.round((now - snap.startedAt) / 1000));
  const line = activityLine(snap);
  const clock = snap.done ? "" : elapsedWords(secs);
  const stepSig = snap.steps.map((s) => `${s.id}${s.state[0]}`).join(",");
  const state = snap.done ? "done" : words ? "writing" : "thinking";
  const text = clock === "" ? line.label : `${line.label} · ${clock}`;
  const rows: ReactElement[] = [];
  for (const s of snap.steps) rows.push(<Text key={s.id} testID={`activity-step-${s.id}`} style={st.step}>{`${s.state === "live" ? "•" : s.state === "failed" ? "×" : "✓"}  ${s.name !== "" ? stepLabel(s.name, s.detail) : "A step"}`}</Text>);
  const thought = thinkingExcerpt(snap.thinking, 420);
  const inner = (
    <View testID="activity" accessibilityLiveRegion="polite" style={st.root}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${text}. ${open ? "Hide" : "Show"} what it is doing`} testID="activity-line" onPress={() => setOpen((o) => !o)} style={st.row}>
        <WorkingMark state={state} step={stepSig} size={16} testID="working-mark" />
        <Text style={st.label} key={line.label}>{web("vy-shimmer vy-fade", text)}</Text>
        {line.detail !== "" ? <Text numberOfLines={1} testID="activity-excerpt" style={st.detail}>{line.detail}</Text> : null}
      </Pressable>
      {open ? (
        <View testID="activity-trail" style={st.trail}>
          {rows.length > 0 ? rows : <Text style={st.step}>No steps yet</Text>}
          {thought !== "" ? <Text testID="activity-thinking" style={st.thought}>{thought}</Text> : null}
        </View>
      ) : null}
    </View>
  );
  return Platform.OS === "web" ? createElement("div", { className: snap.done ? "vy-done-wrap" : undefined }, inner) : inner;
}

const st = StyleSheet.create({
  root: { marginTop: 2, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--accent)" as string },
  label: { flexShrink: 0, fontSize: 13, color: "var(--ink-3)" as string },
  detail: { flexShrink: 1, fontSize: 12.5, fontStyle: "italic", color: "var(--ink-4)" as string },
  trail: { marginLeft: 15, paddingLeft: 10, gap: 3, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  step: { fontSize: 12.5, color: "var(--ink-3)" as string },
  thought: { fontSize: 12.5, fontStyle: "italic", lineHeight: 18, color: "var(--ink-4)" as string },
});
