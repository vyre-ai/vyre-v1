import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Conversation } from "../places/chats/conversation/Conversation.tsx";
import { conversationData } from "../shell/providers/chats-data.ts";
import type { ShellRuntime } from "../shell/providers/runtime.tsx";
import { Note } from "./pages/shared.tsx";

export function Assistant({ rt, page }: { rt: ShellRuntime; page: string }): ReactElement {
  const [thread, setThread] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const key = useRef(globalThis.crypto.randomUUID());
  useEffect(() => {
    let live = true;
    void rt.call("console.assistant_open", { page, idempotencyKey: key.current }).then((out) => { if (live) setThread((out as { threadId: string }).threadId); }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, [rt]);
  useEffect(() => { if (thread) void rt.call("console.assistant_context_set", { threadId: thread, page }).catch(() => setError(true)); }, [rt, thread, page]);
  const data = useMemo(() => {
    if (!thread) return null;
    const people = rt.principals.getSnapshot();
    return conversationData(rt, { openThread: (id) => rt.open({ subject: { type: "thread", id } }), togglePane: () => undefined, fillComposer: () => undefined, openAgentChat: (id) => rt.open({ subject: { type: "agent", id } }) }, thread, people.status === "ready" ? people.data : []);
  }, [rt, thread]);
  if (error) return <Note>Couldn’t open the Console assistant. Check your AI account and access.</Note>;
  return data ? <Conversation data={data} /> : <Note>Opening your assistant…</Note>;
}
