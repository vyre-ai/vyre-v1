// Choosing a skin in Settings > Appearance applies it to the window: the root attributes follow the chosen skin at once.
import test from "node:test";
import assert from "node:assert/strict";
import { applySkinToWindow } from "./settings-skin.ts";

test("applySkinToWindow sets the skin on the document root: a dark skin makes the window dark, and System follows the device", () => {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  const g = globalThis as { document?: unknown; matchMedia?: unknown };
  const before = { document: g.document, matchMedia: g.matchMedia };
  g.document = { documentElement: { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => void attrs.set(k, v), style: { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) } } };
  g.matchMedia = () => ({ matches: false });
  try {
    const rt = { me: { id: "usr_a" }, space: { id: "spc_a" } } as never;
    assert.equal(applySkinToWindow(rt, "graphite"), true);
    assert.equal(attrs.get("data-mode"), "dark", "Graphite is a dark skin");
    assert.deepEqual([attrs.get("data-skin"), attrs.get("data-theme")], ["graphite", "dark"]);
    applySkinToWindow(rt, "paper");
    assert.equal(attrs.get("data-mode"), "light", "Paper is a light skin");
    applySkinToWindow(rt, "system");
    assert.equal(attrs.get("data-mode"), "light", "System on a light device is light");
  } finally { g.document = before.document; g.matchMedia = before.matchMedia; }
  g.document = undefined;
  assert.equal(applySkinToWindow({ me: { id: "u" }, space: { id: "s" } } as never, "graphite"), false, "no window, nothing applied");
  g.document = before.document;
});
