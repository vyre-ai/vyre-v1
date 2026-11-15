// Agents in Trash, as rows of the Files Trash (F77): the agent's avatar, its name, "Agent", when it went to Trash and when Trash will erase it by itself; Restore and Delete for good. While the job
// runs the row says Deleting and has no buttons; when it is done the row is gone and one line says so. A person's Assistant has no Delete for good (it goes with its person).
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { notices } from "../../../shell/noticeslot/model.ts";
import { Face } from "../../chats/needsyou/parts.tsx";
import { TextButton } from "../../chats/rightpane/parts.tsx";
import { useFilesData, useLive } from "../tree/data.tsx";
import { tellIfRefused } from "../tree/refusal.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A day in the Space's time: "14 Dec". */
export function dayText(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * 60_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export interface TrashAgent {
  agentId: string;
  name: string;
  kind: string;
  deletedAt: number;
  deleting: boolean;
  folderId?: string | undefined;
  erasesAt?: number | undefined;
  canDelete: boolean;
}

/** The agents in Trash (a live read), or none while it loads. */
export function useTrashAgents(on: boolean): readonly TrashAgent[] {
  const q = useLive("agents.trash.list", on ? {} : null);
  return q.status === "ready" ? (q.data.agents as readonly TrashAgent[]) : [];
}

export function AgentTrashRows({
  agents,
  onDelete,
}: {
  agents: readonly TrashAgent[];
  onDelete(a: TrashAgent): void;
}): ReactElement | null {
  const data = useFilesData();
  const offset = data.clock().offsetMin;
  const was = useRef<Map<string, { name: string; deleting: boolean }>>(new Map());
  useEffect(() => {
    // a row that said Deleting and is gone: one line says it is done
    const now = new Map(agents.map((a) => [a.agentId, a] as const));
    for (const [id, p] of was.current) if (p.deleting && !now.has(id)) notices.pass(`${p.name} was deleted for good.`);
    was.current = new Map(agents.map((a) => [a.agentId, { name: a.name, deleting: a.deleting }] as const));
  }, [agents]);
  if (agents.length === 0) return null;
  return (
    <View testID="trash-agents" style={st.box}>
      {agents.map((a) => (
        <Row
          key={a.agentId}
          id={`trash-agent-${a.agentId}`}
          title={a.name}
          note={
            a.deleting
              ? "Deleting"
              : `Agent · Moved to Trash ${dayText(a.deletedAt, offset)}${a.erasesAt !== undefined ? ` · Erased on ${dayText(a.erasesAt, offset)}` : ""}`
          }
          leading={<Face name={a.name} seedId={a.agentId} kind="agent" size={22} />}
          trailing={
            a.deleting ? (
              <Text style={st.deleting} testID={`trash-deleting-${a.agentId}`}>
                Deleting
              </Text>
            ) : (
              <View style={st.btns}>
                <TextButton
                  label="Restore"
                  testID={`trash-restore-${a.agentId}`}
                  onPress={() =>
                    tellIfRefused(data.call("agents.restore", { agentId: a.agentId }), `Could not restore ${a.name}`)
                  }
                />
                {a.canDelete ? (
                  <TextButton label="Delete for good" testID={`trash-forgood-${a.agentId}`} onPress={() => onDelete(a)} />
                ) : null}
              </View>
            )
          }
        />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  box: { paddingHorizontal: 6, paddingTop: 6 },
  btns: { flexDirection: "row", alignItems: "center", gap: 4 },
  deleting: { fontSize: 12, color: "var(--ink-3)" as string },
});
