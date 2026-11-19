// Old data a browser keeps for a Space's address that can stand between a person and their Space: a service worker from before the Space moved (the relay's shell worker on an address that is a
// Space server now, or the app's own worker on a name the relay holds now) and the pages such a worker cached. Clearing it never touches a saved sign-in, a draft or a key: only workers and
// cached pages go, so the next load comes from whatever answers at the address today. In the client layer because apps never fetch (boundary B4).
import { relayName, type FindOptions } from "./find-space.ts";

interface WorkerLike {
  scriptURL?: string;
}
interface RegistrationLike {
  active?: WorkerLike | null;
  waiting?: WorkerLike | null;
  installing?: WorkerLike | null;
  unregister(): Promise<boolean>;
}
export interface OldDataEnv {
  navigator?: {
    serviceWorker?: {
      controller?: WorkerLike | null;
      getRegistrations?(): Promise<readonly RegistrationLike[]>;
    };
  };
  caches?: { keys(): Promise<string[]>; delete(name: string): Promise<boolean> };
  location?: { origin?: string; reload?(): void };
  sessionStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
}

const RELAY_WORKER = "/__vyre/sw.js";
const pathOf = (w: WorkerLike | null | undefined): string => {
  try {
    return w?.scriptURL ? new URL(w.scriptURL).pathname : "";
  } catch {
    return "";
  }
};
const env = (): OldDataEnv => globalThis as OldDataEnv;

/** Does this page have anything to clear? True when a service worker is registered for it or it holds cached pages. A desktop app window has neither. */
export async function hasOldData(e: OldDataEnv = env()): Promise<boolean> {
  try {
    const regs = (await e.navigator?.serviceWorker?.getRegistrations?.()) ?? [];
    if (regs.length > 0) return true;
    return ((await e.caches?.keys()) ?? []).length > 0;
  } catch {
    return false;
  }
}

/** Remove every service worker and every cached page of this page's origin. Saved sign-ins (localStorage) are never touched. Answers how many of each went. */
export async function clearOldData(e: OldDataEnv = env()): Promise<{ workers: number; caches: number }> {
  let workers = 0,
    gone = 0;
  try {
    for (const r of (await e.navigator?.serviceWorker?.getRegistrations?.()) ?? [])
      if (await r.unregister().catch(() => false)) workers++;
  } catch {
    /* no worker support here */
  }
  try {
    for (const k of (await e.caches?.keys()) ?? []) if (await e.caches!.delete(k).catch(() => false)) gone++;
  } catch {
    /* no cache storage here */
  }
  return { workers, caches: gone };
}

/**
 * The worker in charge of this page belongs to where the Space used to be: the relay's shell worker on an address that no longer answers as a relay name, or the app's worker on a name the
 * relay holds now. Null when the page has no worker in charge, the worker fits, or the address could not be asked (offline: nothing is removed on a guess).
 */
export async function staleWorker(
  e: OldDataEnv = env(),
  o: FindOptions = {},
): Promise<"relay-worker" | "app-worker" | null> {
  const mine = pathOf(e.navigator?.serviceWorker?.controller);
  const origin = e.location?.origin;
  if (!mine || !origin) return null;
  const relay = await relayName(origin, o);
  if (!relay.answered) return null;
  if (mine === RELAY_WORKER) return relay.held ? null : "relay-worker";
  return relay.held ? "app-worker" : null;
}

const HEALED = "vyre:healed";

/**
 * Run when a first call to the Space fails: if a worker from before a move is in charge, remove it and load the page again, once per tab (a second failure in the same tab shows the screen
 * instead of looping). Answers true when the page is being loaded again.
 */
export async function healStaleWorker(e: OldDataEnv = env(), o: FindOptions = {}): Promise<boolean> {
  try {
    if (e.sessionStorage?.getItem(HEALED)) return false;
    if (!(await staleWorker(e, o))) return false;
    await clearOldData(e);
    e.sessionStorage?.setItem(HEALED, "1");
    if (!e.location?.reload) return false;
    e.location.reload();
    return true;
  } catch {
    return false;
  }
}
