// What the memory screens need from the shell: live reads of the graph, its saved layout, the facts and the notes (over the kept copy), the capability door for the writes, the clock, and where a click goes.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

export type LiveCap = "memory.graph" | "memory.layout.get" | "memory.facts.list" | "memory.notes.list" | "memory.read_note";

export interface MemoryNav {
  /** A note opens beside the graph (a person, a client, a project, a decision, a record or a chat opens its own place). */
  openNote(nodeId: string, link?: string): void;
  /** The source of a fact: the chat, task or record it came from. */
  openSource(link: string): void;
}

export interface AgentRef { id: string; name: string }

export interface MemoryData {
  live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]>;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  /** The time "now" is read from, so a screen draws the same on every run. */
  now(): number;
  agents: readonly AgentRef[];
  nameOf(id: string): string;
  nav: MemoryNav;
}

const Ctx = createContext<MemoryData | null>(null);

export function MemoryDataProvider({ value, children }: { value: MemoryData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalMemoryData(): MemoryData | null {
  return useContext(Ctx);
}

export function useMemoryData(): MemoryData {
  const v = useContext(Ctx);
  if (!v) throw new Error("Memory needs a MemoryDataProvider above it");
  return v;
}

/** A live capability query; the input is compared by value, so an equal object keeps the subscription. */
export function useLive<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): QueryState<CapMap[C]["out"]> {
  const { live } = useMemoryData();
  const key = JSON.stringify(input);
  const q = useMemo(() => live(cap, JSON.parse(key) as CapMap[C]["in"]), [live, cap, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}
