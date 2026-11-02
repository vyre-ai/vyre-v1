// Records > Agents: the agents themselves, from agents.list, so it can never disagree with Chats. A row opens the agent's own page. New makes a real agent and opens it.
// A row left over from before New made real agents has nothing behind it: it stays here, marked, and opens the page that offers to set it up. Rows that name a real agent are not shown twice.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row as UiRow } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { NOT_SET_UP, agentsRows, listAgents } from "../recordpage/agentlink.ts";
import type { AgentLite, AgentsRow } from "../recordpage/agentlink.ts";
import { useLive, useOnline, useRecordsData } from "../sidebar/data.tsx";
import { HeadButton } from "../sidebar/parts.tsx";
import type { TypeDef } from "../table/model.ts";

const countLine = (n: number): string => `${n.toLocaleString("en-US")} ${n === 1 ? "agent" : "agents"}`;

export function AgentsView({ def }: { def: Pick<TypeDef, "key" | "plural" | "titleField"> }): ReactElement {
  const data = useRecordsData();
  const online = useOnline();
  const [agents, setAgents] = useState<AgentLite[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState<{ name: string; busy: boolean; error?: string } | null>(null);
  const load = useCallback(() => {
    setFailed(false);
    listAgents(data.call).then(setAgents, () => setFailed(true));
  }, [data.call]);
  useEffect(load, [load]);
  const old = useLive("records.query", { type: def.key, offset: 0, limit: 500 });
  const rows = agents ? agentsRows(agents, old.status === "ready" ? old.data.rows : [], def.titleField) : [];

  const create = (): void => {
    if (!adding || adding.busy) return;
    const name = adding.name.trim();
    if (name === "") { setAdding({ ...adding, error: "Give the agent a name." }); return; }
    setAdding({ name, busy: true });
    data.call("agents.create", { name, idempotencyKey: `new-agent-${Date.now()}` }).then((out) => {
      setAdding(null);
      data.nav.openAgent?.((out as { agent: { agentId: string } }).agent.agentId);
    }, (e: unknown) => {
      const x = e as { error?: { message?: string }; message?: string };
      setAdding({ name, busy: false, error: x?.error?.message ?? x?.message ?? "Could not make the agent." });
    });
  };

  return (
    <View style={l.main} testID="records-agents" accessibilityLabel="Agents list">
      <View style={l.head}>
        <Text accessibilityRole="header" style={l.title}>{def.plural}</Text>
        <HeadButton icon="plus" label="New" filled testID="records-new" onPress={() => setAdding({ name: "New agent", busy: false })} />
      </View>
      {online ? null : <Text style={l.offline} accessibilityRole="alert">Offline, showing your saved copy</Text>}
      {adding ? (
        <View style={l.draft} accessibilityRole="toolbar" testID="records-adding">
          <TextInput
            value={adding.name} onChangeText={(t) => setAdding({ name: t, busy: false })} placeholder="New agent" placeholderTextColor="var(--ink-3)" accessibilityLabel="New agent" testID="records-adding-input"
            autoFocus selectTextOnFocus editable={!adding.busy} onSubmitEditing={create} onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") setAdding(null); }} style={l.draftInput}
          />
          {adding.error ? <Text style={[l.footText, l.danger]} accessibilityRole="alert" testID="records-adding-error">{adding.error}</Text> : <Text style={l.footText}>{adding.busy ? "Creating…" : "Enter saves, Esc cancels"}</Text>}
        </View>
      ) : null}
      <View style={l.sheet}>
        {failed ? <States kind="error" message="The agents could not be read." retryable onRetry={load} />
          : agents === null ? <States kind="empty" title="Reading agents…" icon="records" />
          : rows.length === 0 ? <States kind="empty" title="No agents yet." icon="records" />
          : (
            <VirtualList<AgentsRow>
              data={rows} rowHeight={44} keyOf={(r) => (r.kind === "agent" ? r.agent.agentId : r.recordId)} renderItem={(r) => (
                <View style={l.cell} testID={r.kind === "agent" ? `agent-${r.agent.agentId}` : `old-${r.recordId}`}>
                  {r.kind === "agent" ? (
                    <UiRow id={`agent-row-${r.agent.agentId}`} title={r.agent.name} note={r.agent.role ?? "Agent"} leading={<View style={l.face}><Avatar name={r.agent.name} seedId={r.agent.face ?? r.agent.agentId} kind="agent" size={24} /></View>} onPress={() => data.nav.openAgent?.(r.agent.agentId)} />
                  ) : (
                    <UiRow id={`old-row-${r.recordId}`} title={r.name} note={NOT_SET_UP} leading={<View style={l.face}><Avatar name={r.name} seedId={r.recordId} kind="agent" size={24} /></View>} onPress={() => data.nav.openRecord(r.recordId)} />
                  )}
                </View>
              )}
            />
          )}
      </View>
      <View style={l.foot}><Text style={l.footText} testID="records-count">{countLine(agents?.length ?? 0)}</Text></View>
    </View>
  );
}

const l = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  head: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, gap: 8 },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  offline: { paddingHorizontal: 18, paddingBottom: 6, fontSize: 12, color: "var(--ink-3)" as string },
  draft: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingBottom: 8 },
  draftInput: { flex: 1, minWidth: 0, maxWidth: 320, height: 30, paddingHorizontal: 8, fontSize: 13, color: "var(--ink)" as string, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6 },
  sheet: { flex: 1, minHeight: 0, paddingHorizontal: 10, paddingTop: 6 },
  cell: { height: 44, justifyContent: "center" },
  face: { marginRight: 8, marginLeft: 2 },
  foot: { height: 32, justifyContent: "center", paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  footText: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  danger: { color: "var(--danger)" as string },
});
