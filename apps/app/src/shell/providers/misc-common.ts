// Small adapters shared by the Automations, Vault and Settings providers: names from the runtime's people list, and the time zone free clock.
import type { ShellRuntime } from "./runtime.tsx";
import { nameLookup } from "./records-live.ts";

/** A principal's name by id, from the runtime's live people list. One resolver for every place (records-live.ts nameLookup): never the id, a plain word for someone it does not know (not loaded yet, left the Space). */
export function nameOf(rt: ShellRuntime): (id: string) => string {
  return nameLookup(rt);
}

export function connectionOf(rt: ShellRuntime): { get(): "online" | "offline"; subscribe(l: () => void): () => void } {
  return rt.connection;
}
