// The hub reaches places through context, so a place never imports the shell and a query key always carries the open Space's id (spec 2.1, b15).
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { HubState, ShellHub } from "./hub.ts";

const HubContext = createContext<ShellHub | null>(null);

export function HubProvider({ hub, children }: { hub: ShellHub; children?: ReactNode }): ReactElement {
  return <HubContext.Provider value={hub}>{children}</HubContext.Provider>;
}

export function useHub(): ShellHub {
  const hub = useContext(HubContext);
  if (hub === null) throw new Error("useHub needs a HubProvider above it");
  return hub;
}

export function useHubState(hub: ShellHub): HubState {
  return useSyncExternalStore(hub.subscribe, hub.state, hub.state);
}

/**
 * A live subscription for a place: the key is the open Space's id then `parts`. It closes when the place unmounts, and the hub refuses it if the Space
 * changed under it, so a straggler from the old Space can never write into the new one.
 */
export function useSpaceWatch(spaceId: string, ...parts: string[]): void {
  const hub = useHub();
  const joined = parts.join("\u0000");
  useEffect(() => hub.watch([spaceId, ...joined.split("\u0000")]) ?? undefined, [hub, spaceId, joined]);
}
