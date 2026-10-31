// A vyre:// link on first launch: the doors are showing, the desktop shell delivers an invite, and Join opens for that address instead of the doors staying put.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, find, flush, press } from "../../onboarding/test-dom.ts";
import { SessionGate } from "./SessionGate.tsx";

// the halftone V animates on a canvas: the node suite has no frames, so a frame never comes
const g = globalThis as { requestAnimationFrame?: (f: (t: number) => void) => number; cancelAnimationFrame?: (id: number) => void };
g.requestAnimationFrame ??= () => 0;
g.cancelAnimationFrame ??= () => undefined;

// layout reads on the test renderer's nodes: a fixed box
const box = { x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 };
Object.defineProperty(Object.prototype, "getBoundingClientRect", { value: () => box, configurable: true, enumerable: false, writable: true });
Object.defineProperty(Object.prototype, "getContext", { value: () => null, configurable: true, enumerable: false, writable: true });

type Handler = (event: { payload: unknown }) => void;

function desktopShell(): { fire(payload: unknown): Promise<void> } {
  let handler: Handler | null = null;
  const info = { app: "Vyre", version: "1.0.0-rc.1", platform: "macos", arch: "aarch64", sidecar: { phase: "ready", url: null, version: "1.0.0-rc.1", restarts: 0, error: null } };
  Object.assign(globalThis, {
    __TAURI__: {
      core: { invoke: async (command: string) => (command === "desktop_info" ? info : command === "take_pending_link" ? null : null) },
      event: { listen: async (_name: string, h: Handler) => { handler = h; return () => { handler = null; }; } },
    },
  });
  return { fire: async (payload) => { assert.ok(handler, "the page is listening for links"); await act(async () => { handler!({ payload }); }); await flush(); } };
}

test("a join link delivered while the first-launch doors show opens Join for its address", async () => {
  installDom();
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => { asked.push(String(input)); throw new Error("offline in tests"); }) as typeof fetch;
  try {
    const shell = desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    assert.ok(find(root, "door-me"), "the doors are showing");
    await shell.fire({ action: "join", params: { address: "https://acme.example.com", code: "ABCD-EFGH", fp: "0123456789abcdef" } });
    await flush();
    assert.equal(find(root, "door-me"), null, "the doors are gone");
    assert.ok(find(root, "step-invite-loading") || find(root, "step-invite-error"), "Join is open");
    assert.ok(asked.some((u) => u.startsWith("https://acme.example.com/")), `the invite is looked up on its own address (${asked.join(", ") || "no call"})`);
  } finally {
    globalThis.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  }
});

test("the same link also wins over a half-filled entry (I was invited, address typed)", async () => {
  installDom();
  globalThis.fetch = (async () => { throw new Error("offline in tests"); }) as typeof fetch;
  try {
    const shell = desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    await press(find(root, "door-invited"));
    await flush();
    assert.ok(find(root, "space-entry-address"), "the entry is open");
    await shell.fire({ action: "join", params: { address: "https://acme.example.com", code: "ABCD-EFGH", fp: "0123456789abcdef" } });
    assert.equal(find(root, "space-entry-address"), null, "the entry is gone");
    assert.ok(find(root, "step-invite-loading") || find(root, "step-invite-error"), "Join is open");
  } finally {
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  }
});
