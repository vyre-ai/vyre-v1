// Settings > Appearance, text size, density, language and reduce motion: each saved value changes the window, falls back to the default when unknown, and is kept for the next start.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPEARANCE, DENSITY_CSS, MOTION_CSS, TEXT_ZOOM, appearanceFrom, applyAppearance, applyIfAppearance, pageLanguage, rememberAppearance, restoreAppearance, withSetting } from "./appearance.ts";

function fakeDoc() {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  const head: { id: string; textContent: string }[] = [];
  const root = { style: { zoom: "", setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) }, setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
  const doc = { documentElement: root, getElementById: (id: string) => head.find((n) => n.id === id) ?? null, createElement: () => ({ id: "", textContent: "" }), head: { appendChild: (n: unknown) => void head.push(n as never), removeChild: (n: unknown) => void head.splice(head.indexOf(n as never), 1) } };
  return { doc, attrs, props, head, root };
}

test("the four settings read from their keys, and an unknown value is the default", () => {
  assert.deepEqual(appearanceFrom({}), DEFAULT_APPEARANCE);
  assert.deepEqual(appearanceFrom({ "appearance.text_size": "large", "appearance.density": "compact", "appearance.language": "en", "appearance.reduce_motion": true }), { textSize: "large", density: "compact", language: "en", reduceMotion: true });
  assert.deepEqual(appearanceFrom({ "appearance.text_size": "huge", "appearance.density": "tiny", "appearance.language": "", "appearance.reduce_motion": "yes" }), DEFAULT_APPEARANCE);
});

test("text size scales the page, density sets the row room, language sets the page language", () => {
  const f = fakeDoc();
  assert.equal(applyAppearance(appearanceFrom({ "appearance.text_size": "large", "appearance.density": "compact", "appearance.language": "en" }), f.doc as never, "de"), true);
  assert.equal(f.root.style.zoom, String(TEXT_ZOOM.large));
  assert.equal(f.head.find((n) => n.id === "vyre-density")?.textContent, DENSITY_CSS, "compact lowers the rows' least height");
  assert.equal(f.attrs.get("data-density"), "compact");
  assert.equal(f.attrs.get("lang"), "en", "a chosen language wins over the device");
  applyAppearance(DEFAULT_APPEARANCE, f.doc as never, "de");
  assert.equal(f.attrs.get("lang"), "de", "Same as this device follows the device");
  assert.equal(f.root.style.zoom, "1");
  assert.equal(f.head.some((n) => n.id === "vyre-density"), false, "comfortable adds no rule");
  assert.equal(pageLanguage(DEFAULT_APPEARANCE, undefined), "en");
});

test("reduce motion adds one style that switches transitions and animations off, and turning it off takes it away", () => {
  const f = fakeDoc();
  applyAppearance({ ...DEFAULT_APPEARANCE, reduceMotion: true }, f.doc as never, "en");
  applyAppearance({ ...DEFAULT_APPEARANCE, reduceMotion: true }, f.doc as never, "en");
  assert.equal(f.head.length, 1, "one style, however many times it is applied");
  assert.equal(f.head[0]!.textContent, MOTION_CSS);
  assert.equal(f.attrs.get("data-motion"), "reduce");
  applyAppearance(DEFAULT_APPEARANCE, f.doc as never, "en");
  assert.equal(f.head.length, 0);
  assert.equal(f.attrs.has("data-motion"), false);
});

test("without a document nothing happens and nothing throws", () => {
  assert.equal(applyAppearance(DEFAULT_APPEARANCE, undefined), applyAppearance(DEFAULT_APPEARANCE, undefined) && false);
});

test("a saved appearance setting applies and is kept; any other setting is left alone", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.deepEqual(applyIfAppearance("usr_irfad", "profile.title", DEFAULT_APPEARANCE, "x"), DEFAULT_APPEARANCE, "any other setting is left alone");
  const a = appearanceFrom({ "appearance.density": "compact" });
  rememberAppearance("usr_irfad", a, storage);
  assert.deepEqual(restoreAppearance("usr_irfad", storage), a, "kept for the next start");
  assert.deepEqual(restoreAppearance("usr_other", storage), DEFAULT_APPEARANCE);
  assert.deepEqual(restoreAppearance("usr_irfad", { getItem: () => "not json" }), DEFAULT_APPEARANCE);
});

test("one setting changes only its own part of the set", () => {
  const a = withSetting(DEFAULT_APPEARANCE, "appearance.text_size", "large");
  assert.deepEqual(a, { ...DEFAULT_APPEARANCE, textSize: "large" });
  assert.deepEqual(withSetting(a, "appearance.reduce_motion", true), { ...DEFAULT_APPEARANCE, textSize: "large", reduceMotion: true });
  assert.deepEqual(withSetting(a, "profile.title", "x"), a);
});
