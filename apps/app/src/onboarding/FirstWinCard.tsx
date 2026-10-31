// The "First win" step: a short list of starter routines to pick from. Continue creates the pick as an Automation, turns it on and runs it now (automations.create, set_enabled, run).
// A run needs an AI account, so without one the card says so in one line and offers Connect your AI instead of an empty list.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";

export interface Starter { id: string; title: string; line: string; prompt: string }

/** The routines on offer; each is one AI step started by hand, so it can run the moment it is made. */
export const STARTERS: readonly Starter[] = [
  { id: "morning", title: "Morning summary", line: "The day's meetings and what is due", prompt: "Four lines. The day's meetings, then what is due, then what is waiting on me." },
  { id: "inbox", title: "Inbox triage", line: "What needs a reply today", prompt: "Look at my unread mail. List the five that need a reply today, with one line on each." },
  { id: "week", title: "Week ahead", line: "A plan for the next seven days", prompt: "Look at my calendar and tasks for the next seven days. Give me a short plan, busiest day first." },
  { id: "recap", title: "End of day recap", line: "What got done and what carries over", prompt: "Write a short recap of today: what got done, what moves to tomorrow, and anything I should not forget." },
];

export function FirstWinCard({ call, hasAi, gate, onConnectAi, starters = STARTERS }: { call: CapCall; hasAi: boolean; gate?(save: (() => Promise<boolean>) | null): void; onConnectAi?(): void; starters?: readonly Starter[] }): ReactElement {
  const [pick, setPick] = useState<string | null>(null);
  const [error, setError] = useState("");
  const made = useRef<string | null>(null);
  const save = async (): Promise<boolean> => {
    const st = starters.find((x) => x.id === pick);
    if (!st) return false;
    setError("");
    try {
      if (made.current === null || !made.current.startsWith(`${st.id}:`)) {
        const out = (await call("automations.create", {
          name: st.title, idempotencyKey: `first-win:${st.id}`,
          definition: { triggers: [{ key: "manual" }], nodes: [{ id: "step", key: "ai", title: st.title, input: { prompt: st.prompt } }], start: ["step"] },
        })) as { automation: { id: string } };
        made.current = `${st.id}:${out.automation.id}`;
      }
      const id = made.current.slice(st.id.length + 1);
      await call("automations.set_enabled", { automationId: id, enabled: true });
      await call("automations.run", { automationId: id, payload: {} });
      return true;
    } catch (e) { setError(e instanceof Error && e.message ? e.message : "The routine did not start. Try again."); return false; }
  };
  useEffect(() => {
    if (!gate) return undefined;
    gate(hasAi && pick !== null ? save : null);
    return () => gate(null);
  });
  if (!hasAi) {
    return (
      <View testID="first-win-needs-ai" style={s.col}>
        <Text style={s.line}>A routine needs an AI account to run.</Text>
        {onConnectAi ? <Pressable testID="first-win-connect" accessibilityRole="button" onPress={onConnectAi} style={s.primary}><Text style={s.primaryText}>Connect your AI</Text></Pressable> : null}
      </View>
    );
  }
  return (
    <View testID="first-win-card" style={s.col}>
      {starters.map((st) => (
        <Pressable key={st.id} testID={`starter-${st.id}`} accessibilityRole="radio" accessibilityState={{ selected: pick === st.id }} onPress={() => setPick(st.id)} style={[s.row, pick === st.id && s.rowOn]}>
          <View style={s.text}><Text style={s.title}>{st.title}</Text><Text style={s.note}>{st.line}</Text></View>
        </Pressable>
      ))}
      {error ? <Text accessibilityRole="alert" testID="first-win-error" style={s.err}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  rowOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string },
  line: { fontSize: 15, lineHeight: 22, color: "var(--ink)" as string },
  err: { fontSize: 13, color: "var(--danger)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "var(--accent-ink, #fff)" as string },
});
