// What the open chat tells the right pane about its session: the conversation reads its own messages, the pane's Overview shows the summary and asks the conversation to jump to a message. Same shape as the crew
// context beside it: one provider around the chat and its pane, and every hook is safe without one (a test, a screenshot).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { NO_SESSION } from "./model.ts";
import type { SessionSummary } from "./model.ts";

export interface SessionCtx {
  summary: SessionSummary;
  /** The conversation says what it holds. Calling it again with the same summary changes nothing. */
  publish(s: SessionSummary): void;
  /** The conversation says how to scroll to a message and mark it. */
  onJump(fn: ((messageId: string) => void) | null): void;
  /** The Overview asks for a message. */
  jump(messageId: string): void;
}

const Ctx = createContext<SessionCtx | null>(null);
export const useSession = (): SessionCtx | null => useContext(Ctx);

export function SessionProvider({ threadId, children }: { threadId: string; children: ReactNode }): ReactElement {
  const [summary, setSummary] = useState<SessionSummary>(NO_SESSION);
  const kept = useRef("");
  const jumper = useRef<((messageId: string) => void) | null>(null);
  useEffect(() => { kept.current = ""; setSummary(NO_SESSION); }, [threadId]);
  const publish = useCallback((s: SessionSummary): void => {
    const key = JSON.stringify(s);
    if (key === kept.current) return;
    kept.current = key;
    setSummary(s);
  }, []);
  const onJump = useCallback((fn: ((messageId: string) => void) | null): void => { jumper.current = fn; }, []);
  const jump = useCallback((id: string): void => { jumper.current?.(id); }, []);
  const value = useMemo<SessionCtx>(() => ({ summary, publish, onJump, jump }), [summary, publish, onJump, jump]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
