// The live line under a reply that is being written: one calm line that says what the agent is really doing ("Thinking", "Reading", "Searching the web", the last of its thinking), changing with a soft
// crossfade, with a small mark that breathes. Press it for the trail (the steps so far and the thinking); press again to fold it. All of it comes from the host's step and thinking frames over the live
// link: nothing here is invented, nothing is saved, and the thinking is the person's chat content and is only ever drawn, never logged. Reduced motion stops the shimmer, the fade and the breathing.
import { createElement, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ActivityStore } from "../../../shell/session/turn-streams.ts";
import { activityLine, elapsedWords, stepWords, thinkingExcerpt } from "./activity.ts";

const CSS = `
@keyframes vy-shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
@keyframes vy-fade { from { opacity: 0; transform: translateY(2px) } to { opacity: 1; transform: none } }
@keyframes vy-breathe { 0%, 100% { opacity: .35; transform: scale(.85) } 50% { opacity: 1; transform: scale(1) } }
.vy-shimmer { background: linear-gradient(90deg, var(--ink-3) 0%, var(--ink) 50%, var(--ink-3) 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: vy-shimmer 2.6s linear infinite; }
.vy-fade { animation: vy-fade 220ms ease-out; display: inline-block; white-space: nowrap; padding-right: 1px; }
.vy-breathe { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: vy-breathe 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .vy-shimmer { animation: none; background: none; -webkit-text-fill-color: currentColor; } .vy-fade { animation: none } .vy-breathe { animation: none; opacity: .8 } }
`;
let injected = false;
function ensureCss(): void {
  if (injected || Platform.OS !== "web" || typeof document === "undefined") return;
  injected = true;
  try { const el = document.createElement("style"); el.setAttribute("data-vyre", "activity"); el.textContent = CSS; document.head.appendChild(el); } catch { /* a page that will not take a style gets the plain line */ }
}

const web = (cls: string, children: string): ReactElement | string => (Platform.OS === "web" ? createElement("span", { className: cls }, children) : children);

export function ActivityLine({ store }: { store: ActivityStore }): ReactElement {
  ensureCss();
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  const secs = Math.max(0, Math.round((now - snap.startedAt) / 1000));
  const line = activityLine(snap);
  const clock = elapsedWords(secs);
  const text = clock === "" ? line.label : `${line.label} · ${clock}`;
  const rows: ReactElement[] = [];
  for (const s of snap.steps) rows.push(<Text key={s.id} testID={`activity-step-${s.id}`} style={st.step}>{`${s.state === "live" ? "•" : s.state === "failed" ? "×" : "✓"}  ${s.name !== "" ? stepWords(s.name) : "A step"}`}</Text>);
  const thought = thinkingExcerpt(snap.thinking, 420);
  return (
    <View testID="activity" accessibilityLiveRegion="polite" style={st.root}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${text}. ${open ? "Hide" : "Show"} what it is doing`} testID="activity-line" onPress={() => setOpen((o) => !o)} style={st.row}>
        {Platform.OS === "web" ? createElement("span", { className: "vy-breathe", "aria-hidden": true }) : <View style={st.dot} />}
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
