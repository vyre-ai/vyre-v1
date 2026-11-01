// System appearance follows the device while the app is open: a change of the device's light or dark repaints the root at once.
import test from "node:test";
import assert from "node:assert/strict";
import { sessionTheme } from "./space-theme.ts";

test("switching the device to dark repaints a System appearance without a reload, and back", () => {
  const g = globalThis as Record<string, unknown>;
  const had = { document: g["document"], matchMedia: g["matchMedia"], localStorage: g["localStorage"] };
  const attrs = new Map<string, string>();
  const listeners = new Set<(e: { matches: boolean }) => void>();
  g["document"] = { documentElement: { setAttribute: (n: string, v: string) => void attrs.set(n, v), style: { setProperty: () => undefined, removeProperty: () => undefined } } };
  g["matchMedia"] = () => ({ matches: false, addEventListener: (_: string, f: (e: { matches: boolean }) => void) => void listeners.add(f), removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => void listeners.delete(f) });
  g["localStorage"] = { getItem: () => null, setItem: () => undefined };
  try {
    const session = { personId: "usr_a", def: { spaceId: "spc_a", skinDefault: "system" }, baseUrl: "http://x", token: "t" } as never;
    const theme = sessionTheme(session, false)!;
    assert.equal(theme.current().mode, "light");
    assert.equal(listeners.size, 1, "one listener for the controller in use");
    for (const f of listeners) f({ matches: true });
    assert.equal(theme.current().mode, "dark");
    assert.equal(attrs.get("data-theme"), "dark", "the root is repainted");
    for (const f of listeners) f({ matches: false });
    assert.equal(theme.current().mode, "light");
    sessionTheme(session, false);
    assert.equal(listeners.size, 1, "a new controller replaces the listener, it does not pile up");
  } finally {
    for (const [k, v] of Object.entries(had)) { if (v === undefined) delete g[k]; else g[k] = v; }
  }
});
