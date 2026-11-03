// @ts-check
// Open an artifact from Chrome. The app mints the one-time code as the signed-in person (bridge op artifact.open) and the tab opens https://<artifact host>/x/<code>, which sets that host's own
// cookie and lands on the clean address. With no artifact host, or nobody signed in here, the tab opens the Space's plain /a/<id>: the web app asks for its own sign-in and then continues.
// No token is ever put in a URL by this file.

import { BridgeFailure } from "./protocol.js";

/** @param {{ ext: any, bridge: any, store: any }} deps */
export function createArtifacts({ ext, bridge, store }) {
  /** The active Space's web address, for the plain /a/<id> when the app cannot mint a code. @param {string} id */
  async function plainAddress(id) {
    const kept = await store.get(["spaces", "activeSpace"]);
    const sp = (kept["spaces"] ?? []).find((/** @type {any} */ s) => s.id === kept["activeSpace"]) ?? (kept["spaces"] ?? [])[0];
    const web = sp && /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(sp.webUrl) ? new URL(sp.webUrl).origin : null;
    return web ? `${web}/a/${encodeURIComponent(id)}` : null;
  }
  return {
    /** @param {string} artifactId @returns {Promise<{ opened: "host" | "web" }>} */
    async open(artifactId) {
      const id = String(artifactId || "");
      if (!/^sit_[a-z0-9_]{1,76}$/.test(id)) throw new BridgeFailure("bad_input", "That is not an artifact.");
      /** @type {any} */
      let out = null;
      try { out = await bridge.op("artifact.open", { artifactId: id }); } catch (e) {
        if (!(e instanceof BridgeFailure) || !["no_host", "signed_out"].includes(e.code)) throw e;
      }
      const url = out && typeof out.url === "string" ? out.url : await plainAddress(id);
      if (!url) throw new BridgeFailure("no_host", "Open the Vyre app and try again.");
      // a token never rides in an address: only the one-time code path or the plain address is opened
      if (/\/a\/[^/]+\/k\//.test(url)) throw new BridgeFailure("error", "That address carries a token, so it was not opened.");
      await ext.tabs.create({ url });
      return { opened: out && out.plain === false ? "host" : "web" };
    },
  };
}
