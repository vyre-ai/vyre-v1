// @ts-check
// Save to Notes from Chrome (prototype "Notes > Save from Chrome"): the selection bubble's Save to Notes, and the right-click "Save to Vyre Notes" / "Save page to Vyre Notes".
// The clip goes through lane l-notes' notes.clip capability as the person: the address, the title, the selection when there is one, and a masked screenshot. A small card in
// the top right of the page confirms it, with Open (the note in Vyre). Nothing is clipped from a site that is never sent, or in incognito.

import { maskedShot } from "./shot.js";
import { BridgeFailure } from "./protocol.js";

/**
 * Run in the page: the confirmation card, top right, in a closed shadow root. `o.open` labels the button; clicking it messages the worker with the note id.
 * Gone after 6 seconds or on its close button. Self-contained.
 * @param {{ title: string, detail: string, thumb: string | null, noteId: string | null, error?: boolean }} o
 */
export function showToast(o) {
  const g = /** @type {any} */ (globalThis);
  const doc = g.document;
  const KEY = Symbol.for("vyre.toast");
  if (g[KEY]) { try { g[KEY].remove(); } catch { /* gone */ } }
  const host = doc.createElement("div");
  host.setAttribute("data-vyre-toast", "");
  host.style.cssText = "all:initial;position:fixed;top:14px;right:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const dark = g.matchMedia && g.matchMedia("(prefers-color-scheme: dark)").matches;
  const st = doc.createElement("style");
  st.textContent = `.t{display:flex;align-items:center;gap:10px;width:300px;box-sizing:border-box;padding:10px;border-radius:12px;font:13px/18px Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    background:${dark ? "#201E29" : "#fff"};color:${dark ? "#F2F0F7" : "#17141F"};box-shadow:0 0 0 1px ${dark ? "rgba(255,255,255,.08)" : "rgba(23,20,31,.07)"},0 10px 24px -8px rgba(23,20,31,.2),0 2px 6px rgba(23,20,31,.06)}
    .th{width:54px;height:38px;border-radius:6px;object-fit:cover;flex:none;box-shadow:0 0 0 1px rgba(23,20,31,.13)}
    .g{flex:1;min-width:0}.a{font-weight:500;font-size:12px;display:flex;gap:6px;align-items:center}.b{font-size:11px;line-height:14px;color:${dark ? "#928DA2" : "#6A6578"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    button{font:500 12.5px/1 inherit;font-family:inherit;color:inherit;background:${dark ? "#201E29" : "#fff"};border:0;border-radius:7px;height:28px;padding:0 10px;box-shadow:inset 0 0 0 1px ${dark ? "rgba(255,255,255,.12)" : "rgba(23,20,31,.13)"};cursor:pointer}
    button.x{width:24px;padding:0;box-shadow:none;color:${dark ? "#928DA2" : "#6A6578"}}.err .a{color:${dark ? "#FF6F85" : "#CC2A4A"}}`;
  const box = doc.createElement("div");
  box.className = o.error ? "t err" : "t";
  box.setAttribute("role", "status");
  if (o.thumb) { const img = doc.createElement("img"); img.className = "th"; img.src = o.thumb; img.alt = ""; box.append(img); }
  const txt = doc.createElement("div"); txt.className = "g";
  const a = doc.createElement("div"); a.className = "a"; a.textContent = o.title;
  const b = doc.createElement("div"); b.className = "b"; b.textContent = o.detail;
  txt.append(a, b); box.append(txt);
  if (o.noteId) {
    const open = doc.createElement("button"); open.textContent = "Open";
    open.addEventListener("click", () => { try { g.chrome.runtime.sendMessage({ type: "vyre.openNote", noteId: o.noteId }); } catch { /* reloaded */ } host.remove(); });
    box.append(open);
  }
  const x = doc.createElement("button"); x.className = "x"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "✕";
  x.addEventListener("click", () => host.remove());
  box.append(x);
  root.append(st, box);
  doc.documentElement.append(host);
  g[KEY] = host;
  g.setTimeout(() => { if (host.isConnected) host.remove(); }, 6000);
  return true;
}

/**
 * @param {{ ext: any, bridge: { invoke(c: string, i?: any): Promise<any>, op(o: string, i?: any): Promise<any> }, privacy: { of(tab: any): Promise<any> }, context: { read(tabId: number): Promise<any> } }} deps
 */
export function createNotes({ ext, bridge, privacy, context }) {
  /** @param {number} tabId @param {Parameters<typeof showToast>[0]} o */
  const toast = async (tabId, o) => { try { await ext.scripting.executeScript({ target: { tabId }, func: showToast, args: [o] }); } catch { /* a page we may not draw on */ } };

  return {
    toast,
    /**
     * Clip a page, or a selection on it. `selection` is the text the person highlighted (from the bubble or the menu); empty clips the page.
     * @param {any} tab @param {string} [selection]
     */
    async clip(tab, selection = "") {
      const may = await privacy.of(tab);
      if (may.why === "incognito") throw new BridgeFailure("incognito", "");
      if (!may.read) {
        if (may.why === "never") await toast(tab.id, { title: "Not saved", detail: "This site is never sent to Vyre.", thumb: null, noteId: null, error: true });
        throw new BridgeFailure(may.why === "never" ? "never_site" : "no_page", "");
      }
      const sel = String(selection || "").trim().slice(0, 4000);
      const shot = await maskedShot(ext, tab.id, { maxW: 1280, quality: 0.8 });
      const page = await context.read(tab.id);
      /** @type {any} */
      let out;
      try {
        out = await bridge.invoke("notes.clip", {
          url: String(tab.url), title: String((page && page.title) || tab.title || "").slice(0, 300), ...(sel ? { selection: sel } : {}),
          ...(shot ? { screenshot: shot.dataUrl } : {}), source: "chrome",
        });
      } catch (e) {
        await toast(tab.id, { title: "Not saved", detail: e instanceof BridgeFailure && e.code === "no_host" ? "Open the Vyre app and try again." : "Vyre could not save this. Try again.", thumb: null, noteId: null, error: true });
        throw e;
      }
      const noteId = out && (out.noteId || (out.note && out.note.noteId)) ? String(out.noteId || out.note.noteId) : null;
      const what = sel ? (shot ? "Selection, screenshot and link" : "Selection and link") : (shot ? "Screenshot and link" : "Link and page text");
      await toast(tab.id, { title: "Saved to Notes", detail: `${what} · private`, thumb: shot ? shot.dataUrl : null, noteId });
      return { noteId, selection: Boolean(sel), screenshot: Boolean(shot) };
    },
  };
}
