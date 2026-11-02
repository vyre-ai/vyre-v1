// The live Assistant of the onboarding screen: the person's own Ask thread with their private assistant, about this screen. It opens (once per person and flow) as an Ask about the
// onboarding screen, tells the Ask door where the person is (setScreenContext with the focus skill for this flow), and draws the same conversation component as every other chat.
// It is drawn only when an AI account is connected; before that the screen speaks the scripted words and the cards still work.
import { isAssistantRow } from "../../../../lib/agent-kind.ts";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { conversationData } from "../shell/providers/chats-data.ts";
import type { ShellRuntime } from "../shell/providers/runtime.tsx";
import { noteThreadKind, setScreenContext } from "../shell/ask/screen.ts";
import type { FlowKind, Progress } from "./flow.ts";
import { onboardingScreen } from "./screen-context.ts";

const ChatsConversation = lazy(() => import("../shell/providers/chats.tsx").then((m) => ({ default: m.ChatsConversation })));

/** The person's private assistant, found the way the Console assistant finds it: their own personal agent of kind assistant. */
export async function findAssistant(rt: Pick<ShellRuntime, "call">, person: string): Promise<string | null> {
  const out = (await rt.call("agents.list", { section: "personal", limit: 100 })) as { agents: { agentId: string; ownerId: string; kind?: string; role?: string }[] };
  return out.agents.find((a) => a.ownerId === person && isAssistantRow(a))?.agentId ?? null;
}

export function AssistantThread({ rt, person, flow, step, progress }: { rt: ShellRuntime; person: string; flow: FlowKind; step: string | null; progress: Progress }): ReactElement {
  const [thread, setThread] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const key = useRef(`onboarding-${person}-${flow}`);
  useEffect(() => {
    let live = true;
    void (async () => {
      const agentId = await findAssistant(rt, person);
      if (!agentId) throw new Error("no assistant");
      const started = (await rt.call("chat.start", { kind: "ask", agentIds: [agentId], scopeType: "onboarding", scopeId: flow, title: "Setting up", idempotencyKey: key.current })) as { thread: { threadId: string } };
      if (live) { noteThreadKind(started.thread.threadId, "ask"); setThread(started.thread.threadId); }
    })().catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [rt, person, flow]);
  // where the person is, for every message they send here; ids only
  useEffect(() => { setScreenContext(onboardingScreen(flow, step, progress)); }, [flow, step, progress]);
  const data = useMemo(() => {
    if (!thread) return null;
    const people = rt.principals.getSnapshot();
    return conversationData(rt, { openThread: (id) => rt.open({ subject: { type: "thread", id } }), togglePane: () => undefined, fillComposer: () => undefined, openAgentChat: (id) => rt.open({ subject: { type: "agent", id } }) }, thread, people.status === "ready" ? people.data : []);
  }, [rt, thread]);
  if (error) return <Text testID="assistant-error" style={{ fontSize: 13, color: "var(--ink-3)" as string }}>I could not open the chat. The steps still work.</Text>;
  return data ? <Suspense fallback={null}><ChatsConversation data={data} compact /></Suspense> : <Text style={{ fontSize: 13, color: "var(--ink-3)" as string }}>Opening your assistant</Text>;
}
