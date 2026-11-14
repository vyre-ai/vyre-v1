// Mount for lane chat-chapters: the pieces that sit beside a long session. In the chat, a background job's quiet line (terminal.list is stood in for); in a pane column, the Session block of the Crew tab,
// the Kept tab and the /context card.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import {
  ContextCard,
  KeptTab,
  NO_USAGE,
  SessionBlock,
  metersOf,
} from "../../../apps/app/src/places/chats/conversation/chapters/index.ts";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";

export const title = "Chapters, pieces";

export default function Mount(): ReactNode {
  const sample = useMemo(() => {
    const s = createSample("idle");
    const rows = {
      status: "ready",
      data: {
        terminals: [
          {
            terminalId: "term_1",
            name: "full-test-suite",
            agentId: "agt_intake",
            state: "running",
            exitCode: null,
            createdAt: Date.now() - (2 * 60 + 14) * 1000,
            lastActiveAt: Date.now(),
          },
        ],
      },
    };
    const base = s.data;
    return {
      ...s,
      data: {
        ...base,
        // the live terminal rows the job line subscribes to (screen chats.terminal-list)
        screens: {
          ...base.screens,
          query: (screen: string, name: string, state: Record<string, unknown>) =>
            screen === "chats.terminal-list"
              ? {
                  subscribe: () => () => undefined,
                  getSnapshot: () => rows,
                }
              : base.screens.query(screen, name, state),
        },
      },
    };
  }, []);
  const at = Date.UTC(2025, 9, 24, 12, 0);
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Conversation data={sample.data} />
      </View>
      <View style={{ width: 420, padding: 16, backgroundColor: "var(--side)" as string }}>
        <SessionBlock
          summary={{ from: at, to: at + (4 * 60 + 12) * 60_000, steps: 318 }}
          usage={{ ...NO_USAGE, context: 42, plan: 61, session: 12 }}
        />
        <View style={{ height: 24 }} />
        <KeptTab
          summary={{
            decisions: [
              {
                messageId: "d1",
                kind: "decision",
                label: "Decision",
                sub: "A file link stays private until shared",
                at,
                by: "usr_irfad",
              },
            ],
            notes: [
              {
                messageId: "n1",
                title: "How large can an upload be?",
                body: "Two gigabytes, measured on the server.",
                at,
              },
            ],
          }}
          onJump={() => undefined}
          trail={() => "Maya, 3:53 PM"}
        />
        <ContextCard
          meters={metersOf({ ...NO_USAGE, context: 42, plan: 61, session: 12 })}
          keepEvery="the open questions"
          onCompact={async () => undefined}
          onKnows={() => undefined}
        />
      </View>
    </View>
  );
}
