// The round row under a message that asked several agents (chat gap G56, G51 part a): each agent's face and state within a second of the send, so a tagged agent that waits its turn never looks ignored.
// Read from engine.round.get once a second while someone has not finished, for a message of the person's own that is under two minutes old. Folds away when every agent has replied.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Face } from "../needsyou/parts.tsx";
import { useConversationData } from "../conversation/data.tsx";
import { asksSeveral, keepReading, stateWords, visibleRound } from "./round-model.ts";
import type { RoundAgent } from "./round-model.ts";

function Round({
  messageId,
  threadId,
  body,
  mentions,
  createdAt,
  nameOf,
}: {
  messageId: string;
  threadId: string;
  body: string;
  mentions?: readonly { kind: string; id: string }[] | undefined;
  createdAt: number;
  nameOf(id: string): string;
}): ReactElement | null {
  const data = useConversationData();
  const [agents, setAgents] = useState<RoundAgent[]>([]);
  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (): void => {
      const age = data.clock().now - createdAt;
      if (age > 120_000) return;
      let next: Promise<unknown>;
      try {
        next = Promise.resolve(data.call("engine.round.get", { threadId, messageIds: [messageId] }));
      } catch {
        return;
      }
      void next.then(
        (r) => {
          if (gone) return;
          const got = (r as { rounds?: { messageId: string; agents: RoundAgent[] }[] }).rounds?.[0]?.agents ?? [];
          setAgents(got);
          if (keepReading(data.clock().now - createdAt, got)) timer = setTimeout(read, 1000);
        },
        () => {
          if (!gone) timer = setTimeout(read, 2000);
        },
      );
    };
    read();
    return () => {
      gone = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [data, threadId, messageId, createdAt]);
  const shown = visibleRound(agents);
  if (shown.length === 0) return null;
  return (
    <View testID={`round-${messageId}`} accessibilityRole="list" style={st.row}>
      {shown.map((a) => (
        <View
          key={a.agentId}
          testID={`round-${messageId}-${a.agentId}`}
          accessibilityLabel={`${nameOf(a.agentId)}: ${stateWords(a, nameOf)}`}
          style={st.item}
        >
          <Face name={nameOf(a.agentId)} seedId={a.agentId} kind="agent" size={18} />
          <Text numberOfLines={1} style={st.text}>
            <Text style={st.name}>{nameOf(a.agentId).split(" ")[0]}</Text>
            {`  ${stateWords(a, (id) => nameOf(id).split(" ")[0] ?? "")}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 6, alignSelf: "flex-end", maxWidth: "85%" },
  item: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  name: { fontSize: 13, color: "var(--ink)" as string, fontWeight: "500" },
  text: { fontSize: 13, color: "var(--ink-3)" as string, flexShrink: 1 },
});

/** Draws nothing, and reads nothing, unless the message asked several agents: a one-agent ask has its own working line, and a message drawn outside a conversation has no data to read. */
export function RoundRow(p: {
  messageId: string;
  threadId: string;
  body: string;
  mentions?: readonly { kind: string; id: string }[] | undefined;
  createdAt: number;
  nameOf(id: string): string;
}): ReactElement | null {
  return asksSeveral(p) ? <Round {...p} /> : null;
}
