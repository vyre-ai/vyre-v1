// Draws nothing. It tells the pane's session context what the open chat holds (the Overview reads it) and hands the context the way to scroll to a message (a jump point in the Overview).
import { useEffect, useMemo } from "react";
import type { ReactElement } from "react";
import type { Message } from "../conversation/model.ts";
import { useSession } from "./context.tsx";
import { summaryOf } from "./model.ts";

export function SessionPublisher({ messages, meId, jump }: { messages: readonly Message[]; meId: string; jump: (messageId: string) => void }): ReactElement | null {
  const session = useSession();
  const summary = useMemo(() => summaryOf(messages, meId), [messages, meId]);
  useEffect(() => { session?.publish(summary); }, [session?.publish, summary]);   // eslint-disable-line react-hooks/exhaustive-deps -- the context value changes with the summary it holds
  useEffect(() => { session?.onJump(jump); return () => session?.onJump(null); });   // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
