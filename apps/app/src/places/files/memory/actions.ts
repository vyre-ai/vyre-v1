// The writes of the memory screens: accept or reject a proposed fact, save where a node was dragged to, export the graph.
import type { MemoryData } from "./data.tsx";
import type { Fact, Positions } from "./model.ts";

type FactOut = { fact: Fact };

/** Accepts a proposed fact: it becomes current in the layer it was proposed for. Resolves with the fact as it now stands. */
export async function acceptFact(data: MemoryData, factId: string): Promise<Fact> {
  return ((await data.call("memory.fact.accept", { factId })) as FactOut).fact;
}

/** Rejects a proposed fact: it is closed off and kept in history, never shown as an answer. */
export async function rejectFact(data: MemoryData, factId: string): Promise<Fact> {
  return ((await data.call("memory.fact.reject", { factId })) as FactOut).fact;
}

/** Keeps where the nodes were moved to, for this person, so the next visit opens the same picture. */
export async function saveLayout(data: MemoryData, scope: "agent" | "space", agentId: string | undefined, positions: Positions): Promise<void> {
  await data.call("memory.layout.save", { scope, ...(agentId ? { agentId } : {}), positions });
}

/** Exports the graph as a file; personal layers are never in it. Resolves with the file's id. */
export async function exportGraph(data: MemoryData, scope: "agent" | "space", agentId: string | undefined, asOf: number | undefined, kinds: readonly string[]): Promise<string> {
  const out = (await data.call("memory.graph_export", { scope, ...(agentId ? { agentId } : {}), ...(asOf !== undefined ? { asOf } : {}), ...(kinds.length ? { kinds: [...kinds] } : {}) })) as { fileId: string };
  return out.fileId;
}

export function errorText(e: unknown, what: string): string {
  const msg = e instanceof Error ? e.message : "";
  return msg ? `${what}: ${msg}` : `${what}.`;
}
