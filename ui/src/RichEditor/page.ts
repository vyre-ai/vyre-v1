// The page the phone's WebView runs (ARCH 5.6, risk R6). The app build bundles this file with TipTap into one script and gives it to
// bridgeHtml(). It builds a Y.Doc and an Awareness, mounts TipTap with the Collaboration and CollaborationCursor extensions on them, and talks to
// the app through the bridge, so the editor on the phone is the same editor as on the web and both converge through the same Yjs document.

import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { connectBridge, decodeBridge } from "./bridge.ts";

interface PageWindow {
  ReactNativeWebView?: { postMessage(raw: string): void };
  addEventListener(type: "message", handler: (e: { data: unknown }) => void): void;
  document: { addEventListener(type: "message", handler: (e: { data: unknown }) => void): void; getElementById(id: string): unknown };
}

export interface PageOptions {
  user?: { name: string; color: string };
}

/** Starts the editor in the page. Returns a function that stops it. */
export async function startEditorPage(win: PageWindow, options: PageOptions = {}): Promise<() => void> {
  const post = (raw: string): void => win.ReactNativeWebView?.postMessage(raw);
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", options.user ?? { name: "You", color: "#4c6ef5" });
  const end = connectBridge(doc, awareness, post, false);
  const onMessage = (e: { data: unknown }): void => end.receive(e.data);
  win.addEventListener("message", onMessage);
  win.document.addEventListener("message", onMessage);

  const [{ Editor }, starterKit, collaboration, cursor] = await Promise.all([
    import("@tiptap/core"),
    import("@tiptap/starter-kit"),
    import("@tiptap/extension-collaboration"),
    import("@tiptap/extension-collaboration-cursor"),
  ]);
  const editor = new Editor({
    element: win.document.getElementById("editor") as never,
    extensions: [
      starterKit.default.configure({ history: false }),
      collaboration.default.configure({ document: doc }),
      cursor.default.configure({ provider: { awareness }, user: options.user ?? { name: "You", color: "#4c6ef5" } }),
    ],
    editable: true,
  });
  const onModeMessage = (e: { data: unknown }): void => {
    const m = decodeBridge(e.data);
    if (m !== null && m.t === "mode") editor.setEditable(m.mode !== "read");
  };
  win.addEventListener("message", onModeMessage);
  win.document.addEventListener("message", onModeMessage);
  return () => { end.destroy(); editor.destroy(); awareness.destroy(); doc.destroy(); };
}
