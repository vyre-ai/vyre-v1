// The real shell mount: when the Space cannot be reached the shell draws its error panel, and Report a problem on it opens the sheet (it queues the report until the Space is back).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ShellHost } from "./ShellHost.tsx";
import type { StoredSession } from "./stored.ts";

test("with the Space unreachable, the shell's error panel Report a problem opens the report sheet", async () => {
  const win = Object.assign(new EventTarget(), { Image: class { set src(_v: string) { /* never loads */ } } });
  (globalThis as { window?: unknown }).window = win;
  const g = globalThis as { CustomEvent?: unknown; dispatchEvent?: unknown };
  const restore = installDom();
  g.dispatchEvent = (e: Event) => win.dispatchEvent(e);
  g.CustomEvent = class extends Event { detail: unknown; constructor(t: string, i: { detail: unknown }) { super(t); this.detail = i.detail; } };
  const stored = { baseUrl: "https://space.test", token: "t", personId: "p1", marker: "m", def: { spaceId: "spc_1", name: "Fresh Co", kind: "team", address: "space.test", role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: true, counts: {}, dots: {} } } as unknown as StoredSession;
  try {
    const root = await mount(createRoot, <ShellHost stored={stored} open={() => Promise.reject(new Error("down"))} onSignedOut={() => undefined} onHub={() => undefined} />);
    await flush(); await flush();
    assert.ok(find(root, "state-error"), `the error panel shows: ${textOf(root).slice(0, 120)}`);
    await press(find(root, "state-details"));
    assert.ok(find(root, "state-report"), "Report a problem is in Details");
    assert.equal(find(root, "report-disclosure"), null, "the sheet is closed first");
    await press(find(root, "state-report"));
    await flush();
    assert.ok(find(root, "report-disclosure"), "the report sheet is open over the shell");
  } finally { delete g.dispatchEvent; delete g.CustomEvent; delete (globalThis as { window?: unknown }).window; restore(); }
});
