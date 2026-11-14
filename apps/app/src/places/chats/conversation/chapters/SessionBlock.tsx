// The Session block at the foot of the Crew tab (G63, prototype p-live-pane-crew): how long the session has run, how many steps the agents took, how full the context is and how much of the plan's
// week is used. Four quiet rows, nothing to press. Context and plan come from engine.usage.get, read when the pane opens and every 20 seconds while it is open.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSession } from "../../session/context.tsx";
import { ranWords } from "../../session/model.ts";
import type { SessionSummary } from "../../session/model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

export interface Usage {
  /** 0 to 100, or null when the engine has not said. */
  context: number | null;
  /** The provider's session limit, 0 to 100. */
  session: number | null;
  plan: number | null;
  /** What every compaction of this chat keeps, when set. */
  keepEvery: string;
}

export const NO_USAGE: Usage = { context: null, session: null, plan: null, keepEvery: "" };

/** The share a number of 0 to 1 is, in whole percent; null when there is no window to share against. */
export const pct = (used: number, window: number): number | null =>
  window > 0 && Number.isFinite(used) ? Math.min(100, Math.round((used / window) * 100)) : null;

/** The rows, in order. A row with nothing to say is left out rather than shown empty. */
export function sessionRows(
  s: Pick<SessionSummary, "from" | "to" | "steps">,
  u: Usage,
): Array<{ key: string; label: string; value: string }> {
  const rows: Array<{ key: string; label: string; value: string }> = [];
  if (s.to > s.from) rows.push({ key: "time", label: "Time", value: ranWords(s.from, s.to) });
  if (s.steps > 0) rows.push({ key: "steps", label: "Steps", value: String(s.steps) });
  if (u.context !== null) rows.push({ key: "context", label: "Context", value: `${u.context}%` });
  if (u.plan !== null) rows.push({ key: "plan", label: "Plan this week", value: `${u.plan}%` });
  return rows;
}

export function useUsage(call: Call | undefined, threadId: string, agentId: string): Usage {
  const [u, setU] = useState<Usage>(NO_USAGE);
  useEffect(() => {
    if (!call) return;
    let dead = false;
    const read = (): void => {
      void Promise.resolve(call("engine.usage.get", { threadId, agentId })).then(
        (r) => {
          if (dead) return;
          const o = r as
            | {
                context?: { used: number; window: number } | null;
                session?: { pct: number } | null;
                week?: { pct: number } | null;
                keepEvery?: string;
              }
            | null
            | undefined;
          setU({
            context: o?.context ? pct(o.context.used, o.context.window) : null,
            session: o?.session ? Math.min(100, Math.round(o.session.pct)) : null,
            plan: o?.week ? Math.min(100, Math.round(o.week.pct)) : null,
            keepEvery: o?.keepEvery ?? "",
          });
        },
        () => undefined,
      );
    };
    read();
    const t = setInterval(read, 20_000);
    (t as { unref?: () => void }).unref?.();
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [call, threadId, agentId]);
  return u;
}

export function SessionBlock({
  summary,
  usage,
}: {
  summary: Pick<SessionSummary, "from" | "to" | "steps">;
  usage: Usage;
}): ReactElement | null {
  const rows = sessionRows(summary, usage);
  if (rows.length === 0) return null;
  return (
    <View testID="session-block" accessibilityRole="summary" style={st.box}>
      <Text accessibilityRole="header" style={st.caption}>
        Session
      </Text>
      {rows.map((r) => (
        <View key={r.key} testID={`session-${r.key}`} style={st.row}>
          <Text style={st.label}>{r.label}</Text>
          <Text style={st.value}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  box: { marginTop: 20 },
  caption: { fontSize: 12, color: "var(--ink-4)" as string, paddingHorizontal: 12, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 35,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: "var(--line)" as string,
  },
  label: { fontSize: 13.5, color: "var(--ink-2)" as string },
  value: { fontSize: 13.5, color: "var(--ink)" as string },
});

/** The block as the Crew tab mounts it: one line there. The session's time and steps come from the chat's own summary (the session context), the context and plan from engine.usage.get. */
export function SessionBlockMount({
  call,
  threadId,
  agentId,
}: {
  call: Call | undefined;
  threadId: string;
  agentId: string;
}): ReactElement | null {
  const s = useSession();
  const usage = useUsage(s ? call : undefined, threadId, agentId);
  return s ? <SessionBlock summary={s.summary} usage={usage} /> : null;
}
