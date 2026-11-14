// The one source of `call` for the hooks that read pages and make changes (useLoadList, useChange). Like ScreensProvider, a place's data provider hands over the call it already holds.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

export type CapCall = (cap: string, input?: unknown, opts?: { idempotencyKey?: string }) => Promise<unknown>;

const Ctx = createContext<CapCall | null>(null);

export function CapCallProvider({ call, children }: { call: CapCall; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={call}>{children}</Ctx.Provider>;
}

export function useCapCall(): CapCall {
  const v = useContext(Ctx);
  if (!v) throw new Error("this hook needs a CapCallProvider above it");
  return v;
}
