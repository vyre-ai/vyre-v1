// Polish audit X2: the phone's Console screen (the line that it opens on a computer) marks the app usable at once, so the launch frame leaves instead of covering it for eight seconds.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount } from "../../../../../ui/src/testing/dom.ts";
import { DesktopOnly } from "./DesktopOnly.tsx";

test("drawing the desktop-only screen marks app.usable", async () => {
  const restore = installDom();
  const g = globalThis as unknown as { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void; dispatchEvent?: (e: { type: string }) => boolean; Event?: new (t: string) => { type: string } };
  const seen: string[] = [], listeners = new Set<() => void>();
  const keep = { a: g.addEventListener, r: g.removeEventListener, d: g.dispatchEvent, e: g.Event };
  g.addEventListener = (t, f) => { if (t === "vyre:usable") listeners.add(f); }; g.removeEventListener = (_t, f) => { listeners.delete(f); };
  g.Event = class { constructor(public type: string) {} }; g.dispatchEvent = (e) => { seen.push(e.type); for (const f of listeners) f(); return true; };
  try {
    await mount(createRoot as never, <DesktopOnly line="The Console opens on a computer." />);
    assert.ok(seen.includes("vyre:usable"), "the screen says the app is usable");
  } finally { g.addEventListener = keep.a; g.removeEventListener = keep.r; g.dispatchEvent = keep.d; g.Event = keep.e; restore(); }
});
