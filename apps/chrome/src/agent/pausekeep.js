// What the agent's pauses remember across the extension's service worker, which Chrome stops after about 30 seconds idle and starts again on the next message. A Stop, an Esc and a take-over belong to the person; if the worker's
// memory were the only place they lived, a restart would free the agent while the bar still says the tab is theirs. They are kept in the browser's per-session storage (gone when the browser closes, never synced, never on disk):
// who paused (by), when (at), and which tabs wear the bar for which agent, so the bar's Give back still finds its agent. Ids, a word and numbers only: no page content, no secret.

const KEY = "agentPauses";
const BY = new Set(["person", "esc", "tool", "takeover"]);

/** @typedef {{ pauses: Array<{ agent: string, by: "person" | "esc" | "tool" | "takeover", at: number }>, bars: Array<{ tab: number, id: string, name: string }> }} Kept */

/** @param {unknown} v @returns {v is Kept} */
function valid(v) {
  if (!v || typeof v !== "object") return false;
  const o = /** @type {any} */ (v);
  return (
    Array.isArray(o.pauses) &&
    o.pauses.length <= 200 &&
    o.pauses.every((/** @type {any} */ p) => p && typeof p.agent === "string" && BY.has(p.by) && Number.isFinite(p.at)) &&
    Array.isArray(o.bars) &&
    o.bars.length <= 200 &&
    o.bars.every(
      (/** @type {any} */ b) => b && Number.isInteger(b.tab) && typeof b.id === "string" && typeof b.name === "string",
    )
  );
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
      if (!valid(raw[KEY])) throw new Error("the kept pauses cannot be read"); // unreadable is not empty: keep refusing and try again
      return raw[KEY];
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
