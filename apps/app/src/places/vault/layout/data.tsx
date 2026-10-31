// Vault data: the one context the place reads. Lists are live screen queries over the local copy (generated/screens.ts: vault.layout, vault.item), so the place paints from what
// the device keeps and updates when it changes. Writes go through `call`, one capability per action. Values never come through a query: only vault.item.reveal returns them.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";

export interface Principal { id: string; name: string; kind: "person" | "agent" | "group" | "role" | "automation" }

/** Where a click goes outside this place. The shell supplies these; the Vault never decides how something opens. */
export interface VaultNav {
  /** Share sheet for an item (P-L9f_05 draws it). */
  openShare(itemId: string): void;
  /** The Export sheet for a folder. */
  openExport(folderId: string): void;
  /** The Advanced page: emergency access, recovery key, backups, devices, outside-agent passes. */
  openAdvanced(): void;
  /** Contract-backed security surfaces linked from Advanced. */
  openBackups(): void;
  openDevices(): void;
  openOutsideActors(): void;
  /** Who may export, the longest a download link lasts, and whether a reveal asks why. */
  openPolicy(): void;
  /** The Automation or agent that is asking for a key. */
  openRequests(): void;
  openAgent(agentId: string): void;
  /** Starts a new thread (or hands the task over) with an agent about an item. Without it Ask still lists the agents and does nothing. */
  ask?(agentId: string, mode: "chat" | "do", about: { kind: string; id: string; title: string }): void;
  /** Add to Automations: starts the person's assistant on a connector built from this item. The shell puts the app name and the handle in the first message. */
  addToAutomations?(item: { id: string; name: string; handle: string }): void;
  /** An Automation that uses an item, opened in Automations. */
  openAutomation?(automationId: string): void;
  /** The Add an AI account sheet, for a blocker that says to connect one. */
  openAddProvider?(): void;
}

/** The desktop app's way to put Vyre for Chrome into Chrome (no Web Store listing yet). Only the desktop shell supplies it; the web app and the phone have no Advanced row for it. */
export interface VaultBrowsers {
  /** Copies the extension out of the app, registers the native host with the installed browsers, and says where the folder is. Rejects with words for a person. */
  install(): Promise<{ extensionDir: string; version: string; browsers: string[] }>;
  /** Opens Chrome's extensions page. */
  openExtensionsPage(): Promise<void>;
  /** Shows the installed folder in the file manager. */
  revealFolder(): Promise<void>;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface VaultData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  principals: LiveQuery<Principal[]>;
  me: Principal;
  /** The Space's name, for handles like #Northwind_GoHighLevel. */
  spaceName: string;
  /** A Personal Space: sharing has no meaning here, so the Share action, the Shared section and the sharing lists are not drawn. */
  personal?: boolean;
  nav: VaultNav;
  clock(): { now: number };
  /** Copies text to the clipboard. The shell may route this through the system pasteboard. */
  copy?(text: string): Promise<void> | void;
  /** Opens the system file chooser for an export to import; resolves the stored file's id, or null when the person cancels. The shell supplies it. */
  pickFile?(accept: string): Promise<string | null>;
  /** Install Vyre for Chrome from this app (desktop only). Without it the Advanced page has no row for it. */
  browsers?: VaultBrowsers;
}

const DataCtx = createContext<VaultData | null>(null);

export function VaultDataProvider({ value, children }: { value: VaultData; children: ReactNode }): ReactElement {
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useOptionalVaultData(): VaultData | null {
  return useContext(DataCtx);
}

export function useVaultData(): VaultData {
  const v = useContext(DataCtx);
  if (!v) throw new Error("The Vault needs a VaultDataProvider above it");
  return v;
}

const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };

/** A live screen query. Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useVaultData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

/** Ask the live screen layer to retry failed reads when the host supports invalidation. */
export function retryVaultQueries(screens: ScreenHooks): boolean {
  const invalidate = (screens as ScreenHooks & { invalidate?: () => void }).invalidate;
  if (typeof invalidate !== "function") return false;
  invalidate.call(screens);
  return true;
}

export function usePrincipals(): { name(id: string): string; all: readonly Principal[] } {
  const { principals } = useVaultData();
  const src = principals ?? NEVER;
  const snap = useSyncExternalStore(src.subscribe, src.getSnapshot, src.getSnapshot) as QueryState<Principal[]>;
  return useMemo(() => {
    const by = new Map((snap.status === "ready" ? snap.data : []).map((p) => [p.id, p] as const));
    return { name: (id: string) => by.get(id)?.name ?? id, all: snap.status === "ready" ? snap.data : [] };
  }, [snap]);
}

export function useOnline(): boolean {
  const { connection } = useVaultData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}

/** The clipboard, through the shell's hook when it gave one. */
export async function copyText(data: VaultData, text: string): Promise<void> {
  if (data.copy) { await data.copy(text); return; }
  const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
  await nav?.clipboard?.writeText(text);
}
