// The writes the row menus of Chats make beyond the sidebar's own (stars, read marks, archive and leave are in ../sidebar/actions.ts). Each is one capability call over the data context; the tests drive them
// without a renderer. Reads (who is muted, an agent's computer) are made when a menu opens, so the words of a toggle follow what the server says now.
import type { ChatsSidebarData } from "../sidebar/data.tsx";

export type MuteKind = "person" | "agent" | "channel" | "thread";
export const muteKey = (kind: MuteKind, id: string): string => `${kind}:${id}`;

export interface MenuApi {
  /** Who and what is muted now, as `kind:id`. */
  mutes(): Promise<Set<string>>;
  setMute(kind: MuteKind, id: string, on: boolean): Promise<void>;
  /** What is starred now, as `type:id`. */
  stars(): Promise<Set<string>>;
  /** Every agent's computer by agent id, and whether it sleeps. */
  computers(): Promise<Map<string, { computerId: string; asleep: boolean }>>;
  wake(computerId: string): Promise<void>;
  sleep(computerId: string): Promise<void>;
  provision(agentId: string): Promise<void>;
  pause(agentId: string): Promise<void>;
  resume(agentId: string): Promise<void>;
  deleteAgent(agentId: string): Promise<void>;
  renameThread(threadId: string, title: string): Promise<void>;
  leaveChannel(channelId: string): Promise<void>;
  archiveChannel(channelId: string): Promise<void>;
}

export function createMenuApi(data: Pick<ChatsSidebarData, "call">): MenuApi {
  return {
    async mutes() {
      const out = (await data.call("notifications.mute.list", {})) as { mutes?: { target: { kind: string; id: string }; until: number }[] } | null;
      return new Set((out?.mutes ?? []).map((m) => `${m.target.kind}:${m.target.id}`));
    },
    async setMute(kind, id, on) { await data.call(on ? "notifications.mute.set" : "notifications.mute.clear", { target: { kind, id } }); },
    async stars() {
      const out = (await data.call("stars.list", {})) as { stars?: { resource: { type: string; id: string } }[] } | null;
      return new Set((out?.stars ?? []).map((s) => `${s.resource.type}:${s.resource.id}`));
    },
    async computers() {
      const out = (await data.call("computers.list", {})) as { computers?: { computerId: string; agentId: string; state: string }[] } | null;
      return new Map((out?.computers ?? []).map((c) => [c.agentId, { computerId: c.computerId, asleep: c.state === "asleep" }] as const));
    },
    async wake(computerId) { await data.call("computers.wake", { computerId }); },
    async sleep(computerId) { await data.call("computers.sleep", { computerId }); },
    async provision(agentId) { await data.call("computers.provision", { agentId, idempotencyKey: `pc_${agentId}` }); },
    async pause(agentId) { await data.call("agents.pause", { agentId }); },
    async resume(agentId) { await data.call("agents.resume", { agentId }); },
    async deleteAgent(agentId) { await data.call("agents.delete", { agentId }); },
    async renameThread(threadId, title) { await data.call("threads.update", { threadId, title }); },
    async leaveChannel(channelId) { await data.call("channels.leave", { channelId }); },
    async archiveChannel(channelId) { await data.call("channels.archive", { channelId }); },
  };
}
