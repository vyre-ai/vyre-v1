// @ts-check
// Opening an artifact link as the signed-in person (Chrome step 2). A link to an artifact in a Space the person is signed in to here, https://<space>/a/<id>, is not opened as the page would (where the
// web app may not be signed in): the Space's own session mints a single-use code (bridge op artifact.open) and the extension opens the address it gives in a tab. The extension reads and writes no page
// cookie, and only a link it recognises is taken over: anything else, a failure, or a Space that is not signed in loads as it always did.

import { pageOf } from "./match.js";

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
 * @param {{ ext: { tabs: { create(o: any): Promise<any> } }, bridge: { op(o: string, i?: Record<string, any>): Promise<any> }, store: { get(k: string[]): Promise<Record<string, any>> } }} deps
 */
export function createArtifacts({ ext, bridge, store }) {
  return {
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
      await ext.tabs.create({ url });
      return { handled: true };
    },
  };
}
