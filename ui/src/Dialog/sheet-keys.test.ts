// The keys of a full-size sheet that captures them (a terminal, a browser): Escape, Cmd+W and Tab belong to the surface, one chord leaves it, focus goes back to what opened the sheet.
import test from "node:test";
import assert from "node:assert/strict";
import { chordMatches, closeChord, returnFocus, watchSheetKeys } from "./sheet-keys.ts";

type Ev = {
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
};

test("the close chord is Cmd+Shift+. on a Mac and Ctrl+Alt+. elsewhere, and is told in plain words", () => {
  assert.deepEqual(closeChord(true), { chord: "Cmd+Shift+.", hint: "Cmd+Shift+. leaves the terminal" });
  assert.deepEqual(closeChord(false), { chord: "Ctrl+Alt+.", hint: "Ctrl+Alt+. leaves the terminal" });
  assert.equal(closeChord(true, "browser").hint, "Cmd+Shift+. leaves the browser");
});

test("a chord matches its modifiers exactly and the period by code or key", () => {
  const mac: Ev = { metaKey: true, shiftKey: true, key: ">", code: "Period" };
  assert.equal(chordMatches("Cmd+Shift+.", mac), true);
  assert.equal(chordMatches("Cmd+Shift+.", { ...mac, shiftKey: false }), false, "Shift missing");
  assert.equal(chordMatches("Cmd+Shift+.", { ...mac, altKey: true }), false, "an extra modifier");
  assert.equal(chordMatches("Cmd+Shift+.", { ...mac, code: "KeyA", key: "a" }), false);
  assert.equal(chordMatches("Ctrl+Alt+.", { ctrlKey: true, altKey: true, key: ".", code: "Period" }), true);
  assert.equal(chordMatches("Ctrl+Alt+.", { ctrlKey: true, key: ".", code: "Period" }), false);
});

function fake() {
  const listeners = new Map<string, (e: Ev) => void>();
  const log: string[] = [];
  const opener = { focus: () => log.push("opener focused"), isConnected: true };
  const doc = {
    activeElement: opener,
    addEventListener: (t: string, f: (e: Ev) => void) => listeners.set(t, f),
    removeEventListener: (t: string) => listeners.delete(t),
  };
  return { doc, listeners, log, opener };
}

test("the chord moves focus to Close; Escape, Cmd+W and Tab are left to the surface; the layer takes no key", () => {
  const f = fake();
  const stop = watchSheetKeys({ doc: f.doc, chord: "Cmd+Shift+.", focusClose: () => f.log.push("close focused") });
  let prevented = 0;
  const press = (e: Ev): void =>
    f.listeners.get("keydown")?.({ ...e, preventDefault: () => prevented++, stopPropagation: () => undefined });
  press({ key: "Escape" });
  press({ key: "w", metaKey: true });
  press({ key: "Tab" });
  assert.deepEqual(f.log, [], "nothing happened: the surface gets those keys");
  assert.equal(prevented, 0);
  press({ metaKey: true, shiftKey: true, key: ">", code: "Period" });
  assert.deepEqual(f.log, ["close focused"]);
  assert.equal(prevented, 1, "the chord is taken so the surface does not also see it");
  stop();
  assert.equal(f.listeners.size, 0, "listeners are removed");
});

test("closing puts focus back on what opened the sheet, if it is still there", () => {
  const f = fake();
  const stop = watchSheetKeys({ doc: f.doc, chord: "Cmd+Shift+.", focusClose: () => undefined });
  stop();
  assert.deepEqual(f.log, ["opener focused"]);
  const g = fake();
  g.opener.isConnected = false;
  watchSheetKeys({ doc: g.doc, chord: "Ctrl+Alt+.", focusClose: () => undefined })();
  assert.deepEqual(g.log, [], "an opener that has gone is not focused");
});

test("any sheet can give focus back: returnFocus remembers the opener and restores it once", () => {
  const f = fake();
  const back = returnFocus(f.doc);
  back();
  assert.deepEqual(f.log, ["opener focused"]);
  const none = returnFocus({ activeElement: null });
  none();
});
