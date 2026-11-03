// The daemon's side of the person's own Chrome as a place work can run: the PersonalChrome port (lib/personal-chrome.ts) made from the Chrome bridge (lib/chrome-bridge.ts). The daemon binds it; the live test
// binds the same one over the test rig's bridge. It remembers, in memory only, what the extension said about held items and the newest picture of each agent's tab, for the chat's cards.
import type { AgentEvent, ChromeBridge } from "./chrome-bridge.ts";
import type { PersonalChrome } from "./personal-chrome.ts";

export interface BridgePortDeps {
  bridge: ChromeBridge;
  /** Who is signed in to the Chrome, in the Space they picked there (the bridge's whoami). */
  whoami(): Promise<{ person?: string; spaceId?: string }>;
  /** An agent's display name, or its id when it cannot be read. */
  agentName(id: string): Promise<string>;
}

export function createBridgePort(d: BridgePortDeps): { port: PersonalChrome; onEvent(e: AgentEvent): void } {
  const held = new Map<string, { site?: string; kind?: string; summary?: string; card?: Record<string, string> }>();
  const frames = new Map<string, { site: string; thumb: string }>();
  const port: PersonalChrome = {
    async available({ space, person }) {
      const open = d.bridge.opened;
      if (d.bridge.connected === 0 || !open || open.mode !== "personal" || !open.spaces.includes(space)) return false;
      try { const w = await d.whoami(); return w.person === person && w.spaceId === space; } catch { return false; }
    },
    async call({ tool, args, agent, space, thread, timeoutMs }) {
      return (await d.bridge.callTool({ tool, input: args, agent: { id: agent.id, name: await d.agentName(agent.id) }, space, ...(thread ? { thread } : {}), timeoutMs })) as Record<string, unknown>;
    },
    async held(id) {
      for (let i = 0; i < 20 && !held.has(id); i++) await new Promise((r) => setTimeout(r, 50));
      return held.get(id) ?? null;
    },
    frame: (agentId) => frames.get(agentId) ?? null,
    drop: (id) => { d.bridge.dropHeld(id); held.delete(id); },
    takeOver: (agentId) => { d.bridge.takeOver(agentId); },
    watch: (agentId) => { d.bridge.watch(agentId); },
  };
  return {
    port,
    onEvent(e) {
      if (e.event === "held" && typeof e["id"] === "string") {
        const card = (e["card"] && typeof e["card"] === "object" ? e["card"] : {}) as Record<string, string>;
        held.set(e["id"], { site: String(card["site"] ?? ""), kind: String(e["kind"] ?? ""), summary: String(e["summary"] ?? ""), card });
        if (held.size > 100) held.delete(held.keys().next().value as string);
      }
      if (e.event === "frame" && typeof e["agent"] === "string" && typeof e["thumb"] === "string") frames.set(e["agent"], { site: String(e["site"] ?? ""), thumb: e["thumb"] });
    },
  };
}
