// What the agent's pauses remember across the extension's service worker, which Chrome stops after about 30 seconds idle and starts again on the next message. A Stop, an Esc and a take-over belong to the person; if the worker's
// memory were the only place they lived, a restart would free the agent while the bar still says the tab is theirs. They are kept in the browser's per-session storage (gone when the browser closes, never synced, never on disk):
// who paused (by), when (at), and which tabs wear the bar for which agent, so the bar's Give back still finds its agent. Ids, a word and numbers only: no page content, no secret.

const KEY = "agentPauses";
const BY = new Set(["person", "esc", "tool", "takeover"]);

/** @typedef {{ pauses: Array<{ agent: string, by: "person" | "esc" | "tool" | "takeover", at: number }>, bars: Array<{ tab: number, id: string, name: string }> }} Kept */

const MAX = 200;
/** @param {any} p */
const goodPause = (p) => Boolean(p) && typeof p.agent === "string" && BY.has(p.by) && Number.isFinite(p.at);
/** @param {any} b */
const goodBar = (b) => Boolean(b) && Number.isInteger(b.tab) && typeof b.id === "string" && typeof b.name === "string";

/**
 * Read a kept record entry by entry: every good entry is kept and only a bad one is dropped (one bad entry must not lose another agent's Stop); past 200 the newest 200 are kept. Null when the record is not a
 * record at all (its two lists are missing or not lists): that is unreadable, not empty.
 * @param {unknown} v @returns {Kept | null}
 */
function readable(v) {
  if (!v || typeof v !== "object") return null;
  const o = /** @type {any} */ (v);
  if (!Array.isArray(o.pauses) || !Array.isArray(o.bars)) return null;
  return {
    pauses: o.pauses
      .filter(goodPause)
      .sort((/** @type {any} */ a, /** @type {any} */ b) => b.at - a.at)
      .slice(0, MAX),
    bars: o.bars.filter(goodBar).slice(-MAX),
  };
}

/**
 * @param {{ get(keys: string[]): Promise<Record<string, any>>, set(items: Record<string, any>): Promise<void> } | undefined | null} area
 */
export function createPauseKeep(area) {
  return {
    /** @returns {Promise<Kept | null>} */
    /** Nothing kept is null; a storage that fails to answer, or a record that cannot be read, throws, so the caller keeps refusing and tries again instead of starting empty. */
    async load() {
      if (!area) return null;
      const raw = await area.get([KEY]);
      if (!(KEY in raw) || raw[KEY] === undefined) return null;
      const rec = readable(raw[KEY]);
      if (!rec) {
        // unreadable is not empty: keep refusing and try again. Storage itself answered, so a pause made live meanwhile may be written over it (the next read then finds a good record).
        throw Object.assign(new Error("the kept pauses cannot be read"), { unreadable: true });
      }
      return rec;
    },
    /** @param {Kept} rec */
    async save(rec) {
      if (!area) return;
      try {
        await area.set({ [KEY]: rec });
      } catch {
        /* the pause still holds in memory; only a restart could lose it */
      }
    },
  };
}
