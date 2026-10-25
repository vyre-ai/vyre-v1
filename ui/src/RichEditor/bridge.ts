// The WebView bridge of the RichEditor (ARCH 5.6, risk R6). On a phone the editor is TipTap inside a WebView. The page holds its own Y.Doc and
// Awareness; the app holds the document the sync module owns. The two keep each other current with small JSON messages that carry Yjs updates
// as base64. No DOM and no WebView import here: the app side passes `post` (webview.postMessage) and calls `receive` from onMessage, and the
// page side does the same with window.ReactNativeWebView.postMessage, so both ends run the same code and tests link two ends directly.

import * as Y from "yjs";
import { applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import type { Awareness } from "y-protocols/awareness";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + (i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : "=") + (i + 2 < bytes.length ? B64.charAt(n & 63) : "=");
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean.charAt(i)) << 18) | (B64.indexOf(clean.charAt(i + 1)) << 12) | ((i + 2 < clean.length ? B64.indexOf(clean.charAt(i + 2)) : 0) << 6) | (i + 3 < clean.length ? B64.indexOf(clean.charAt(i + 3)) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Messages between the app and the page. `hello` is the page saying it is ready; the app answers with the whole document. */
export type BridgeMessage =
  | { t: "hello" }
  | { t: "update"; b64: string }
  | { t: "awareness"; b64: string }
  | { t: "mode"; mode: "edit" | "suggest" | "read" }
  | { t: "placeholder"; text: string }
  | { t: "focus" }
  | { t: "error"; message: string };

export function encodeBridge(message: BridgeMessage): string {
  return JSON.stringify(message);
}

/** Parses what arrived; anything that is not a known message is dropped (null). */
export function decodeBridge(raw: unknown): BridgeMessage | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (value === null || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  switch (m["t"]) {
    case "hello": case "focus": return { t: m["t"] };
    case "update": case "awareness": return typeof m["b64"] === "string" ? { t: m["t"], b64: m["b64"] } : null;
    case "mode": return m["mode"] === "edit" || m["mode"] === "suggest" || m["mode"] === "read" ? { t: "mode", mode: m["mode"] } : null;
    case "placeholder": return typeof m["text"] === "string" ? { t: "placeholder", text: m["text"] } : null;
    case "error": return typeof m["message"] === "string" ? { t: "error", message: m["message"] } : null;
    default: return null;
  }
}

export interface BridgeEnd {
  /** Feed every message the other end posted. */
  receive(raw: unknown): void;
  /** Send the whole document and every cursor, for a page that just said hello or a doc that was replaced. */
  sendAll(): void;
  destroy(): void;
}

const FROM_BRIDGE = { bridge: true };

/** One end of the bridge. `isApp` ends answer hello with the full state; page ends send hello when they start. */
export function connectBridge(doc: Y.Doc, awareness: Awareness, post: (raw: string) => void, isApp: boolean): BridgeEnd {
  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === FROM_BRIDGE) return;
    post(encodeBridge({ t: "update", b64: toBase64(update) }));
  };
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin === FROM_BRIDGE) return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length > 0) post(encodeBridge({ t: "awareness", b64: toBase64(encodeAwarenessUpdate(awareness, changed)) }));
  };
  doc.on("update", onUpdate);
  awareness.on("update", onAwareness);
  const sendAll = (): void => {
    post(encodeBridge({ t: "update", b64: toBase64(Y.encodeStateAsUpdate(doc)) }));
    post(encodeBridge({ t: "awareness", b64: toBase64(encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()])) }));
  };
  if (!isApp) post(encodeBridge({ t: "hello" }));
  return {
    receive(raw) {
      const m = decodeBridge(raw);
      if (m === null) return;
      if (m.t === "hello") { if (isApp) sendAll(); return; }
      if (m.t === "update") Y.applyUpdate(doc, fromBase64(m.b64), FROM_BRIDGE);
      else if (m.t === "awareness") applyAwarenessUpdate(awareness, fromBase64(m.b64), FROM_BRIDGE);
    },
    sendAll,
    destroy() { doc.off("update", onUpdate); awareness.off("update", onAwareness); },
  };
}

/** The HTML the WebView loads. `bundle` is the editor bundle (TipTap with the Collaboration extensions, built into one script by the app build);
 *  the page runs it with the two colour tokens of the current skin so the editor matches the app before its first paint. */
export function bridgeHtml(bundle: string, tokens: { win: string; ink: string; accent: string }): string {
  const safe = bundle.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;background:${tokens.win};color:${tokens.ink};font:16px/1.55 -apple-system,system-ui,sans-serif}#editor{padding:12px 16px;min-height:100vh;outline:none}.ProseMirror{outline:none}a{color:${tokens.accent}}</style></head><body><div id="editor"></div><script>${safe}</script></body></html>`;
}
