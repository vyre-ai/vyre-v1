// What the memory surfaces inside a chat read: one context of a small store over the memory capabilities. Reads are cached by capability and input and refetched after any write (the screens
// show the stale answer while the new one loads, so a row never flickers); writes go through `write`, which bumps the version. The shell builds one store per Space and hands the same one
// to the conversation and the right pane, so a Forget in the pane updates the Learned line under a message. A capability that does not exist (an older server) answers "absent" and the
// surface draws nothing, never an error. The conversation's `data.memory` and the pane's `data.memory` are this interface; both are optional.
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";

/** Where a click goes. The shell decides how a thing opens; the surfaces only say what. */
export interface ChatMemoryNav {
  /** A `vyre://thread/<id>?m=<message>` link: opens that chat at that line, highlighted. */
  openLink(link: string): void;
  /** A page in Files Knowledge. */
  openPage(pageId: string): void;
  /** The graph around a page. */
  openGraph(pageId: string): void;
  /** Files Knowledge, on Learned. */
  openKnowledge(): void;
  /** The source of a fact that is not a chat line: a record, a run, a task. */
  openSource(kind: string, ref: string, link?: string): void;
}

export interface ChatMemoryData {
  store: MemoryStore;
  now(): number;
  me: { id: string; name: string };
  nameOf(id: string): string;
  nav: ChatMemoryNav;
  /** Opens the right pane on the Knows tab (the shell opens the pane if it is closed). Absent where the chat has no pane. */
  showKnows?(): void;
}

export type Read<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "absent" };

export interface KnowsFocus {
  /** The reply the Knows tab is pinned to, or null for now. */
  messageId: string | null;
  /** When that reply was written: facts learned after it are hidden. */
  asOf: number | null;
  /** The reply's author, for the header. */
  seq: number;
}

export interface MemoryStore {
  /** One capability call as the person; rejects with the capability's error. Does not touch the cache. */
  call(cap: string, input: unknown): Promise<unknown>;
  /** A write: the call, then every read is stale. */
  write<T = unknown>(cap: string, input: unknown): Promise<T>;
  /** A read, cached. Resolves with the output; rejects when the capability is missing or refuses. */
  read<T>(cap: string, input: unknown): Promise<T>;
  /** What the cache holds for a read right now (stale after a write until the new answer lands). */
  peek<T>(cap: string, input: unknown): Read<T>;
  version(): number;
  bump(): void;
  subscribe(l: () => void): () => void;
  /** The Knows tab's pin: "Show what the agent knew here" sets it, "Back to now" clears it. */
  knows(): KnowsFocus;
  pinKnows(messageId: string | null, asOf: number | null): void;
  /** A map that outlives a mount, per key: the lines a thread showed (a Learned line stays on the page after its fact is undone, with Restore). */
  kept<T>(key: string): Map<string, T>;
  /** True once after the pin was set by a request to open the tab (the pane reads it on mount and on change). */
  takeKnowsRequest(): boolean;
}

const keyOf = (cap: string, input: unknown): string => `${cap}|${JSON.stringify(input ?? {})}`;

/** The store over a call function. `absent` is what a missing or refused read becomes. */
export function createMemoryStore(call: (cap: string, input: unknown) => Promise<unknown>): MemoryStore {
  let version = 0;
  const listeners = new Set<() => void>();
  const results = new Map<string, Read<unknown>>();
  const inflight = new Map<string, Promise<unknown>>();
  let focus: KnowsFocus = { messageId: null, asOf: null, seq: 0 };
  let requested = false;
  const keptMaps = new Map<string, Map<string, unknown>>();
  const emit = (): void => { for (const l of [...listeners]) l(); };
  const store: MemoryStore = {
    call,
    async write(cap, input) {
      const out = await call(cap, input);
      store.bump();
      return out as never;
    },
    read<T>(cap: string, input: unknown): Promise<T> {
      const k = keyOf(cap, input);
      const flying = inflight.get(`${k}@${version}`);
      if (flying) return flying as Promise<T>;
      const at = version;
      const p = call(cap, input).then(
        (out) => { if (at === version) { results.set(k, { status: "ready", data: out }); emit(); } return out as T; },
        (e: unknown) => { if (at === version) { results.set(k, { status: "absent" }); emit(); } throw e; },
      );
      inflight.set(`${k}@${at}`, p);
      void p.then(() => inflight.delete(`${k}@${at}`), () => inflight.delete(`${k}@${at}`));
      return p;
    },
    peek<T>(cap: string, input: unknown): Read<T> {
      return (results.get(keyOf(cap, input)) as Read<T> | undefined) ?? { status: "loading" };
    },
    version: () => version,
    bump() { version += 1; emit(); },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    knows: () => focus,
    pinKnows(messageId, asOf) { focus = { messageId, asOf, seq: focus.seq + 1 }; requested = messageId !== null; emit(); },
    kept<T>(key: string): Map<string, T> {
      let m = keptMaps.get(key);
      if (!m) { m = new Map(); keptMaps.set(key, m); }
      return m as Map<string, T>;
    },
    takeKnowsRequest() { const r = requested; requested = false; return r; },
  };
  return store;
}

// ---------------------------------------------------------------- context

const Ctx = createContext<ChatMemoryData | null>(null);

export function ChatMemoryContext({ value, children }: { value: ChatMemoryData | undefined; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value ?? null}>{children}</Ctx.Provider>;
}

/** The memory of the open chat, or null where the shell gave none (then every memory surface draws nothing). */
export function useChatMemory(): ChatMemoryData | null {
  return useContext(Ctx);
}

/** The store's version: a component that reads through `useRead` re-renders when it changes. */
export function useStoreVersion(store: MemoryStore | null): number {
  const sub = useMemo(() => (l: () => void) => (store ? store.subscribe(l) : () => undefined), [store]);
  return useSyncExternalStore(sub, () => (store ? store.version() : 0), () => (store ? store.version() : 0));
}

/**
 * A cached read. `input` null skips it (loading). While the answer is on its way a stale one is shown; a missing capability is "absent". The effect asks again whenever the version moves,
 * and a render before any effect (a static render in a test) shows what the cache already holds.
 */
export function useRead<T>(store: MemoryStore | null, cap: string, input: unknown | null): Read<T> {
  const version = useStoreVersion(store);
  const key = input === null ? "" : keyOf(cap, input);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!store || input === null) return undefined;
    let live = true;
    store.read(cap, input).then(() => { if (live) tick((n) => n + 1); }, () => { if (live) tick((n) => n + 1); });
    return () => { live = false; };
    // the key stands for the input; the version moves after a write
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, cap, key, version]);
  if (!store || input === null) return { status: "loading" };
  return store.peek<T>(cap, input);
}

/** The Knows pin as a value (re-renders when it changes). */
export function useKnowsFocus(store: MemoryStore | null): KnowsFocus {
  const sub = useMemo(() => (l: () => void) => (store ? store.subscribe(l) : () => undefined), [store]);
  const none: KnowsFocus = useMemo(() => ({ messageId: null, asOf: null, seq: 0 }), []);
  useSyncExternalStore(sub, () => (store ? store.knows().seq : 0), () => 0);
  return store ? store.knows() : none;
}

/** An error as one line of text for a flash. */
export function errorLine(e: unknown, what: string): string {
  const msg = e instanceof Error ? e.message : "";
  return msg ? `${what}: ${msg}` : `${what}.`;
}
