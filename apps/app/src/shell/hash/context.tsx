// A place reads what its tab opened through this context and tells the shell when the person opens something else, so the hash (and with it back, forward and links) follows.
import { createContext, useContext, useMemo } from "react";
import type { ReactElement, ReactNode } from "react";
import { openedId, parseHash } from "./hash.ts";
import type { HashTarget } from "./hash.ts";

export interface PlaceHash {
  target: HashTarget;
  /** The person opened an item inside the place: write it to the tab's hash. */
  opened(target: { screen?: string; subject?: { type: string; id: string }; args?: Record<string, unknown> }): void;
}

const EMPTY: PlaceHash = { target: { args: {} }, opened: () => undefined };
const Ctx = createContext<PlaceHash>(EMPTY);

export function PlaceHashProvider({ hash, opened, children }: { hash: string; opened: PlaceHash["opened"]; children?: ReactNode }): ReactElement {
  const value = useMemo<PlaceHash>(() => ({ target: parseHash(hash), opened }), [hash, opened]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlaceHash(): PlaceHash {
  return useContext(Ctx);
}

/** The id this place was told to open (see openedId). */
export function useOpenedId(types: readonly string[], argKeys: readonly string[]): string | null {
  const { target } = usePlaceHash();
  return openedId(target, types, argKeys);
}
