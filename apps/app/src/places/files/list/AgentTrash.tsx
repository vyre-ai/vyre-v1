// Agents in Trash, as rows of the Files Trash (F77): the agent's avatar, its name, "Agent", when it went to Trash and when Trash will erase it by itself; Restore and Delete for good. While the job
// runs the row says Deleting and has no buttons; when it is done the row is gone and one line says so. A person's Assistant has no Delete for good (it goes with its person).
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { notices } from "../../../shell/noticeslot/model.ts";
import { Face } from "../../chats/needsyou/parts.tsx";
import { TextButton } from "../../chats/rightpane/parts.tsx";
import { useDueText } from "../../../../../../ui/src/Time/index.tsx";
import { useFilesData, useLive } from "../tree/data.tsx";
import { tellIfRefused } from "../tree/refusal.ts";
import { isPhoneWidth } from "../../../../../../ui/src/SidePane/layout.ts";

export interface TrashAgent {
  agentId: string;
  name: string;
  kind: string;
  deletedAt: number;
  deleting: boolean;
  folderId?: string | undefined;
  erasesAt?: number | undefined;
  failed?: string | undefined;
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
  const day = useDueText();
  const phone = isPhoneWidth(useWindowDimensions().width);
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
            a.failed !== undefined
              ? `Could not finish deleting: ${a.failed}`
              : a.deleting
                ? "Deleting"
                : phone
                  ? "Agent"
                  : `Agent · Moved to Trash ${day(a.deletedAt)}${a.erasesAt !== undefined ? ` · Erased on ${day(a.erasesAt)}` : ""}`
          }
          leading={
            <View style={st.face}>
              <Face name={a.name} seedId={a.agentId} kind="agent" size={22} />
            </View>
          }
          trailing={
            a.failed !== undefined ? (
              <TextButton
                label="Try again"
                testID={`trash-retry-${a.agentId}`}
                onPress={() =>
                  tellIfRefused(
                    data.call("agents.delete_for_good", { agentId: a.agentId }),
                    `Could not try again for ${a.name}`,
                  )
                }
              />
            ) : a.deleting ? (
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
                  <TextButton
                    label="Delete for good"
                    testID={`trash-forgood-${a.agentId}`}
                    onPress={() => onDelete(a)}
                  />
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
  face: { marginRight: 6, marginLeft: 4 },
  btns: { flexDirection: "row", alignItems: "center", gap: 4 },
  deleting: { fontSize: 12, color: "var(--ink-3)" as string },
});
