// Opening a Settings page announces nothing (owner, 13 Nov 2026): Profile, just opened, showed "Saved  Undo" though the person had changed nothing. The cause was the first-open time zone seed
// going through the same path as a person's change. The seed still writes the zone; it says nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { act } from "react";
import { find, flush, installDom, textOf } from "../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { assertNoRawIds } from "../../../../../ui/src/testing/raw-ids.ts";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { createSampleSettings, northwind } from "./sample.ts";

// the saved line and the pages' polls hold a timer for seconds: a timer must not keep the test process alive after the last test
for (const k of ["setInterval", "setTimeout"] as const) { const orig = globalThis[k] as (...a: unknown[]) => { unref?: () => void }; (globalThis as Record<string, unknown>)[k] = (...a: unknown[]) => { const h = orig(...a); h?.unref?.(); return h; }; }

const NOTICE_IDS = ["saved", "saved-error", "undo"];

/** The device's zone, as the page reads it, for the length of a test. */
function deviceZoneIs(zone: string): () => void {
  const Orig = Intl.DateTimeFormat;
  const Make = Orig as unknown as new (...x: unknown[]) => Intl.DateTimeFormat;
  // callable with or without `new`, as the real one is; only the zone it reports is changed
  const Stub = function (...a: unknown[]): Intl.DateTimeFormat {
    const f = new Make(...a);
    const was = f.resolvedOptions.bind(f);
    f.resolvedOptions = () => ({ ...was(), timeZone: zone });
    return f;
  } as unknown as typeof Orig;
  Stub.prototype = Orig.prototype;
  Stub.supportedLocalesOf = Orig.supportedLocalesOf.bind(Orig);
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Stub;
  return () => { (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Orig; };
}

/** Draws the element and hands back what is drawn and a way to take it down before the globals go back (an unmount after that has no document to leave). */
async function draw(el: ReactElement): Promise<{ root: Node; down(): Promise<void> }> {
  const r = createRoot() as unknown as { render(e: ReactElement): void; unmount(): void; container: unknown };
  await act(async () => { r.render(el); });
  await flush();
  return { root: r.container as Node, down: async () => { await act(async () => { r.unmount(); }); } };
}

test("Profile, just opened, shows no Saved line; the first-open time zone seed still writes the zone", async () => {
  const restore = installDom();
  const unzone = deviceZoneIs("Asia/Karachi");
  let down: (() => Promise<void>) | null = null;
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>)["localStorage"] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    // a person whose time zone is still the registry default, so the page seeds it from this computer
    const s = createSampleSettings({ ...northwind, values: { ...northwind.values, "profile.timezone": "UTC" } });
    const drawn = await draw(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} initialPage="profile" /></SettingsDataProvider>);
    down = drawn.down;
    await flush(); await flush();
    const seeded = s.calls.filter((c) => c.cap === "settings.set" && (c.input as { key?: string }).key === "profile.timezone");
    assert.equal(seeded.length, 1, "the zone is seeded once");
    assert.deepEqual((seeded[0]!.input as { value?: string }).value, "Asia/Karachi");
    for (const id of NOTICE_IDS) assert.ok(find(drawn.root, id) === null, `no "${id}" notice on a page nobody has changed`);   // not assert.equal: a failing one would print the whole tree
    assert.doesNotMatch(textOf(drawn.root), /Saved|Undo/);
    assert.match(textOf(drawn.root), /Karachi/, "the Time zone row shows the seeded zone");
    assertNoRawIds(drawn.root, "Settings, Profile");
  } finally { await down?.(); delete (globalThis as Record<string, unknown>)["localStorage"]; unzone(); restore(); }
});
