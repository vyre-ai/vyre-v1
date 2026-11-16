// What the signing pieces need from the shell: the capability door and the clock, who a record's people are (to prefill who signs), and where a click goes. The shell fills this in; the walk and the tests pass their own.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

export interface SignData {
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  /** `offsetMin`: minutes east of UTC in the zone times are shown in, for the day a request was signed. */
  clock(): { now: number; offsetMin?: number };
  /** Open a file in the viewer (the signed copy, the audit page). */
  openFile?(fileId: string): void;
  /** A record by id opens its page. */
  openRecord?(recordId: string): void;
  /** The person's roles lack the permission to send (the controls are left out, not shown dead). Default: allowed. */
  canSend?: boolean;
  /** The Space's address, put in front of a link the server gave as a path only. */
  origin?: string;
  /** A passing notice in the top bar ("Reminded Andrea"). */
  say?(text: string): void;
}

const Ctx = createContext<SignData | null>(null);

export function SignDataProvider({ value, children }: { value: SignData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSignData(): SignData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The signing pieces need a SignDataProvider above them");
  return v;
}

/** Same, for a place that may not have one (a sample): the pieces leave their control out. */
export function useMaybeSignData(): SignData | null {
  return useContext(Ctx);
}
