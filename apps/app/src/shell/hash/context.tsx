// A place reads what its tab opened through this context and tells the shell when the person opens something else, so the hash (and with it back, forward and links) follows.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { openedId, parseHash } from "./hash.ts";
import type { HashTarget } from "./hash.ts";

export interface PlaceHash {
  target: HashTarget;
  /** The person opened an item inside the place: write it to the tab's hash. */
  opened(target: { screen?: string; subject?: { type: string; id: string }; args?: Record<string, unknown> }): void;
  /** How many addresses have come from outside (a link, a pasted address, a goto) so far. A place that remembers it left what its address names forgets that when this goes up: a link back to it must open it again. */
  links: number;
  /** How many addresses places have written themselves so far (HubState.reports). With `links`, tells a place whether a changed address is its own report coming back (never a link) or came to it. */
  reports: number;
}

const EMPTY: PlaceHash = { target: { args: {} }, opened: () => undefined, links: 0, reports: 0 };
const Ctx = createContext<PlaceHash>(EMPTY);

export function PlaceHashProvider({
  hash,
  links = 0,
  reports = 0,
  opened,
  children,
}: {
  hash: string;
  links?: number;
  reports?: number;
  opened: PlaceHash["opened"];
  children?: ReactNode;
}): ReactElement {
  const value = useMemo<PlaceHash>(
    () => ({ target: parseHash(hash), opened, links, reports }),
    [hash, opened, links, reports],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlaceHash(): PlaceHash {
  return useContext(Ctx);
}

/**
 * Run `fn` each time an address comes from outside (a link, a pasted address, a goto), even to the very address the place already shows. A place that remembers it left what its address
 * names (a closed automation, a Knowledge screen, an Inbox view the person moved off) forgets that here, so a link back to it opens it again; the address alone cannot say so when it left
 * and came back between two draws (the shell draws only the end state). Not run for the links that came before the place was made.
 */
export function useOnLink(fn: () => void): void {
  const { links } = usePlaceHash();
  const seen = useRef(links);
  const run = useRef(fn);
  run.current = fn;
  useEffect(() => {
    if (links === seen.current) return;
    seen.current = links;
    run.current();
  }, [links]);
}

/**
 * For an effect that follows the address: `isOwnReport()` is true when the address it reacts to is this place's own report coming back (its reports grew since the last draw and no link came), which
 * a place must never apply as a link: the person may have moved on since the report was issued. Call it once at the top of the effect.
 */
export function useOwnReport(): () => boolean {
  const { links, reports } = usePlaceHash();
  const now = useRef({ links, reports });
  const before = useRef({ links, reports });
  // the commit before this one: the layout effect runs before the passive effects that ask
  useLayoutEffect(() => {
    before.current = now.current;
    now.current = { links, reports };
  });
  return () => now.current.reports > before.current.reports && now.current.links === before.current.links;
}

/** The id this place was told to open (see openedId). */
export function useOpenedId(types: readonly string[], argKeys: readonly string[]): string | null {
  const { target } = usePlaceHash();
  return openedId(target, types, argKeys);
}
