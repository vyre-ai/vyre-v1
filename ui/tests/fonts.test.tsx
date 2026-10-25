// @reads /apps/app/app/+html.tsx
// @reads /scripts/shots/app/app/+html.tsx
// One root font (P-UI_08): the rule reaches the app root, a deep node through inheritance, an overlay menu and a canvas label host, on the skin's tokens.
// The browser-computed families on real screens are the shots; this file proves the rule text and its install.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MONO_HOSTS, MONO_VAR, SANS_HOSTS, SANS_VAR, installRootFont, rootFontCss } from "../src/theme/fonts.ts";

/** Which family a node gets: the first rule whose selector list names it (rules in the sheet order, last match wins, as CSS). */
function familyFor(selector: string, css = rootFontCss()): string | null {
  let family: string | null = null;
  for (const m of css.matchAll(/([^{}]+)\{font-family:([^}]+)\}/g)) {
    if (m[1]!.split(",").includes(selector)) family = m[2]!;
  }
  return family;
}

test("the app root and the document take the skin's sans token", () => {
  for (const s of ["html", "body", "#root", "[data-vyre-root]"]) assert.equal(familyFor(s), SANS_VAR);
  assert.match(SANS_VAR, /^var\(--ui, "Inter"/);
});

test("an overlay menu, dialog, tooltip and portal root take the sans token", () => {
  for (const s of ["[role=menu]", "[role=dialog]", "[role=listbox]", "[role=tooltip]", "[data-overlay-root]", "[data-portal]"]) assert.equal(familyFor(s), SANS_VAR, s);
});

test("a canvas label host (SVG text, label layer and its children) takes the sans token, so map and timeline labels never fall to serif", () => {
  for (const s of ["svg text", "[data-canvas-labels]", "[data-canvas-labels] *"]) assert.equal(familyFor(s), SANS_VAR, s);
});

test("form controls inherit, so the Find input matches its screen", () => {
  for (const s of ["input", "textarea", "select", "button"]) assert.equal(familyFor(s), "inherit");
});

test("code, keys and data-mono nodes take the mono token, including their children", () => {
  for (const s of MONO_HOSTS) assert.equal(familyFor(s), MONO_VAR, s);
  assert.equal(familyFor("pre *"), MONO_VAR);
  assert.match(MONO_VAR, /JetBrains Mono/);
});

test("every host has an explicit family and none is serif", () => {
  for (const s of [...SANS_HOSTS, ...MONO_HOSTS]) assert.ok(familyFor(s), `${s} has a family`);
  assert.doesNotMatch(rootFontCss(), /serif(?!\b)|Times|Georgia/);
  assert.equal(/(^|[ ,])serif\b/.test(rootFontCss().replace(/sans-serif/g, "")), false);
});

test("installRootFont adds one style element and is idempotent", () => {
  const els: { id: string; textContent: string | null }[] = [];
  const doc = {
    head: { appendChild: (n: unknown) => void els.push(n as { id: string; textContent: string | null }) },
    getElementById: (id: string) => els.find((e) => e.id === id) ?? null,
    createElement: () => ({ id: "", textContent: null as string | null }),
  };
  assert.equal(installRootFont(doc), true);
  assert.equal(installRootFont(doc), false);
  assert.equal(els.length, 1);
  assert.equal(els[0]!.textContent, rootFontCss());
  assert.equal(installRootFont(undefined), false);
});

test("the app document and the shots document both put the root font rule in the head", () => {
  for (const rel of ["../../apps/app/app/+html.tsx", "../../scripts/shots/app/app/+html.tsx"]) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.match(src, /import \{ rootFontCss \} from "@vyre\/ui\/src\/theme\/fonts\.ts"/, `${rel} imports the rule`);
    assert.match(src, /<style id="vyre-root-font" dangerouslySetInnerHTML=\{\{ __html: rootFontCss\(\) \}\} \/>/, `${rel} renders it`);
    assert.ok(src.indexOf("vyre-root-font") < src.indexOf("{headNodes}"), `${rel}: before the bundle's own styles`);
  }
});
