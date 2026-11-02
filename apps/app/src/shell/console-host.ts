// Where the Console is drawn. Inside the shell on a computer, with the shell's rails and theme. Alone when there is nothing around it: on a phone, and at console.<address>, the
// Console's own door, where there is only the Console and the same people reach it. What a person may open is always the server's answer (console.nav), never this file's.
import { createContext, useContext } from "react";

const Alone = createContext(false);
export const ConsoleAlone = Alone.Provider;
export const useConsoleAlone = (): boolean => useContext(Alone);

/** Is this page the Console's own address? On vyre.run a name must follow, because `console.vyre.run` is one label under the zone and could be a person's own name. */
export function isConsoleHost(hostname: string | undefined): boolean {
  const labels = (hostname ?? "").toLowerCase().split(".").filter(Boolean);
  if (labels[0] !== "console" || labels.length < 3) return false;
  return labels.slice(-2).join(".") !== "vyre.run" || labels.length >= 4;
}

export function onConsoleHost(): boolean {
  return isConsoleHost((globalThis as { location?: { hostname?: string } }).location?.hostname);
}
