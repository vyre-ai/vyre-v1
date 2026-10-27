import test from "node:test";
import assert from "node:assert/strict";
import { appliesNoColorMix, checkNoColorMix } from "./no-color-mix.ts";

const file = "apps/app/src/places/inbox/softphone/pill.tsx";

test("no-color-mix fails color-mix in a style object", () => {
  const src = `const s = StyleSheet.create({\n  pill: { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)" as string },\n});\n`;
  const hits = checkNoColorMix(file, src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "no-color-mix");
  assert.equal(hits[0].line, 2);
  assert.match(hits[0].message, /backgroundImage/);
});

test("no-color-mix allows the gradient layer, a marked DOM string and prose", () => {
  const layer = `pill: { backgroundImage: "linear-gradient(color-mix(in srgb, var(--ok) 16%, transparent), color-mix(in srgb, var(--ok) 16%, transparent))" },\n`;
  const same = `const a = { background: "color-mix(in srgb, var(--sunk) 55%, transparent)" }; // color-mix-ok: DOM div style\n`;
  const prev = `// color-mix-ok: custom property in a stylesheet\nconst css = "--x: color-mix(in srgb, red 10%, blue)";\n`;
  const prose = `// react-native-web drops a color-mix() backgroundColor\n/* color-mix() again */\nconst x = 1;\n`;
  for (const src of [layer, same, prev, prose]) assert.equal(checkNoColorMix(file, src).length, 0, src);
});

test("no-color-mix needs a reason in the marker and does not reach past the next line", () => {
  assert.equal(checkNoColorMix(file, `// color-mix-ok:\nconst a = "color-mix(in srgb, red 10%, blue)";\n`).length, 1);
  assert.equal(checkNoColorMix(file, `// color-mix-ok: DOM\nconst a = 1;\nconst b = "color-mix(in srgb, red 10%, blue)";\n`).length, 1);
});

test("no-color-mix reads app, ui and shot mounts source, not tests or the lint package", () => {
  assert.equal(appliesNoColorMix("ui/src/Plan/parts.tsx"), true);
  assert.equal(appliesNoColorMix("scripts/shots/mounts/x.tsx"), true);
  assert.equal(appliesNoColorMix("apps/app/src/x.test.tsx"), false);
  assert.equal(appliesNoColorMix("scripts/lint/no-color-mix.ts"), false);
  assert.equal(appliesNoColorMix("scripts/shots/prototype/vyre-v1.html"), false);
});
