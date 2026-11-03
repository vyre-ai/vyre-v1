// The short summary Settings and the Console show above their "Open in Vault" link (owner ruling D28): how many connections you can use, and how many need a look. The list itself lives in
// Vault > Connections; this reads the same sources through the same model, so the numbers match the page.
import { useEffect, useState } from "react";
import { assemble, summaryWords } from "./model.ts";
import type { Account, Connector, Home } from "./model.ts";

export interface Summary { line: string; needsYou: number; total: number; loaded: boolean }

export async function loadSummary(call: (cap: string, input: unknown) => Promise<unknown>, me: string): Promise<Omit<Summary, "loaded">> {
  const soft = <T>(p: Promise<unknown>, d: T): Promise<T> => p.then((x) => x as T, () => d);
  const [home, accounts, connectors] = await Promise.all([
    soft<Home | null>(call("plugins.connections.home", {}), null),
    soft<{ connections: Account[] }>(call("connections.list", { whose: "all" }), { connections: [] }),
    soft<{ connectors: Connector[] }>(call("connectors.list", {}), { connectors: [] }),
  ]);
  return summaryWords(assemble(home, accounts.connections ?? [], connectors.connectors ?? [], me, (id) => id, (id) => id));
}

export function useConnectionsSummary(call: (cap: string, input: unknown) => Promise<unknown>, me: string): Summary {
  const [s, set] = useState<Summary>({ line: "", needsYou: 0, total: 0, loaded: false });
  useEffect(() => {
    let live = true;
    void loadSummary(call, me).then((x) => { if (live) set({ ...x, loaded: true }); }, () => { if (live) set({ line: "", needsYou: 0, total: 0, loaded: true }); });
    return () => { live = false; };
  }, [call, me]);
  return s;
}
