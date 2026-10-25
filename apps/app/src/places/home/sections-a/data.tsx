// Home data and state: the one context the sections read. Every list is a live query over the local copy (client hooks from the generated screen index), so a section
// paints from what is kept on the device and updates when the copy changes. Writes go through `call`, one capability per action.
import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import { byId } from "./model.ts";
import type { Ref } from "./model.ts";

export type Kind = "person" | "agent" | "group" | "role" | "automation";
export interface Principal { id: string; name: string; kind: Kind }

/** Where a click goes. The shell supplies these (tabs, the right pane); Home never decides how a thing opens. */
export interface HomeNav {
  openTask(taskId: string): void;
  openRecord(recordId: string): void;
  openRun(runId: string): void;
  openNeedsYou(taskId?: string): void;
  openMyWork(): void;
  openActivity(): void;
  openAgent(agentId: string): void;
  openSubject(subject: { type: string; id: string }): void;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface HomeData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  /** Everyone the face menu and the names read from: people, agents, groups, roles. */
  principals: LiveQuery<Principal[]>;
  /** Record titles for the chip on a task, by record id. */
  recordTitle(recordId: string): string | undefined;
  me: Principal;
  nav: HomeNav;
  clock(): { now: number; offsetMin: number };
}

const DataCtx = createContext<HomeData | null>(null);

export function HomeDataProvider({ value, children }: { value: HomeData; children: ReactNode }): ReactElement {
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

/** The data the shell provided, or null before it has (the Home place then draws its loading frame). */
export function useOptionalHomeData(): HomeData | null {
  return useContext(DataCtx);
}

export function useHomeData(): HomeData {
  const v = useContext(DataCtx);
  if (!v) throw new Error("Home needs a HomeDataProvider above it");
  return v;
}

const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };

/** A live screen query (generated/screens.ts): `screens.query(screenId, name, state)`. Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useHomeData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function usePrincipals(): { list: Principal[]; byId(id: string): Principal | undefined; name(id: string): string; kindOf(ref: Ref): string } {
  const { principals } = useHomeData();
  const snap = useSyncExternalStore((principals ?? NEVER).subscribe, (principals ?? NEVER).getSnapshot, (principals ?? NEVER).getSnapshot) as QueryState<Principal[]>;
  const list = snap.status === "ready" ? snap.data : [];
  return useMemo(() => {
    const by = byId(list);
    return {
      list,
      byId: (id: string) => by.get(id),
      name: (id: string) => by.get(id)?.name ?? id,
      kindOf: (ref: Ref) => by.get(ref.id)?.kind ?? ref.kind,
    };
  }, [list]);
}

export function useOnline(): boolean {
  const { connection } = useHomeData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}

// ---------------------------------------------------------------- the quiet line with Undo

export interface HomeLine { id: number; text: string; undo: () => Promise<void> | void }
interface LineApi { line: HomeLine | null; note(text: string, undo: () => Promise<void> | void): void; undo(): void; dismiss(): void }
const LineCtx = createContext<LineApi | null>(null);

const LINE_MS = 9000;

/** One line under the greeting for the latest change, with Undo (and Cmd-Z). It fades after nine seconds. */
export function HomeLineProvider({ children, timeoutMs = LINE_MS }: { children: ReactNode; timeoutMs?: number }): ReactElement {
  const [line, setLine] = useState<HomeLine | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; setLine(null); }, []);
  const note = useCallback((text: string, undo: () => Promise<void> | void) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    setLine({ id, text, undo });
    timer.current = setTimeout(() => setLine((cur) => (cur && cur.id === id ? null : cur)), timeoutMs);
  }, [timeoutMs]);
  const api = useMemo<LineApi>(() => ({
    line, note, dismiss,
    undo() { if (line) { const u = line.undo; dismiss(); void u(); } },
  }), [line, note, dismiss]);
  return <LineCtx.Provider value={api}>{children}</LineCtx.Provider>;
}

export function useHomeLine(): LineApi {
  const v = useContext(LineCtx);
  if (!v) throw new Error("Home needs a HomeLineProvider above it");
  return v;
}

// ---------------------------------------------------------------- selection and the arrow keys

export interface Selection {
  selected: string | null;
  select(key: string | null): void;
  /** Move the highlight to the next (+1) or previous (-1) row of the page and focus it. */
  move(dir: 1 | -1, from: string): void;
  /** Sections tell the page which rows they show, in order, so arrow keys cross sections. */
  register(section: number, keys: readonly string[]): void;
  focusRef(key: string, el: { focus?: () => void } | null): void;
}
const SelCtx = createContext<Selection | null>(null);

export function nextKey(order: readonly string[], from: string | null, dir: 1 | -1): string | null {
  if (order.length === 0) return null;
  const at = from === null ? -1 : order.indexOf(from);
  if (at < 0) return dir === 1 ? order[0]! : order[order.length - 1]!;
  const next = at + dir;
  return next < 0 || next >= order.length ? order[at]! : order[next]!;
}

export function SelectionProvider({ children }: { children: ReactNode }): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const sections = useRef(new Map<number, readonly string[]>());
  const els = useRef(new Map<string, { focus?: () => void }>());
  const api = useMemo<Selection>(() => ({
    selected,
    select: setSelected,
    register(section, keys) { sections.current.set(section, keys); },
    focusRef(key, el) { if (el) els.current.set(key, el); else els.current.delete(key); },
    move(dir, from) {
      const order = [...sections.current.entries()].sort((a, b) => a[0] - b[0]).flatMap((e) => [...e[1]]);
      const to = nextKey(order, from, dir);
      if (to === null) return;
      setSelected(to);
      els.current.get(to)?.focus?.();
    },
  }), [selected]);
  return <SelCtx.Provider value={api}>{children}</SelCtx.Provider>;
}

export function useSelection(): Selection {
  const v = useContext(SelCtx);
  if (!v) throw new Error("Home needs a SelectionProvider above it");
  return v;
}
