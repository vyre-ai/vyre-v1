// The Chats sidebar's reads (design 13 Nov). chats.presence: who is around and which agents work now, composed from devices.presence and engine.now, which answer as the asker; what they refuse the asker, this
// answers nothing for (a guest has no team). A read that is not there, or fails, leaves that half empty: presence is a quiet dot, never a reason for the sidebar to fail.
import type { ChatCtx } from "../projections.ts";

type PresenceOut = { people?: { personId: string; state: string }[] };
type NowOut = { working?: { agentId: string; since: number; threadId?: string }[] };

export async function chatsPresence(ctx: ChatCtx): Promise<{
  people: { personId: string; state: "online" | "away" }[];
  working: { agentId: string; threadId?: string; since: number }[];
}> {
  const call = ctx.call;
  const ask = async <T>(cap: string): Promise<T | null> => {
    if (!call) return null;
    try {
      return (await call(cap, {})) as T;
    } catch {
      return null;
    }
  };
  const [p, w] = await Promise.all([ask<PresenceOut>("devices.presence"), ask<NowOut>("engine.now")]);
  return {
    people: (p?.people ?? []).flatMap((x) =>
      x.state === "online" || x.state === "away" ? [{ personId: x.personId, state: x.state }] : [],
    ),
    working: (w?.working ?? []).map((x) => ({
      agentId: x.agentId,
      ...(x.threadId ? { threadId: x.threadId } : {}),
      since: x.since,
    })),
  };
}

export const sidebarHandlers = { "chats.presence": chatsPresence };
