// Vault reveal: values stay hidden until a person asks. One store per open item. The first reveal asks once ("logged under your name"), then every reveal and copy is one
// vault.item.reveal call (View level; the capability logs it per actor). Revealed values live only in this store, hide again after a while, and are dropped when the item closes.
// No value is ever written to a query, an event or a log from here.

export type Call = (cap: string, input: unknown) => Promise<unknown>;

export interface RevealState {
  /** Values shown now, by field key. */
  shown: ReadonlyMap<string, string>;
  /** true once the person agreed to the logged reveal for this item. */
  agreed: boolean;
  /** the field waiting on that first agreement, if any. */
  asking: { keys: string[]; then: "show" | "copy" } | null;
  busy: boolean;
  /** The words of the last refusal or failure, for the line under the card. */
  error: string | null;
}

export const HIDE_AFTER_MS = 60_000;

export interface RevealStore {
  get(): RevealState;
  subscribe(l: () => void): () => void;
  /** Ask to show fields. The first time for an item this stops at the agreement. */
  reveal(keys: string[], then?: "show" | "copy"): Promise<void>;
  /** The agreement was given (or refused) in the line under the card. */
  agree(): Promise<void>;
  decline(): void;
  hide(keys?: string[]): void;
  /** Copy a field: reveals it (logged) when it is not shown, then hands the text to `copy`. */
  copy(key: string): Promise<void>;
  /** Drop every shown value and timer (the item closed). The store stays usable, so a remount in development does not break it. */
  dispose(): void;
}

export interface RevealDeps {
  itemId: string;
  call: Call;
  copy: (text: string) => Promise<void> | void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  hideAfterMs?: number;
}

const words = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  if (/provider_label/.test(m)) return "This is an AI provider sign-in. Its value is never shown to anyone.";
  if (/above_clearance/.test(m)) return "Your clearance is below this item's label, so its value stays hidden.";
  if (/permission|forbidden|denied/i.test(m)) return "You can use this item but not see its values.";
  return "Could not reveal the value. Try again.";
};

export function createRevealStore(deps: RevealDeps): RevealStore {
  const setT = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const ms = deps.hideAfterMs ?? HIDE_AFTER_MS;
  let state: RevealState = { shown: new Map(), agreed: false, asking: null, busy: false, error: null };
  const listeners = new Set<() => void>();
  const timers = new Map<string, unknown>();
  const set = (next: Partial<RevealState>): void => { state = { ...state, ...next }; for (const l of [...listeners]) l(); };

  async function fetchKeys(keys: string[]): Promise<Map<string, string>> {
    set({ busy: true, error: null });
    try {
      const out = (await deps.call("vault.item.reveal", { itemId: deps.itemId, fields: keys })) as { fields: { key: string; value: string }[] };
      const got = new Map<string, string>();
      for (const f of out.fields) got.set(f.key, f.value);
      return got;
    } catch (e) {
      set({ busy: false, error: words(e) });
      throw e;
    }
  }

  function show(got: Map<string, string>): void {
    const shown = new Map(state.shown);
    for (const [k, v] of got) {
      shown.set(k, v);
      const old = timers.get(k);
      if (old !== undefined) clearT(old);
      timers.set(k, setT(() => store.hide([k]), ms));
    }
    set({ shown, busy: false });
  }

  async function run(keys: string[], then: "show" | "copy"): Promise<void> {
    let got: Map<string, string>;
    try { got = await fetchKeys(keys); } catch { return; }
    if (then === "copy") {
      const text = keys.map((k) => got.get(k) ?? "").join("\n");
      try { await deps.copy(text); } catch { set({ error: "Could not copy. Select the value and copy it by hand." }); }
      // a copy does not leave the value on screen
      set({ busy: false });
      return;
    }
    show(got);
  }

  const store: RevealStore = {
    get: () => state,
    subscribe(l) { listeners.add(l); return () => void listeners.delete(l); },
    async reveal(keys, then = "show") {
      if (keys.length === 0) return;
      if (then === "show" && keys.every((k) => state.shown.has(k))) return;
      if (!state.agreed) { set({ asking: { keys, then }, error: null }); return; }
      await run(keys, then);
    },
    async agree() {
      const ask = state.asking;
      if (!ask) return;
      set({ agreed: true, asking: null });
      await run(ask.keys, ask.then);
    },
    decline() { set({ asking: null }); },
    hide(keys) {
      const shown = new Map(state.shown);
      for (const k of keys ?? [...shown.keys()]) { shown.delete(k); const t = timers.get(k); if (t !== undefined) { clearT(t); timers.delete(k); } }
      set({ shown });
    },
    async copy(key) {
      const have = state.shown.get(key);
      if (have !== undefined) { try { await deps.copy(have); } catch { set({ error: "Could not copy. Select the value and copy it by hand." }); } return; }
      await store.reveal([key], "copy");
    },
    dispose() {
      for (const t of timers.values()) clearT(t);
      timers.clear();
      state = { shown: new Map(), agreed: false, asking: null, busy: false, error: null };
    },
  };
  return store;
}
