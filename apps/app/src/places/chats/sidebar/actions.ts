// The writes the Chats sidebar makes, each one capability. Plain functions over the data context, so the tests drive them without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ChatsSidebarData } from "./data.tsx";
import { newLocalRow, startKey } from "./model.ts";
import type { ChatRow, NeedsItem } from "./model.ts";

export interface SidebarApi {
  /** A new chat with `agent` (default: your assistant). Returns the local row at once; chat.start answers behind it. */
  newChat(agent?: { agentId: string; name: string }): ChatRow;
  star(type: "thread" | "agent" | "channel", id: string, on: boolean): Promise<void>;
  markRead(threadId: string): Promise<void>;
  act(item: NeedsItem): Promise<void>;
}

/**
 * A new chat is ready as a row in the list in under 100 ms (budget chat_open): the local row is added and opened before any call is made, and chat.start (with an
 * idempotency key tied to the local row) answers behind it. When it answers, the conversation switches to the real thread and the local row goes; when it fails the
 * local row goes and nothing else changes.
 */
export function createSidebarApi(data: ChatsSidebarData, onLocal: (row: ChatRow) => void, onSettled: (localId: string) => void): SidebarApi {
  return {
    newChat(agent) {
      const who = agent ?? data.space.assistant;
      const row = newLocalRow(who.name, "agent", data.clock().now);
      onLocal(row);
      data.nav.openChat(row.threadId);
      void data.call("chat.start", { kind: "chat", agentIds: [who.agentId], idempotencyKey: startKey(row) }).then(
        (out) => { onSettled(row.threadId); data.nav.openChat((out as CapMap["chat.start"]["out"]).thread.threadId); },
        () => onSettled(row.threadId),
      );
      return row;
    },
    async star(type, id, on) { await data.call("stars.toggle", { resource: { type, id }, on }); },
    async markRead(threadId) { await data.call("threads.mark_read", { threadId }); },
    async act(item) { const a = item.task.actions[0]; if (a) await data.call("tasks.act", { taskId: item.task.id, action: a.key }); },
  };
}
