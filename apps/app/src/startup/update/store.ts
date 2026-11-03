// The app's one view of updates: the desktop shell's commands (src-tauri/src/updater.rs) and what the last check found, shared by the start, the Settings row and the dot on Settings.
// In a browser or on a phone there is no shell: the page itself is the new version as soon as it loads (the service worker fetches navigations from the network first), so only What's new applies.
import type { Progress, Store, UpdateCheck, WhatsNew } from "./model.ts";
import { parseWhatsNew } from "./model.ts";
import { fetchWhatsNew } from "../../../../../client/src/gateway/whats-new.ts";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type Listen = (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
interface TauriLike { core?: { invoke?: Invoke }; event?: { listen?: Listen } }

export const PROGRESS_EVENT = "vyre://update-progress";

export interface DesktopUpdates {
  /** The startup check: waits up to `waitMs` for it, then says what is known ("checking" when it has not answered). */
  startup(waitMs: number): Promise<UpdateCheck>;
  /** Check again now. A failure comes back as words. */
  check(): Promise<UpdateCheck>;
  /** Download, verify, stop the background service, install and restart. Resolves only if something failed before the restart; `onProgress` hears each step. */
  install(onProgress?: (p: Progress) => void): Promise<void>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The shell's answer, read strictly: anything it cannot read is a failed check. */
export function readCheck(r: unknown): UpdateCheck {
  const o = (r ?? {}) as Record<string, unknown>;
  const current = str(o["current"]), channel = str(o["channel"]);
  if (!current || !channel) throw new Error("The update server gave an answer Vyre could not read.");
  const version = str(o["version"]);
  const phase = o["phase"] === "checking" || o["phase"] === "failed" || o["phase"] === "none" || o["phase"] === "available" ? o["phase"] : version ? "available" : "none";
  return { phase, current, channel, version, notes: str(o["notes"]), checkedAt: typeof o["checkedAt"] === "number" ? o["checkedAt"] : null };
}

export function readProgress(v: unknown): Progress | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const phases = ["download", "verify", "waiting", "stopping", "installing", "restarting"] as const;
  const phase = phases.find((p) => p === o["phase"]);
  if (!phase) return null;
  const n = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
  return { phase, downloaded: n(o["downloaded"]), total: typeof o["total"] === "number" && o["total"] > 0 ? o["total"] : null, ...(typeof o["turns"] === "number" ? { turns: o["turns"] } : {}) };
}

/** The shell's update commands; undefined in a browser. */
export function desktopUpdates(tauri: TauriLike | undefined = (globalThis as { __TAURI__?: TauriLike }).__TAURI__): DesktopUpdates | undefined {
  const invoke = tauri?.core?.invoke;
  if (!invoke) return undefined;
  const listen = tauri?.event?.listen;
  return {
    async startup(waitMs) { return readCheck(await invoke("startup_update", { waitMs: Math.max(0, Math.min(10_000, Math.round(waitMs))) })); },
    async check() { return readCheck(await invoke("check_desktop_update")); },
    async install(onProgress) {
      let off: (() => void) | undefined;
      if (onProgress && listen) { try { off = await listen(PROGRESS_EVENT, (e) => { const p = readProgress(e.payload); if (p) onProgress(p); }); } catch { off = undefined; } }
      try { await invoke("install_desktop_update"); } finally { off?.(); }
    },
  };
}

// ---- what the last check found, for Settings and the rail dot

export interface UpdateState { check: UpdateCheck | null; installing: boolean }
let state: UpdateState = { check: null, installing: false };
const listeners = new Set<() => void>();

export const updateState = (): UpdateState => state;
export function subscribeUpdates(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function setUpdateState(next: Partial<UpdateState>): void { state = { ...state, ...next }; for (const l of listeners) l(); }
/** Tests. */
export function resetUpdateState(): void { state = { check: null, installing: false }; }

/** A newer version is there and not being installed: the Settings row and the dot. */
export const updateWaiting = (s: UpdateState): boolean => !s.installing && s.check?.phase === "available" && s.check.version !== null;

// ---- the release's own What's new, from the build

export function localStore(): Store | null {
  try { return (globalThis as { localStorage?: Store }).localStorage ?? null; } catch { return null; }
}

let notes: Promise<WhatsNew | null> | null = null;
/** whats-new.json beside the page, read once per open. Offline or missing is nothing. */
export function loadWhatsNew(read: () => Promise<unknown> = () => fetchWhatsNew()): Promise<WhatsNew | null> {
  notes ??= read().then(parseWhatsNew, () => null);
  return notes;
}
/** Tests. */
export function resetWhatsNew(): void { notes = null; }
