// Automations data: the one context the sidebar and the canvas read. Every list is a live query over the local copy (client screen hooks), so a row paints from what
// is kept on the device and updates when the copy changes. Writes go through `call`, one capability per action. The shell supplies the value; the place never decides how a thing opens.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { AskBundle } from "../ask/bundle.ts";
import type { AccountOption } from "../connect/accounts.ts";
import type { ConnectTarget } from "../connect/route.ts";
import type { KeyChoice } from "./model.ts";

export type KeysStatus = "loading" | "ready" | "empty" | "unavailable";

export interface AutomationsNav {
  openAutomation(id: string): void;
  openJourney(id: string): void;
  /** Opens the New Journey type sheet. Without it the plus on the Journey types header is not drawn. */
  newJourney?(): void;
  openFailedRuns(): void;
  openRun(runId: string): void;
  /** Ask Vyre about this Automation. The bundle is already scrubbed. */
  ask(id: string, context?: AskBundle): void;
  /** Open the connection screen named by a structured service. */
  connect(target: ConnectTarget): void;
  /** The provider and key screen. */
  openKeys?(): void;
}

export interface AutomationsData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  me: { id: string; name: string };
  /** A person, agent, group, role or key by id, as a name. */
  name(id: string): string;
  /** The sign-ins and API keys shared with this person, for an AI step's key and backup. */
  keys: readonly KeyChoice[];
  /** Accounts the parent already loaded. The step picker lists these and does not fetch. */
  accounts?: readonly AccountOption[];
  /** Set when the place loaded providers.list. Absent on sample data that already supplies keys. */
  keysStatus?: KeysStatus;
  nav: AutomationsNav;
  clock(): { now: number };
}

const Ctx = createContext<AutomationsData | null>(null);

export function AutomationsDataProvider({ value, children }: { value: AutomationsData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useOptionalAutomationsData(): AutomationsData | null {
  return useContext(Ctx);
}
export function useAutomationsData(): AutomationsData {
  const v = useContext(Ctx);
  if (!v) throw new Error("Automations needs an AutomationsDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts): `screens.query(screenId, name, state)`. Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useAutomationsData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export const SIDEBAR = "automations.sidebar";
export const CANVAS = "automations.canvas";
export const CONFIG = "automations.config";
