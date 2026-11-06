// The actions every row of the chat is handed. The chat builds them again on every render (a key typed in the composer is a render), and a row that is handed new ones must draw again; with 2,000 rows that is the
// lag. This keeps the data and swaps every function for one that never changes and calls the newest version, so a row can be skipped (see sameRow in MessageView) and still do the latest thing when pressed.

type Fn = (...args: unknown[]) => unknown;
export interface Delegates { latest: unknown; fns: Map<string, Fn> }

export const newDelegates = (): Delegates => ({ latest: null, fns: new Map() });

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

function at(root: unknown, path: readonly string[]): unknown {
  let cur = root;
  for (const k of path) cur = (cur as Record<string, unknown> | undefined)?.[k];
  return cur;
}

function delegate(d: Delegates, path: readonly string[]): Fn {
  const id = path.join("\u0000");
  let f = d.fns.get(id);
  if (!f) {
    f = (...args) => {
      const fn = at(d.latest, path);
      return typeof fn === "function" ? (fn as Fn).apply(at(d.latest, path.slice(0, -1)), args) : undefined;
    };
    d.fns.set(id, f);
  }
  return f;
}

/** A copy of `actions` (two levels deep) whose functions are the stable delegates of `d`. Data keeps its own identity. */
export function stableActions<T extends object>(d: Delegates, actions: T): T {
  d.latest = actions;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actions)) {
    if (typeof v === "function") out[k] = delegate(d, [k]);
    else if (isPlain(v)) {
      const inner: Record<string, unknown> = {};
      for (const [k2, v2] of Object.entries(v)) inner[k2] = typeof v2 === "function" ? delegate(d, [k, k2]) : v2;
      out[k] = inner;
    } else out[k] = v;
  }
  return out as T;
}
