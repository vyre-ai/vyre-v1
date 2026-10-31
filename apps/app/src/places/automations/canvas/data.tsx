// Automations data: the one context the sidebar and the canvas read. Every list is a live query over the local copy (client screen hooks), so a row paints from what
// is kept on the device and updates when the copy changes. Writes go through `call`, one capability per action. The shell supplies the value; the place never decides how a thing opens.
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
  /** Opens the template gallery. Without it "From a template" is not offered. */
  openTemplates?(): void;
  openRun(runId: string): void;
  /** Ask Vyre about this Automation. The bundle is already scrubbed. */
  ask(id: string, context?: AskBundle): void;
  /** Open the connection screen named by a structured service. */
  connect(target: ConnectTarget): void;
  /** The provider and key screen. */
  openKeys?(): void;
  /** Start the connector session for a Vault item the person accepted an offer for. Without it an offer has no Set up button. */
  setUpConnector?(offer: { itemId: string; appName: string }): Promise<void> | void;
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
  /** Last explicit pick for this person, keyed by app. Absent when the parent did not load one. */
  lastPicks?: Readonly<Record<string, string>>;
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

/** The registry's route pointers (/route/automationId, /route/runId, /route/journeyId) read the state's `route`; a place that names the id once at the top of the state gets the route filled in. */
export function withRoute(state: Record<string, unknown>): Record<string, unknown> {
  const route: Record<string, unknown> = { ...((state["route"] as Record<string, unknown> | undefined) ?? {}) };
  for (const k of ["automationId", "runId", "journeyId"]) if (state[k] !== undefined && route[k] === undefined) route[k] = state[k];
  return Object.keys(route).length === 0 ? state : { ...state, route };
}

/** A live screen query (generated/screens.ts): `screens.query(screenId, name, state)`. Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useAutomationsData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, withRoute(JSON.parse(key) as Record<string, unknown>)) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

/**
 * One read of a capability, again when `refreshKey` changes. For the screen queries the registry marks `live: false` (versions, previews), which the shell's live hooks refuse by design:
 * asking them through useScreenQuery crashes the place ("query ... is not live"). A person reads them with a plain call, as the Ask before sending toggle does.
 */
export function useRead<T>(cap: string, input: Record<string, unknown>, refreshKey: unknown = 0, enabled = true): QueryState<T> {
  const data = useAutomationsData();
  const key = JSON.stringify(input);
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return undefined;
    let off = false;
    data.call(cap, JSON.parse(key)).then(
      (out) => { if (!off) setState({ status: "ready", data: out as T }); },
      (e: unknown) => { if (!off) setState({ status: "loading", error: { message: e instanceof Error ? e.message : "Could not read this." } }); },
    );
    return () => { off = true; };
  }, [data, cap, key, refreshKey, enabled]);
  return state;
}

const NO_SUB = (): (() => void) => () => undefined;
const LOADING: QueryState<never> = { status: "loading" };

/** A screen query where the screen has it live (the sample data, tests); where the registry marks it not live (the real shell), a plain read of the same capability. */
export function useScreenOrRead<T>(screenId: string, name: string, state: Record<string, unknown>, cap: string, input: Record<string, unknown>, refreshKey: unknown = 0): QueryState<T> {
  const { screens } = useAutomationsData();
  const key = JSON.stringify(state);
  const live = useMemo(() => { try { return screens.query(screenId, name, withRoute(JSON.parse(key) as Record<string, unknown>)) as LiveQuery<T>; } catch { return null; } }, [screens, screenId, name, key]);
  const fromLive = useSyncExternalStore(live ? live.subscribe : NO_SUB, live ? live.getSnapshot : () => LOADING as QueryState<T>, live ? live.getSnapshot : () => LOADING as QueryState<T>);
  const fromRead = useRead<T>(cap, input, refreshKey, live === null);
  return live ? fromLive : fromRead;
}

export const SIDEBAR = "automations.sidebar";
export const CANVAS = "automations.canvas";
export const CONFIG = "automations.config";
