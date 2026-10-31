// Ask Vyre in the Records tab: the person's private assistant, in an Ask thread about Records, drawn in the pane beside the page. The thread is one per type (and one for the place and for the
// Record types page), so asking again about the same thing returns to the same chat. The assistant is told where the person is with the Ask door's screen context (ids and names, never record
// content); a type being made is named in it. It proposes schema changes as a change card with Apply and Discard, and applies nothing until the person presses Apply.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { askContext, askScopeId, ASK_SCOPE } from "../../places/records/askpane/model.ts";
import type { AskAbout } from "../../places/records/askpane/model.ts";
import { findAssistant } from "../../onboarding/AssistantThread.tsx";
import { addScreen, noteThreadKind } from "../ask/screen.ts";
import { conversationData } from "./chats-data.ts";
import type { ShellRuntime } from "./runtime.tsx";

const ChatsConversation = lazy(() => import("./chats.tsx").then((m) => ({ default: m.ChatsConversation })));

/** Another place reusing this pane says its own thread scope and what the assistant is told (Automations does). Records passes nothing. */
export interface AskScope { type: string; id: string; title: string; context: ReturnType<typeof askContext> }

export function RecordsAssistant({ rt, about, title, scope }: { rt: ShellRuntime; about: AskAbout; title?: string; scope?: AskScope }): ReactElement {
  const [thread, setThread] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const scopeId = scope?.id ?? askScopeId(about);
  const scopeType = scope?.type ?? ASK_SCOPE;
  const threadTitle = scope?.title ?? "Records";
  useEffect(() => {
    let live = true;
    setThread(null);
    void (async () => {
      const agentId = await findAssistant(rt, rt.me.id);
      if (!agentId) throw new Error("no assistant");
      const started = (await rt.call("chat.start", { kind: "ask", agentIds: [agentId], scopeType, scopeId, title: threadTitle, idempotencyKey: `${scopeType}-ask-${rt.me.id}-${scopeId}` })) as { thread: { threadId: string } };
      if (live) { noteThreadKind(started.thread.threadId, "ask"); setThread(started.thread.threadId); }
    })().catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [rt, scopeId, scopeType, threadTitle]);
  // where the person is, for every message they send here
  useEffect(() => { addScreen(scope?.context ?? askContext(about, title)); }, [about, title, scope]);
  const data = useMemo(() => {
    if (!thread) return null;
    const people = rt.principals.getSnapshot();
    return conversationData(rt, { openThread: (id) => rt.open({ subject: { type: "thread", id } }), togglePane: () => undefined, fillComposer: () => undefined, openAgentChat: (id) => rt.open({ subject: { type: "agent", id } }) }, thread, people.status === "ready" ? people.data : []);
  }, [rt, thread]);
  if (error) return <Text testID="records-ask-error" style={{ fontSize: 13, color: "var(--ink-3)" as string, padding: 12 }}>I could not open the assistant. Check your AI account.</Text>;
  return data ? <Suspense fallback={null}><ChatsConversation data={data} compact /></Suspense> : <Text style={{ fontSize: 13, color: "var(--ink-3)" as string, padding: 12 }}>Opening your assistant</Text>;
}
