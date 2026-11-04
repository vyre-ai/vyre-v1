// "Agents reply in threads": one switch for the chat, in the chat's More menu. On, an agent asked in the chat answers under that message; off, it answers in the chat.
// It reads the chat's own row and writes threads.set_agent_replies; the page changes with the row.
import { useCallback, useEffect, useState } from "react";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "../conversation/data.tsx";
import { switchToast } from "./model.ts";

type SetIn = CapMap["threads.set_agent_replies"]["in"];

/**
 * Whether agents reply in threads in this chat, and a way to change it. `row` is what the chat's own row says (threads.get, live): the page follows it. `null` when the row is not known yet or the chat has no
 * such choice. A press shows the new state at once and goes back if the write fails.
 */
export function useReplySwitch(data: Pick<ConversationData, "call" | "toast">, threadId: string, row: boolean | undefined): { on: boolean | null; set(on: boolean): void } {
  const [mine, setMine] = useState<boolean | null>(null);
  useEffect(() => { setMine(null); }, [row, threadId]);
  const on = mine ?? row ?? null;
  const set = useCallback((next: boolean): void => {
    setMine(next);
    const failed = (): void => { setMine(null); data.toast("Could not change that."); };
    try {
      void Promise.resolve(data.call("threads.set_agent_replies", { threadId, inThreads: next } satisfies SetIn)).then(() => data.toast(switchToast(next)), failed);
    } catch { failed(); }
  }, [data, threadId]);
  return { on, set };
}
