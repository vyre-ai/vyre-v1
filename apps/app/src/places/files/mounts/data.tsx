// What the mount sheet needs from the shell: the capability door, the Space, who is connected where, the folders a mount can go into, the people a mount can be shared with.
// The shell fills this in; the screenshot mount and the tests pass their own.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Call } from "./actions.ts";
import type { Accounts, Person, SourceId } from "./model.ts";

export interface MountsData {
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call: Call;
  /** The everyone group makes "Everyone in <Space>" possible; without it that choice is not offered. */
  space: { name: string; everyoneGroupId?: string };
  accounts: Accounts;
  /** The Into picker: folders the person can write to. */
  folders: readonly { id: string; name: string }[];
  people: readonly Person[];
  /** A source with no connection sends the person to connect it (Settings > Connections). */
  connect(source: SourceId): void;
}

const Ctx = createContext<MountsData | null>(null);

export function MountsDataProvider({ value, children }: { value: MountsData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMountsData(): MountsData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The mount sheet needs a MountsDataProvider above it");
  return v;
}
