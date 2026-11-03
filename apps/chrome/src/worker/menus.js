// @ts-check
// The right-click items (prototype "Save from Chrome", "Watch a page", "Show it once"): Save to Vyre Notes, Ask Vyre about this, Watch this with Vyre, Show Vyre how.
// With text selected, Save and Ask are about the selection; otherwise about the page. Chrome puts an extension's items under its name when there are several.
// Each click is a user gesture, so Ask, Watch and Show may open the side panel; the panel is told which view to show.

export const MENU = Object.freeze([
  { id: "vyre-save-sel", title: "Save to Vyre Notes", contexts: ["selection"] },
  { id: "vyre-save-page", title: "Save page to Vyre Notes", contexts: ["page", "link", "image", "frame"] },
  { id: "vyre-ask-sel", title: "Ask Vyre about this", contexts: ["selection"] },
  { id: "vyre-ask-page", title: "Ask Vyre about this page", contexts: ["page", "link", "image", "frame"] },
  { id: "vyre-watch", title: "Watch this with Vyre", contexts: ["page", "selection", "link", "image", "frame"] },
  { id: "vyre-show", title: "Show Vyre how", contexts: ["page", "selection", "link", "image", "frame"] },
]);
const PAGES = ["https://*/*", "http://*/*"];

/** What a click means. Pure. @param {string} id @param {{ selectionText?: string }} info */
export function intent(id, info) {
  const sel = String(info.selectionText || "").trim();
  switch (id) {
    case "vyre-save-sel": return { do: "clip", selection: sel };
    case "vyre-save-page": return { do: "clip", selection: "" };
    case "vyre-ask-sel": return { do: "ask", selection: sel };
    case "vyre-ask-page": return { do: "ask", selection: "" };
    case "vyre-watch": return { do: "panel", view: "watch" };
    case "vyre-show": return { do: "panel", view: "show" };
    default: return null;
  }
}

/**
 * @param {{ ext: any, notes: { clip(tab: any, sel?: string): Promise<any> }, panel: { ask(tab: any, t: string): Promise<boolean>, tell(m: any, w?: number | null): void }, views: Map<number, string>, privacy: { of(tab: any): Promise<any> } }} deps
 */
export function createMenus({ ext, notes, panel, views, privacy }) {
  /** Open the panel for a tab's window and show a view (also remembered, for a panel that is only now loading). @param {any} tab @param {string} view */
  async function openPanel(tab, view) {
    views.set(tab.windowId, view);
    try { if (ext.sidePanel && ext.sidePanel.open) await ext.sidePanel.open({ windowId: tab.windowId }); } catch { /* not from a gesture: the view waits for the next open */ }
    panel.tell({ type: "view", view }, tab.windowId);
  }
  return {
    openPanel,
    install() {
      if (!ext.contextMenus) return;
      ext.contextMenus.removeAll(() => {
        for (const m of MENU) ext.contextMenus.create({ id: m.id, title: m.title, contexts: m.contexts, documentUrlPatterns: PAGES });
      });
    },
    /** @param {{ menuItemId: string, selectionText?: string }} info @param {any} tab */
    async clicked(info, tab) {
      if (!tab || tab.id === undefined || tab.incognito) return null;
      const it = intent(String(info.menuItemId), info);
      if (!it) return null;
      if (it.do === "clip") { try { return await notes.clip(tab, it.selection); } catch { return null; } }
      // Open first, before anything awaits: Chrome lets the panel open only while the click is still the user's gesture.
      const view = it.do === "ask" ? "chat" : String(it.view);
      views.set(tab.windowId, view);
      const opening = ext.sidePanel && ext.sidePanel.open ? Promise.resolve(ext.sidePanel.open({ windowId: tab.windowId })).catch(() => {}) : Promise.resolve();
      if (it.do === "ask" && it.selection && (await privacy.of(tab)).read) await panel.ask(tab, it.selection);
      await opening;
      panel.tell({ type: "view", view }, tab.windowId);
      return it.do === "ask" ? { asked: true } : { view };
    },
  };
}
