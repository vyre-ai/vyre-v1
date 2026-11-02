// The long list on this device. One store per Space and scope, kept across visits, so the page opens painted and a change repaints one row. It watches one small number (tasks.rev) and reads the list only when that
// moves, passing the revision it holds, so a change elsewhere in the Space costs nothing. A status change shows at once and goes back, with the server's words, if the server refuses.
import type { QueryState } from "../../../../../../client/src/index.ts";
import type { IndexOut, TaskRow } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
export interface ScopeKey { scope: "mine" | "given" | "everyone"; recordId?: string }

export interface IndexSnapshot { status: "loading" | "ready" | "failed"; rows: readonly TaskRow[]; doneThisWeek: number; rev: string; error?: string; version: number }
const EMPTY: IndexSnapshot = { status: "loading", rows: [], doneThisWeek: 0, rev: "", version: 0 };

export interface TaskStore {
  get(): IndexSnapshot;
  subscribe(l: () => void): () => void;
  /** Read the list unless what is held is already this revision. */
  refresh(rev?: string): void;
  /** Change rows now; the returned function puts them back. */
  patch(ids: readonly string[], change: (row: TaskRow) => TaskRow): () => void;
  remove(ids: readonly string[]): () => void;
  byId(id: string): TaskRow | undefined;
}

export function createTaskStore(call: Call, key: ScopeKey): TaskStore {
  let snap = EMPTY;
  let reading = false, again = false;
  const listeners = new Set<() => void>();
  const set = (next: Partial<IndexSnapshot>): void => { snap = { ...snap, ...next, version: snap.version + 1 }; for (const l of [...listeners]) l(); };
  // where each row sits, so changing one row of 5,000 touches one row
  let index = new Map<string, number>();
  const reindex = (): void => { index = new Map(snap.rows.map((r, i) => [r.id, i] as const)); };
  const refresh = (rev?: string): void => {
    if (rev !== undefined && rev === snap.rev && snap.status === "ready") return;
    if (reading) { again = true; return; }
    reading = true;
    void call("tasks.index", { scope: key.scope, ...(key.recordId ? { recordId: key.recordId } : {}), ...(snap.rev !== "" ? { rev: snap.rev } : {}) }).then(
      (out) => {
        const o = out as IndexOut;
        if (o.unchanged) { if (snap.status !== "ready") set({ status: "ready" }); }
        else { snap = { ...snap, rows: o.rows, doneThisWeek: o.doneThisWeek, rev: o.rev, status: "ready" }; reindex(); set({}); }
      },
      (e: unknown) => { if (snap.status !== "ready") set({ status: "failed", error: e instanceof Error ? e.message : "Couldn't read your tasks." }); },
    ).finally(() => { reading = false; if (again) { again = false; refresh(); } });
  };
  return {
    get: () => snap,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    refresh,
    patch(ids, change) {
      const was = new Map<string, TaskRow>();
      const rows = snap.rows.slice();
      for (const id of ids) { const at = index.get(id); if (at === undefined) continue; was.set(id, rows[at]!); rows[at] = change(rows[at]!); }
      set({ rows });
      return () => {
        const next = snap.rows.slice();
        for (const [id, row] of was) { const at = index.get(id); if (at !== undefined) next[at] = row; }
        set({ rows: next });
      };
    },
    remove(ids) {
      const want = new Set(ids);
      const at = snap.rows.filter((r) => want.has(r.id));
      snap = { ...snap, rows: snap.rows.filter((r) => !want.has(r.id)) }; reindex(); set({});
      return () => { snap = { ...snap, rows: [...at, ...snap.rows] }; reindex(); set({}); };
    },
    byId: (id) => { const at = index.get(id); return at === undefined ? undefined : snap.rows[at]; },
  };
}

/** The stores of one Space, so going back to Tasks finds its list. */
const stores = new WeakMap<object, Map<string, TaskStore>>();
export function storeFor(owner: object, call: Call, key: ScopeKey): TaskStore {
  let m = stores.get(owner);
  if (!m) { m = new Map(); stores.set(owner, m); }
  const k = `${key.scope}:${key.recordId ?? ""}`;
  let s = m.get(k);
  if (!s) { s = createTaskStore(call, key); m.set(k, s); }
  return s;
}

export type { QueryState };
