// The person's own Chrome reached over their device link: a Team Space server runs the engine tools (modules/computers), but the Chrome and its bridge are on the person's own computer, whose daemon holds
// a socket to the Space (host/src/compute/device-link.ts). This is the PersonalChrome port (lib/personal-chrome.ts) for that case: each call is a question to that computer's daemon, which answers it with its
// own port over the extension's bridge as the person signed in there. What the extension says about held items and pictures arrives as chrome_event frames and is kept in memory.
import type { PersonalChrome } from "./personal-chrome.ts";

export interface RemoteLink { nodeId: string; person: string }
export interface RemoteDeps {
  /** The person's own computers linked right now. */
  devices(person: string): RemoteLink[];
  /** One question for a computer's daemon (the compute stream's ask), with how long to wait for the answer. */
  ask(nodeId: string, kind: string, input: unknown, timeoutMs: number): Promise<unknown>;
}

export function createRemotePort(d: RemoteDeps): { port: PersonalChrome; onEvent(link: RemoteLink, e: Record<string, unknown>): void } {
  const held = new Map<string, { site?: string; kind?: string; summary?: string; card?: Record<string, string> }>();
  const frames = new Map<string, { site: string; thumb: string }>();
  const plans = new Map<string, { goal: string; steps: string[]; done: number }>();
  /** The computer that said yes for a person in a Space, so what follows goes to the same one. */
  const chosen = new Map<string, string>();
  const key = (space: string, person: string): string => `${space}|${person}`;
  /** Which computer holds a held item or an agent's tab: the one that sent the event. */
  const owner = new Map<string, string>();
  const nodeFor = (space: string, person: string): string | null => chosen.get(key(space, person)) ?? null;

  const port: PersonalChrome = {
    async available({ space, person }) {
      for (const link of d.devices(person)) {
        try { if ((await d.ask(link.nodeId, "chrome.available", { space, person }, 8_000)) === true) { chosen.set(key(space, person), link.nodeId); return true; } } catch { /* the next computer */ }
      }
      chosen.delete(key(space, person));
      return false;
    },
    async call({ tool, args, agent, space, thread, timeoutMs }) {
      // the person is the one the agent works for: the daemon on that computer re-checks it is signed in there
      const person = [...chosen.keys()].find((k) => k.startsWith(`${space}|`))?.split("|")[1] ?? "";
      const node = nodeFor(space, person);
      if (!node) throw Object.assign(new Error("Your Chrome is not reachable from here."), { code: "offline" });
      const out = await d.ask(node, "chrome.call", { person, tool, args, agent, space, ...(thread ? { thread } : {}), timeoutMs }, timeoutMs + 5_000);
      return (out && typeof out === "object" ? out : {}) as Record<string, unknown>;
    },
    async held(id) {
      for (let i = 0; i < 20 && !held.has(id); i++) await new Promise((r) => setTimeout(r, 50));
      return held.get(id) ?? null;
    },
    frame: (agentId) => frames.get(agentId) ?? null,
    plan: (agentId) => plans.get(agentId) ?? null,
    drop(id) { held.delete(id); const n = owner.get(`held:${id}`); if (n) void d.ask(n, "chrome.drop", { heldId: id }, 8_000).catch(() => undefined); },
    takeOver(agentId) { const n = owner.get(`agent:${agentId}`); if (n) void d.ask(n, "chrome.takeover", { agentId }, 8_000).catch(() => undefined); },
    watch(agentId) { const n = owner.get(`agent:${agentId}`); if (n) void d.ask(n, "chrome.watch", { agentId }, 8_000).catch(() => undefined); },
  };
  return {
    port,
    onEvent(link, e) {
      const agent = typeof e["agent"] === "string" ? e["agent"] : "";
      if (agent) owner.set(`agent:${agent}`, link.nodeId);
      if (e["event"] === "held" && typeof e["id"] === "string") {
        const card = (e["card"] && typeof e["card"] === "object" ? e["card"] : {}) as Record<string, string>;
        held.set(e["id"], { site: String(card["site"] ?? ""), kind: String(e["kind"] ?? ""), summary: String(e["summary"] ?? ""), card });
        owner.set(`held:${e["id"]}`, link.nodeId);
        if (held.size > 100) held.delete(held.keys().next().value as string);
      }
      if (e["event"] === "plan" && agent && Array.isArray(e["steps"])) plans.set(agent, { goal: String(e["goal"] ?? ""), steps: (e["steps"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20), done: Number(e["done"]) || 0 });
      if (e["event"] === "frame" && agent && typeof e["thumb"] === "string") frames.set(agent, { site: String(e["site"] ?? ""), thumb: e["thumb"] });
    },
  };
}

/** Local first, then the person's own computer: the one that says yes is the one the rest of the work goes to. */
export function composePorts(local: PersonalChrome, remote: PersonalChrome): PersonalChrome {
  const via = new Map<string, PersonalChrome>();
  const pick = (space: string): PersonalChrome => via.get(space) ?? local;
  return {
    async available(a) {
      if (await local.available(a)) { via.set(a.space, local); return true; }
      if (await remote.available(a)) { via.set(a.space, remote); return true; }
      return false;
    },
    call: (a) => pick(a.space).call(a),
    async held(id) { return (await local.held(id)) ?? (await remote.held(id)); },
    frame: (id) => local.frame(id) ?? remote.frame(id),
    plan: (id) => local.plan(id) ?? remote.plan(id),
    drop(id) { local.drop(id); remote.drop(id); },
    takeOver(id) { local.takeOver(id); remote.takeOver(id); },
    watch(id) { local.watch(id); remote.watch(id); },
  };
}
