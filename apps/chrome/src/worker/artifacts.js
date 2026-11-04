// @ts-check
// Opening an artifact link as the signed-in person (Chrome step 2). A link to an artifact in a Space the person is signed in to here, https://<space>/a/<id>, is not opened as the page would (where the
// web app may not be signed in): the Space's own session mints a single-use code (bridge op artifact.open) and the extension opens the address it gives in a tab. The extension reads and writes no page
// cookie, and only a link it recognises is taken over: anything else, a failure, or a Space that is not signed in loads as it always did.

import { pageOf } from "./match.js";
import { maskedShot } from "./shot.js";

/** The artifact host a Space serves its artifacts from: <name>-a.vyre.run for one reached through the relay, a.<address> for one served directly (a.localhost on this computer). @param {string} webUrl */
export function artifactHostOf(webUrl) {
  let u;
  try { u = new URL(webUrl); } catch { return null; }
  if (u.hostname.endsWith(".vyre.run")) return `${u.hostname.slice(0, -".vyre.run".length)}-a.vyre.run`;
  if (u.hostname === "localhost" || u.hostname.endsWith(".localhost")) return `a.localhost${u.port ? `:${u.port}` : ""}`;
  return `a.${u.host}`;
}

/** The artifact a tab is showing, when its address is on the artifact host of a Space the person is signed in to: https://<artifact host>/<sit_id>/... @param {string} href @param {string[]} spaces the Spaces' web addresses */
export function artifactOfTab(href, spaces) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (!spaces.some((w) => artifactHostOf(w) === u.host)) return null;
  const m = /^\/(sit_[a-z0-9]{1,64})(\/|$)/.exec(u.pathname);
  return m ? (m[1] ?? null) : null;
}

/** How long one artifact is left alone after its picture was tried. */
export const THUMB_RETRY_MS = 30_000;

/** The largest picture the Space keeps (characters of its data URL). */
export const THUMB_MAX = 60_000;
/** How long after the page loads the picture is taken, so it shows the page and not its loading. */
export const THUMB_AFTER_MS = 1000;

/** The address a link points at when it is an artifact link, else null. @param {unknown} href */
export function artifactLink(href) {
  const p = pageOf(typeof href === "string" ? href : "");
  if (!p || !(p.secure || p.local)) return null;
  let u;
  try { u = new URL(String(href)); } catch { return null; }
  const m = /^\/a\/(sit_[a-z0-9]+)\/?$/.exec(u.pathname);
  return m ? { host: u.host, id: m[1] ?? "" } : null;
}

/**
 * @param {{ ext: { tabs: { create(o: any): Promise<any>, get?(id: number): Promise<any>, captureVisibleTab?(w: number, o: any): Promise<string>, onUpdated?: { addListener(f: (id: number, info: any) => void): void, removeListener(f: (id: number, info: any) => void): void } }, scripting?: any }, bridge: { op(o: string, i?: Record<string, any>): Promise<any> }, store: { get(k: string[]): Promise<Record<string, any>> }, wait?: (ms: number) => Promise<void>, paint?: any }} deps
 */
export function createArtifacts({ ext, bridge, store, wait = (ms) => new Promise((r) => setTimeout(r, ms)), paint }) {
  /**
   * The first time an artifact opens in a tab (and after it changes), keep a small picture of it. Once, at load plus about a second; scaled to 480 px wide webp under 60 KB, with password and card fields
   * blacked out first (maskedShot); only the tab the person sees. The Space keeps it only when there is none or the artifact changed, so a repeat is harmless. Nothing is read from the page but the boxes.
   * @param {number} tabId @param {string} artifactId
   */
  /** @type {Map<string, number>} */
  const tried = new Map();
  async function thumb(tabId, artifactId) {
    if (!/^sit_[a-z0-9]+$/.test(artifactId)) return { set: false, why: "no_artifact" };
    const now = Date.now();
    if ((tried.get(artifactId) ?? 0) > now - THUMB_RETRY_MS) return { set: false, why: "recent" };
    tried.set(artifactId, now);
    await wait(THUMB_AFTER_MS);
    let shot = null;
    for (const quality of [0.7, 0.5, 0.35]) {
      try { shot = await maskedShot(/** @type {any} */ (ext), tabId, { maxW: 480, quality, type: "image/webp", ...(paint ? { paint } : {}) }); } catch { shot = null; }
      if (!shot) return { set: false, why: "not_visible" };
      if (shot.dataUrl.length <= THUMB_MAX) break;
      shot = null;
    }
    if (!shot) return { set: false, why: "too_large" };
    try { const out = await bridge.op("artifact.thumb", { artifactId, thumb: shot.dataUrl }); return { set: !!(out && out.set) }; } catch { return { set: false, why: "error" }; }
  }
  /** Once the tab says it has loaded, take its picture. @param {number} tabId @param {string} artifactId */
  function thumbWhenLoaded(tabId, artifactId) {
    const on = ext.tabs.onUpdated;
    if (!on) return;
    /** @type {(id: number, info: any) => void} */
    const f = (id, info) => { if (id !== tabId || !info || info.status !== "complete") return; on.removeListener(f); void thumb(tabId, artifactId); };
    on.addListener(f);
  }
  /** Any tab that finishes loading an artifact on a signed-in Space's artifact host gets its picture taken (the person opened it themselves, by the plain link). The Space decides whether to keep it. */
  function watchTabs() {
    const on = ext.tabs.onUpdated;
    if (!on) return;
    on.addListener((id, info) => {
      if (!info || info.status !== "complete") return;
      void (async () => {
        let tab;
        try { tab = ext.tabs.get ? await ext.tabs.get(id) : null; } catch { return; }
        if (!tab || typeof tab.url !== "string") return;
        const kept = await store.get(["spaces"]);
        const spaces = (Array.isArray(kept["spaces"]) ? kept["spaces"] : []).map((x) => String(x && x.webUrl));
        const aid = artifactOfTab(tab.url, spaces);
        if (aid) await thumb(id, aid);
      })();
    });
  }
  return {
    thumb,
    watchTabs,
    /** The hosts of the Spaces the person is signed in to here, for the content script to know which links are ours. */
    async hosts() {
      const kept = await store.get(["spaces"]);
      const out = [];
      for (const s of Array.isArray(kept["spaces"]) ? kept["spaces"] : []) { try { out.push(new URL(String(s.webUrl)).host); } catch { /* not an address */ } }
      return out;
    },
    /**
     * Open an artifact: by its link, or by its id in the active Space (a card in the side panel). `{ handled: false }` means the caller lets the link load as it was going to.
     * @param {{ href?: string, id?: string }} what
     */
    async open(what) {
      const link = what.href ? artifactLink(what.href) : null;
      if (what.href && !link) return { handled: false, why: "not_artifact" };
      let out;
      try { out = await bridge.op("artifact.open", link ? { url: what.href } : { artifactId: String(what.id ?? "") }); } catch (e) {
        const code = e && typeof e === "object" && "code" in e ? String(/** @type {any} */ (e).code) : "";
        return { handled: false, why: code || "error" };
      }
      const url = out && typeof out.url === "string" ? out.url : "";
      if (!pageOf(url)) return { handled: false, why: "bad_address" };
      const tab = await ext.tabs.create({ url });
      const aid = link ? link.id : String(what.id ?? "");
      if (tab && typeof tab.id === "number" && aid) thumbWhenLoaded(tab.id, aid);
      return { handled: true };
    },
  };
}
