// The connect door: places read it with useConnectInline() and add the footer item to a picker. Without a host (a test, a screenshot) it is null and no footer is drawn.
import { createContext, useContext } from "react";
import type { OpenConnect } from "./model.ts";

export interface ConnectInline {
  open: OpenConnect;
  /** Goes up by one each time a flow finishes, so a list loaded earlier can load again. */
  version: number;
}

export const ConnectCtx = createContext<ConnectInline | null>(null);

export function useConnectInline(): ConnectInline | null {
  return useContext(ConnectCtx);
}

/** The door alone, for a picker that only needs to open a flow. */
export function useOpenConnect(): OpenConnect | null {
  return useContext(ConnectCtx)?.open ?? null;
}

/** A number that changes when any account, key or mailbox is connected in place. Zero without a host. */
export function useConnectVersion(): number {
  return useContext(ConnectCtx)?.version ?? 0;
}
