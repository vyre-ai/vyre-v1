// Which of the messages sent while the agent works are still waiting (rc.9 steering). A message the engine has handed to the agent (it is written to a steering engine at the next step) is not queued any
// more: the row must not keep saying "goes in at the next step" for it. The engine's queue is asked while any message looks queued; if it cannot be read the page's own view stands.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export const POLL_MS = 1500;

/** The ids that are still waiting in the engine's queue; `null` until the engine has answered. */
export function stillWaiting(ids: readonly string[], items: ReadonlyArray<{ messageId?: string; state: string }>): string[] {
  const waiting = new Set(items.filter((i) => i.state === "queued" && i.messageId !== undefined).map((i) => i.messageId as string));
  return ids.filter((id) => waiting.has(id));
}

export function QueueWaiting({ ids, call, threadId, children }: { ids: readonly string[]; call(cap: string, input: unknown): Promise<unknown>; threadId: string; children: (still: string[]) => ReactNode }): ReactNode {
  const [items, setItems] = useState<ReadonlyArray<{ messageId?: string; state: string }> | null>(null);
  const key = ids.join(",");
  useEffect(() => {
    if (ids.length === 0) { setItems(null); return undefined; }
    let live = true;
    const look = (): void => { void call("engine.queue.list", { threadId }).then((r) => { if (live) setItems((r as { items?: Array<{ messageId?: string; state: string }> }).items ?? null); }, () => undefined); };
    look();
    const t = setInterval(look, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [key, threadId]);   // eslint-disable-line react-hooks/exhaustive-deps
  return children(items === null ? [...ids] : stillWaiting(ids, items));
}
