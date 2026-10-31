// The static page is drawn with no window, so the first client render must be the same frame whatever this window is (React #418 otherwise): the desktop app, a Mac, a phone width and a
// plain browser all draw the same first frame, and the window is read after mount.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { SessionGate } from "./SessionGate.tsx";

const frame = (env: { tauri?: boolean; width?: number }): string => {
  const g = globalThis as { __TAURI__?: unknown; innerWidth?: number };
  const had = { t: g.__TAURI__, w: g.innerWidth };
  if (env.tauri) g.__TAURI__ = { core: { invoke: async () => undefined } }; else delete g.__TAURI__;
  if (env.width !== undefined) g.innerWidth = env.width; else delete g.innerWidth;
  try { return renderToString(<SessionGate baseUrl={null} />); }
  finally { if (had.t === undefined) delete g.__TAURI__; else g.__TAURI__ = had.t; if (had.w === undefined) delete g.innerWidth; else g.innerWidth = had.w; }
};

test("the first frame is the same in a browser, the desktop app and at a phone width", () => {
  const plain = frame({});
  assert.ok(plain.length > 200, "something is drawn");
  assert.equal(frame({ tauri: true }), plain, "the desktop app draws the page's own first frame");
  assert.equal(frame({ width: 390 }), plain, "a phone width draws the page's own first frame");
  assert.equal(frame({ tauri: true, width: 390 }), plain);
});
