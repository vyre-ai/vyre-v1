// Installing Vyre on Android (owner decision D18, 3 Nov 2026): the phone app is the web app installed from Chrome until a native build ships. Chrome offers the install through the
// `beforeinstallprompt` event; the boot script (boot.ts) keeps it on window.__VYRE_INSTALL__ from the first frame, so a press later in the session can show Chrome's own install dialog.
// Once installed (the `appinstalled` event, or the app already running standalone) the offer goes away. iPhone has no such event: Safari's Add to Home Screen stays the way there.

export interface InstallPromptLike {
  prompt(): Promise<void> | void;
  readonly userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallGlobal {
  __VYRE_INSTALL__?: InstallPromptLike | null;
  matchMedia?: (q: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
  addEventListener?: (t: string, f: () => void) => void;
  removeEventListener?: (t: string, f: () => void) => void;
}

/** Fired by the boot script whenever the install offer comes or goes. */
export const INSTALL_EVENT = "vyre:installable";

const g = (): InstallGlobal => globalThis as unknown as InstallGlobal;

/** Already running as the installed app (Android standalone, or iPhone's home screen). */
export function runningInstalled(w: InstallGlobal = g()): boolean {
  try { if (w.matchMedia?.("(display-mode: standalone)").matches === true) return true; } catch { /* no media queries */ }
  return w.navigator?.standalone === true;
}

/** Chrome offers the install and the app is not already installed. */
export function canInstall(w: InstallGlobal = g()): boolean {
  return !runningInstalled(w) && w.__VYRE_INSTALL__ != null;
}

/** Show Chrome's install dialog. True when the person installed it. The offer is spent either way: Chrome hands out a new one if it wants to. */
export async function promptInstall(w: InstallGlobal = g()): Promise<boolean> {
  const ev = w.__VYRE_INSTALL__;
  if (!ev) return false;
  w.__VYRE_INSTALL__ = null;
  await ev.prompt();
  const choice = ev.userChoice ? await ev.userChoice.catch(() => ({ outcome: "dismissed" as const })) : { outcome: "dismissed" as const };
  return choice.outcome === "accepted";
}

/** Hear the offer come and go. */
export function onInstallChange(fn: () => void, w: InstallGlobal = g()): () => void {
  w.addEventListener?.(INSTALL_EVENT, fn);
  return () => w.removeEventListener?.(INSTALL_EVENT, fn);
}

/** The script the boot runs before anything else: keep Chrome's offer (and stop its own mini bar, the app offers it where it fits), drop it once installed. */
export const INSTALL_BOOT = `(function(){try{addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__VYRE_INSTALL__=e;dispatchEvent(new Event(${JSON.stringify(INSTALL_EVENT)}));});addEventListener("appinstalled",function(){window.__VYRE_INSTALL__=null;dispatchEvent(new Event(${JSON.stringify(INSTALL_EVENT)}));});}catch(e){}})();`;
