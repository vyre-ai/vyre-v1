// The thread behind an Ask pane (ARCH 4.13): a private `ask` thread scoped to the thing. One per thing per person and agent: the newest of the person's own Asks on it with that agent
// (chat.asks_of, newest first) is continued, else one is started. New starts one more, which is then the newest. An opening message (Add to Automations) is a session of its own on the
// thing, the same one every time it is asked for. Open in Chats lists it (chat.open_as_chat) and opens it as a full chat. No React here.
import { broughtSummary, openingTitle } from "../../places/chats/mounts/opening.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import { askScope, askTitle } from "./pane.ts";
import type { AskPaneState } from "./pane.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

const key = (): string => `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** The thread id for the pane, or null when the person may not ask about that thing (or the server could not start one). `agentId` is a real agent id here. */
export async function resolveAskThread(call: Call, s: Pick<AskPaneState, "place" | "thing" | "first" | "bringFrom" | "fresh">, agentId: string): Promise<string | null> {
  const { scopeType, scopeId } = askScope(s.place, s.thing);
  const title = askTitle(s.place, s.thing);
  const start = async (input: Record<string, unknown>): Promise<string | null> => {
    const out = (await call("chat.start", { kind: "ask", agentIds: [agentId], scopeType, scopeId, ...input })) as { thread?: { threadId?: string } } | null;
    return out?.thread?.threadId ?? null;
  };
  // the same input and key the Chats door has always sent for an opening, so a session started there is the one found here
  if (s.first) {
    try { return await start({ first: s.first, ...(openingTitle(s.first) ? { title: openingTitle(s.first) } : {}), idempotencyKey: `open_${scopeType}_${scopeId}_${agentId}` }); } catch { return null; }
  }
  try {
    if (s.fresh === 0) {
      const out = (await call("chat.asks_of", { resourceType: scopeType, resourceId: scopeId, limit: 20 })) as CapMap["chat.asks_of"]["out"];
      const mine = out.threads.find((t) => t.closedAt === undefined && t.agents.some((a) => a.agentId === agentId));
      if (mine) return mine.threadId;
    }
  } catch {
    // no history to read: a start below says whether the thing can be asked about at all
  }
  try {
    const brought = s.bringFrom && s.fresh === 0 ? await broughtSummary({ call }, s.bringFrom) : null;
    return await start({ title, ...(brought ? { first: brought } : {}), idempotencyKey: key() });
  } catch {
    return null;
  }
}

/** Open in Chats: the Ask is listed in the person's chats and opened there as a full chat. */
export async function openAskInChats(call: Call, open: (t: { subject: { type: string; id: string } }) => void, threadId: string): Promise<void> {
  await call("chat.open_as_chat", { threadId });
  open({ subject: { type: "thread", id: threadId } });
}
