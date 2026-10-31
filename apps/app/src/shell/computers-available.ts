// Can an agent computer run in this Space? A Team Space says yes as before. A Personal Space says yes once a capable host exists: a server the person added, or this computer with Docker
// (computers.hosts). Until then nothing about agent computers is drawn: no tab, no button, no sentence. The answer is kept per Space and every reader hears when it changes, so the
// Computer tab appears the moment the first server is approved.
import { useEffect, useSyncExternalStore } from "react";

const known = new Map<string, boolean>();
const listeners = new Set<() => void>();
let version = 0;

/** The last answer for this Space; Team Spaces are always yes, a Personal Space is no until a host has said otherwise. */
export function computersAvailableNow(space: { id: string; kind: "team" | "personal" }): boolean {
  return space.kind === "team" ? true : known.get(space.id) === true;
}

export function setComputersAvailable(spaceId: string, available: boolean): void {
  if (known.get(spaceId) === available) return;
  known.set(spaceId, available);
  version += 1;
  for (const l of [...listeners]) l();
}

/** Ask the Space where an agent computer can run, and keep the answer. A failed ask changes nothing. */
export async function refreshComputersAvailable(rt: { space: { id: string; kind: "team" | "personal" }; call(cap: string, input: unknown): Promise<unknown> }): Promise<boolean> {
  if (rt.space.kind === "team") return true;
  try {
    const out = (await rt.call("computers.hosts", {})) as { available?: boolean };
    setComputersAvailable(rt.space.id, out.available === true);
  } catch { /* the last answer stands */ }
  return computersAvailableNow(rt.space);
}

/** For a place: re-renders when the answer changes, and in a Personal Space asks once when the place opens. */
export function useComputersAvailable(rt: { space: { id: string; kind: "team" | "personal" }; call(cap: string, input: unknown): Promise<unknown> }): boolean {
  useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => version, () => version);
  const personal = rt.space.kind === "personal";
  useEffect(() => { if (personal) void refreshComputersAvailable(rt); }, [personal, rt.space.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  return computersAvailableNow(rt.space);
}

/** Tests: forget every answer. */
export function resetComputersAvailable(): void { known.clear(); version += 1; for (const l of [...listeners]) l(); }

// ---- "Add a server" asked for from somewhere other than Settings > Computers (the Space menu, an agent's page): the sheet opens when Computers does.
let addAsked = false;
let addNonce = 0;
const askListeners = new Set<() => void>();
/** Someone asked for the Add a server sheet; Settings opens on Computers with it. */
export function requestAddServer(): void { addAsked = true; addNonce += 1; for (const l of [...askListeners]) l(); }
export const addServerAsked = (): boolean => addAsked;
/** Computers took the request: the sheet is open, so it is not asked again. */
export function takeAddServerRequest(): boolean { const was = addAsked; addAsked = false; return was; }
/** A counter that changes with each request, so a place that is already open can reopen on the right page. */
export function useAddServerNonce(): number { return useSyncExternalStore((l) => { askListeners.add(l); return () => { askListeners.delete(l); }; }, () => addNonce, () => addNonce); }
