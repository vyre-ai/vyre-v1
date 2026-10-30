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

// ---------------------------------------------------------------- Knowledge (Learned, pages, Trash): every button of those screens ends in one of these.

type Out<C extends keyof CapMap> = CapMap[C]["out"];
const call = async <C extends keyof CapMap>(data: MemoryData, cap: C, input: CapMap[C]["in"]): Promise<Out<C>> => (await data.call(cap, input)) as Out<C>;

/** Undo something memory learned: the fact goes to Trash, and Restore brings it back. */
export const undoFact = (data: MemoryData, factId: string) => call(data, "memory.undo", { factId });
/** Restore a fact (or a page) from Trash, or from Archive for an admin. */
export const restoreFact = (data: MemoryData, factId: string) => call(data, "memory.restore", { factId });
export const restorePage = (data: MemoryData, pageId: string) => call(data, "memory.restore", { pageId });
/** Edit a fact: the old one closes with today as its end and a new one is added (the old version is kept). */
export const correctFact = (data: MemoryData, factId: string, text: string) => call(data, "memory.fact.correct", { factId, text });
/** Answer an upkeep question: keep one of two facts (the other goes to Trash), keep both, or drop. */
export const resolveQuestion = (data: MemoryData, questionId: string, resolution: "keep_a" | "keep_b" | "keep_both" | "drop") => call(data, "memory.question.resolve", { questionId, resolution });
/** Write the Notes of a page as a new version. `baseVersion` makes a stale write refuse instead of overwriting. */
export const putNotes = (data: MemoryData, pageId: string, notes: string, baseVersion: number) => call(data, "memory.page.put", { pageId, notes, baseVersion });
export const trashPage = (data: MemoryData, pageId: string) => call(data, "memory.page.delete", { pageId });
export const restoreNotesVersion = (data: MemoryData, pageId: string, version: number) => call(data, "memory.page.restore_version", { pageId, version });
