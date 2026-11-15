// An agent's page reached after the agent went to Trash (an old link, a tab left open): one calm line that it is in Trash, with Restore for whoever manages it, in place of an error (F77).
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TextButton } from "../rightpane/parts.tsx";

interface Row {
  agentId: string;
  name: string;
  deleting: boolean;
  canDelete: boolean;
}

/** Null while it is asked, and when the agent is not in Trash (the page then shows what it showed before). */
export function AgentInTrash({
  agentId,
  call,
  fallback,
}: {
  agentId: string;
  call(cap: string, input: unknown): Promise<unknown>;
  fallback: ReactElement;
}): ReactElement {
  const [row, setRow] = useState<Row | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    call("agents.trash.list", {}).then(
      (r) => live && setRow((r as { agents: Row[] }).agents.find((a) => a.agentId === agentId) ?? null),
      () => live && setRow(null),
    );
    return () => {
      live = false;
    };
  }, [agentId, call]);
  if (row === undefined) return <View />;
  if (row === null) return fallback;
  return (
    <View style={st.box} testID="agent-in-trash">
      <Text style={st.line}>
        {row.deleting ? `${row.name} is being deleted for good.` : `${row.name} is in Trash.`}
      </Text>
      {!row.deleting && row.canDelete ? (
        <TextButton
          label="Restore"
          testID="agent-in-trash-restore"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            call("agents.restore", { agentId }).then(
              () => undefined,
              () => setBusy(false),
            );
          }}
        />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  box: { padding: 24, gap: 12, alignItems: "flex-start" },
  line: { fontSize: 15, color: "var(--ink)" as string },
});
