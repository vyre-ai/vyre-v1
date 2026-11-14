// The round table card under a message that asked several agents and was answered by each (chat gap G57): a tab per agent, that agent's answer, and "Go with <name>". Folds away by itself once the
// person writes anything, the Decided line included. "Let them discuss" starts the talk in the thread under the message and opens it.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Face } from "../needsyou/parts.tsx";
import { CONVERSATION_SCREEN } from "../conversation/Conversation.tsx";
import { useConversationData } from "../conversation/data.tsx";
import { useLive } from "../mounts/live.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { asksSeveral } from "./round-model.ts";
import { roundAnswers } from "./round-table-model.ts";

type MessagesOut = CapMap["chat.messages.list"]["out"];

function Table({
  messageId,
  threadId,
  agents,
  nameOf,
  onOpen,
}: {
  messageId: string;
  threadId: string;
  agents: readonly string[] | null;
  nameOf(id: string): string;
  onOpen(): void;
}): ReactElement | null {
  const data = useConversationData();
  const q = useLive<MessagesOut>(data.screens, CONVERSATION_SCREEN, "messages", { threadId });
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.status !== "ready") return null;
  const answers = roundAnswers(q.data.messages as never, messageId, data.me.id, agents);
  if (answers === null) return null;
  const on = answers.find((a) => a.agentId === pick) ?? answers[0]!;
  const first = (id: string): string => nameOf(id).split(" ")[0] ?? nameOf(id);
  const decide = (): void => {
    if (busy) return;
    setBusy(true);
    try {
      void Promise.resolve(
        data.call("chat.round.decide", {
          threadId,
          messageId,
          agentId: on.agentId,
          idempotencyKey: `round-${messageId}-${on.agentId}`,
        }),
      ).then(
        () => setBusy(false),
        () => setBusy(false),
      );
    } catch {
      setBusy(false);
    }
  };
  const discuss = (): void => {
    if (busy) return;
    setBusy(true);
    try {
      void Promise.resolve(
        data.call("chat.round.discuss", { threadId, messageId, idempotencyKey: `discuss-${messageId}` }),
      ).then(
        () => {
          setBusy(false);
          onOpen();
        },
        () => setBusy(false),
      );
    } catch {
      setBusy(false);
    }
  };
  return (
    <View testID={`round-table-${messageId}`} style={st.card}>
      <View accessibilityRole="tablist" style={st.tabs}>
        {answers.map((a) => (
          <Pressable
            key={a.agentId}
            testID={`round-table-${messageId}-tab-${a.agentId}`}
            accessibilityRole="tab"
            aria-selected={a.agentId === on.agentId}
            onPress={() => setPick(a.agentId)}
            style={[st.tab, a.agentId === on.agentId && st.tabOn]}
          >
            <Face name={nameOf(a.agentId)} seedId={a.agentId} kind="agent" size={20} />
            <Text style={st.tabText}>{first(a.agentId)}</Text>
          </Pressable>
        ))}
      </View>
      <Text testID={`round-table-${messageId}-answer`} style={st.answer}>
        {on.text}
      </Text>
      <View style={st.foot}>
        <Pressable
          testID={`round-table-${messageId}-go`}
          accessibilityRole="button"
          disabled={busy}
          onPress={decide}
          style={st.go}
        >
          <Text style={st.goText}>{`Go with ${first(on.agentId)}`}</Text>
        </Pressable>
        <Pressable
          testID={`round-table-${messageId}-discuss`}
          accessibilityRole="button"
          disabled={busy}
          onPress={discuss}
          style={st.talk}
        >
          <Text style={st.talkText}>Let them discuss</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Draws nothing, and reads nothing, unless the message asked several agents. */
export function RoundTable(p: {
  messageId: string;
  threadId: string;
  body: string;
  mentions?: readonly { kind: string; id: string }[] | undefined;
  nameOf(id: string): string;
  onOpen(): void;
}): ReactElement | null {
  if (!asksSeveral(p)) return null;
  const tagged = (p.mentions ?? []).filter((x) => x.kind === "agent").map((x) => x.id);
  return (
    <Table
      messageId={p.messageId}
      threadId={p.threadId}
      agents={tagged.length > 1 ? tagged : null}
      nameOf={p.nameOf}
      onOpen={p.onOpen}
    />
  );
}

const st = StyleSheet.create({
  card: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    backgroundColor: "var(--surface)" as string,
  },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  tabOn: { backgroundColor: "var(--hover)" as string },
  tabText: { fontSize: 13, color: "var(--ink)" as string, fontWeight: "500" },
  answer: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  foot: { flexDirection: "row", gap: 8 },
  go: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "var(--accent)" as string },
  talk: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
  talkText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  goText: { fontSize: 13, fontWeight: "600", color: "var(--on-accent)" as string },
});
