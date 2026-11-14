// The one source of `screens` for useLoad. A place's data provider (Settings, the Inbox, and the places after them) hands over the ScreenHooks it already holds; the shell can provide it once
// above every place, and the per-place providers can then stop. Reads that go through useLoad need it, and say so when it is missing.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import type { ScreenHooks } from "../../../../client/src/index.ts";

const Ctx = createContext<ScreenHooks | null>(null);

export function ScreensProvider({ screens, children }: { screens: ScreenHooks; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={screens}>{children}</Ctx.Provider>;
}

export function useScreens(): ScreenHooks {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLoad needs a ScreensProvider above it");
  return v;
}
