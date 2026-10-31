// A phone screen that draws its own header takes its Back from here: the chevron lives in that header, and the shell draws no separate Back bar above it.
import { createContext, useContext } from "react";

export const MobileBackContext = createContext<(() => void) | null>(null);

/** The Back for this phone screen, or null where there is none to draw (a desktop, a tab's first screen, a screen under the shell's own Back bar). */
export function useMobileBack(): (() => void) | null {
  return useContext(MobileBackContext);
}
