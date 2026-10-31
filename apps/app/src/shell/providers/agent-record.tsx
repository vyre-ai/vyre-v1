// Opening an agent from Records. The agent's own page (Chats > agent page) is where an agent lives; a Records row only finds it. A row with no agent behind it (made before New made real agents)
// says so in one line and offers to set it up through agents.create, then opens the agent.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { States } from "../../../../../ui/src/States/index.tsx";
import { NOT_SET_UP, SET_UP, agentFor } from "../../places/records/recordpage/agentlink.ts";
import type { AgentLite } from "../../places/records/recordpage/agentlink.ts";
import type { ShellRuntime } from "./runtime.tsx";

type Call = ShellRuntime["call"];

/** Every agent the person can see, teammates included, across pages. */
export async function listAgents(call: Call): Promise<AgentLite[]> {
  const out: AgentLite[] = [];
  let cursor: string | undefined;
  do {
    const r = await call("agents.list", { teammates: "include", ...(cursor ? { cursor } : {}) }) as { agents: AgentLite[]; next?: string };
    out.push(...r.agents);
    cursor = r.next;
  } while (cursor);
  return out;
}

/** The agent behind an Agents row, or the name it has when none is. */
export async function agentOfRecord(call: Call, recordId: string): Promise<{ agent: AgentLite } | { missing: string }> {
  const rec = await call("records.get", { type: "agent", recordId }) as { record: { fields: Record<string, unknown> } };
  const name = String(rec.record.fields["name"] ?? "").trim();
  const agent = agentFor(name, await listAgents(call));
  return agent ? { agent } : { missing: name };
}

export const openAgent = (rt: ShellRuntime, agentId: string): void => rt.open({ screen: "chats.agent-page", args: { agentId } });

/** The Agents row opened on its own (a link): the agent's page opens from here, or the row is set up. */
export function AgentRecord({ rt, recordId }: { rt: ShellRuntime; recordId: string }): ReactElement {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "missing"; name: string; busy: boolean; error?: string } | { kind: "error" }>({ kind: "loading" });
  const find = useCallback(() => {
    setState({ kind: "loading" });
    agentOfRecord(rt.call, recordId).then((r) => { if ("agent" in r) openAgent(rt, r.agent.agentId); else setState({ kind: "missing", name: r.missing, busy: false }); }, () => setState({ kind: "error" }));
  }, [rt, recordId]);
  useEffect(find, [find]);
  const setUp = (name: string): void => {
    setState({ kind: "missing", name, busy: true });
    rt.call("agents.create", { name, idempotencyKey: `setup-agent-${recordId}` }).then((out) => openAgent(rt, (out as { agent: { agentId: string } }).agent.agentId), (e: unknown) => {
      const x = e as { error?: { message?: string }; message?: string };
      setState({ kind: "missing", name, busy: false, error: x?.error?.message ?? x?.message ?? "Could not set it up." });
    });
  };
  if (state.kind === "error") return <States kind="error" message="That agent is unavailable or you do not have access." retryable onRetry={find} />;
  if (state.kind === "loading") return <States kind="empty" title="Opening agent…" icon="records" />;
  return (
    <View style={s.box} testID="agent-not-set-up">
      <Text accessibilityRole="header" style={s.title}>{state.name || "Agent"}</Text>
      <Text style={s.line}>{NOT_SET_UP}</Text>
      {state.error ? <Text style={s.err}>{state.error}</Text> : null}
      <Pressable accessibilityRole="button" testID="agent-set-up" disabled={state.busy || state.name === ""} onPress={() => setUp(state.name)} style={s.btn}><Text style={s.btnText}>{state.busy ? "Setting up…" : SET_UP}</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  box: { flex: 1, padding: 32, gap: 10, alignItems: "flex-start" },
  title: { fontSize: 22, fontWeight: "600", color: "var(--ink)" as unknown as string },
  line: { fontSize: 14, color: "var(--ink-2)" as unknown as string },
  err: { fontSize: 13, color: "var(--danger)" as unknown as string },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "var(--accent)" as unknown as string },
  btnText: { fontSize: 14, fontWeight: "600", color: "var(--accent-ink)" as unknown as string },
});
