// ui/theme/css: rules go into the element's sheet, not its text.
import test from "node:test";
import assert from "node:assert/strict";
import { injectCss, splitRules } from "./css.ts";

test("splitRules keeps blocks whole, including an @media", () => {
  assert.deepEqual(splitRules(".a{color:red}.b{x:y}@media (max-width:1px){.c{d:e}.f{g:h}}"), [".a{color:red}", ".b{x:y}", "@media (max-width:1px){.c{d:e}.f{g:h}}"]);
});

function fakeDoc(withSheet: boolean) {
  const rules: string[] = [];
  const els = new Map<string, { id: string; textContent: string | null; sheet: unknown }>();
  const doc = {
    head: { appendChild: (n: { id: string }) => { els.set(n.id, n as never); } },
    getElementById: (id: string) => els.get(id) ?? null,
    createElement: () => ({ id: "", textContent: null as string | null, sheet: withSheet ? { cssRules: { get length() { return rules.length; } }, insertRule: (r: string) => rules.push(r) } : null }),
  };
  return { doc, rules, els };
}

test("injectCss inserts each rule through the sheet and leaves the tag's text empty", () => {
  const { doc, rules, els } = fakeDoc(true);
  assert.equal(injectCss(doc, "x", ".a{b:c}.d{e:f}"), true);
  assert.deepEqual(rules, [".a{b:c}", ".d{e:f}"]);
  assert.equal(els.get("x")!.textContent, null);
  assert.equal(injectCss(doc, "x", ".a{b:c}"), false, "once per id");
});

test("without a sheet it falls back to the text, and with no document it does nothing", () => {
  const { doc, els } = fakeDoc(false);
  assert.equal(injectCss(doc, "y", ".a{b:c}"), true);
  assert.equal(els.get("y")!.textContent, ".a{b:c}");
  assert.equal(injectCss(undefined, "z", ".a{b:c}"), false);
});
