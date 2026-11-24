// The hub reaches places through context, so a place never imports the shell and a query key always carries the open Space's id (spec 2.1, b15).
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
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

/** The hub when one is above (the shell has one; a place drawn on its own in a test or a screenshot has none). */
export function useOptionalHub(): ShellHub | null {
  return useContext(HubContext);
}

export function useHubState(hub: ShellHub): HubState {
  return useSyncExternalStore(hub.subscribe, hub.state, hub.state);
}

/** The place and the item a page is being drawn for. */
export interface ShownLocation {
  place: string;
  hash: string;
  /** The hub's count of moves of the address when this was drawn (see HubState.moves). */
  moves?: number;
}
const ShownContext = createContext<ShownLocation | null>(null);

/** The shell puts this around every place it draws: the address that place is drawn for (Shell.tsx). */
export function ShownLocationProvider({
  place,
  hash,
  moves,
  children,
}: ShownLocation & { children?: ReactNode }): ReactElement {
  const value = useMemo(() => ({ place, hash, ...(moves === undefined ? {} : { moves }) }), [place, hash, moves]);
  return <ShownContext.Provider value={value}>{children}</ShownContext.Provider>;
}

const NEVER = (): (() => void) => () => undefined;

/**
 * The address the page is drawn for. A place reads this, never the hub's own state: on a press the hub names the next address at once (the rail and the tab strip follow it in the same frame)
 * while the page is made one pass later (r41), so a place that read the hub would redraw itself for the address of the place that is arriving. Outside the shell's stage (a place drawn alone)
 * it is the hub's state.
 */
export function useShownLocation(hub: ShellHub): ShownLocation {
  const shown = useContext(ShownContext);
  const live = useSyncExternalStore(shown ? NEVER : hub.subscribe, hub.state, hub.state);
  return shown ?? live;
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
