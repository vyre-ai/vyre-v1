// Small adapters shared by the Automations, Vault and Settings providers: names from the runtime's people list, and the time zone free clock.
import type { ShellRuntime } from "./runtime.tsx";

/** A principal's name by id, from the runtime's live people list; the id itself until the list has loaded. */
export function nameOf(rt: ShellRuntime): (id: string) => string {
  return (id) => {
    const s = rt.principals.getSnapshot();
    return (s.status === "ready" ? s.data.find((p) => p.id === id)?.name : undefined) ?? id;
  };
}

export function connectionOf(rt: ShellRuntime): { get(): "online" | "offline"; subscribe(l: () => void): () => void } {
  return rt.connection;
}
