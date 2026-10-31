// @ts-check
// The live socket on a phone: the page cannot open a WebSocket to the box (its own origin is the relay's gateway), so a shim in the page (wsshim.js) hands each socket to the service worker,
// which holds the encrypted channel and opens the stream on it (Connection.socket). One bridge per page; the page names a URL, the worker keeps only its path and query, and only the streams listed
// here are ever opened (the Space's live socket, and an agent computer's screen).
import { createWsBridge, ALLOWED } from "../wsbridge.js";

/** The Space's live socket carries the session token in its query; the box checks it as it does for a direct connection. */
export const PAGE_STREAMS = Object.freeze([...ALLOWED, /^\/sync\/v1\/ws(\?[^\s\0#]*)?$/]);
export const MAX_PAGE_SOCKETS = 4;

/**
 * @param {{ conn: () => { socket(path: string): any } | null }} o `conn` gives the open Connection, or null before there is one
 */
export function createLive(o) {
  /** @type {Map<string, ReturnType<typeof createWsBridge>>} */
  const bridges = new Map();
  return {
    /** A message event from a page. @param {{ id: string, postMessage(m: unknown): void }} source @param {any} data */
    message(source, data) {
      const m = data && data.vyreWs;
      if (!m || typeof m !== "object") return;
      let b = bridges.get(source.id);
      if (!b) {
        b = createWsBridge({
          open: path => { const c = o.conn(); if (!c) throw new Error("no connection"); return c.socket(path); },
          post: msg => { try { source.postMessage({ vyreWs: msg }); } catch { /* the page is gone */ } },
          allowed: PAGE_STREAMS, maxSockets: MAX_PAGE_SOCKETS,
        });
        bridges.set(source.id, b);
      }
      b.fromPage(m);
    },
    /** A page went away. @param {string} id */
    gone(id) { const b = bridges.get(id); if (b) { b.closeAll(); bridges.delete(id); } },
    /** Close the sockets of every page that is no longer open. @param {string[]} ids the pages that are */
    keep(ids) { for (const id of [...bridges.keys()]) if (!ids.includes(id)) this.gone(id); },
    get pages() { return bridges.size; },
  };
}
