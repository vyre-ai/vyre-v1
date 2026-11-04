// Settings > Appearance: When, the By day and At night slots, the gallery of mini apps, Undo, skins from a link and Make your own, and Display. Every control saves appearance.look and asks the window to wear it.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { LOOK_KEY, buildSkin, skinLink } from "./look.ts";
import { createSampleSettings, harbor, northwind } from "./sample.ts";

const html = (s: ReturnType<typeof createSampleSettings>): string => renderToStaticMarkup(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} initialPage="appearance" /></SettingsDataProvider>).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";

test("When, then which: the three modes, the By day and At night slots, and the light skins first", () => {
  const out = html(createSampleSettings(northwind));
  for (const w of ["Match my device", "Always light", "Always dark", "By day", "At night", "Vyre follows your device. Pick a slot, then a skin below. Just for you, in Northwind.", "Light skins", "Show all"]) assert.ok(out.includes(w), w);
  assert.ok(out.indexOf(">When<") < out.indexOf("By day") && out.indexOf("By day") < out.indexOf("Light skins") && out.indexOf("Light skins") < out.indexOf(">Display<"));
  assert.match(tag(out, "skin-paper"), /aria-pressed="false"/);
  assert.match(tag(out, "skin-vyre-light"), /aria-pressed="true"/, "the By day skin is marked");
  assert.ok(out.includes('data-testid="skin-thumb"'), "each skin is drawn as a small app");
  assert.ok(!out.includes('data-testid="skin-graphite"'), "dark skins wait behind Show all while By day is picked");
});

test("Display: text size, density, reduce motion and language, then the keyboard shortcuts", () => {
  const out = html(createSampleSettings(harbor));
  for (const id of ["look-text", "look-density", "look-rm", "look-lang"]) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.ok(out.includes("100%") && out.includes("Fewer animations everywhere") && out.includes("Text size, density and motion are the same in every Space."));
  assert.ok(out.indexOf(">Display<") < out.indexOf("Keyboard shortcuts"));
});

test("Get a skin from a link and Make your own are rows with their buttons", () => {
  const out = html(createSampleSettings(northwind));
  assert.ok(out.includes("Get a skin from a link") && out.includes("Paste a link") && out.includes("Make your own") && out.includes("Make a skin"));
});

test("the look is one setting; saving it asks the window to wear it, and Undo puts the old one back", async () => {
  const s = createSampleSettings(northwind);
  const mine = buildSkin("Sunrise", "light", "#E4572E", "standard");
  const look = { mode: "dark", day: "paper", night: "graphite", light: "fog", dark: "slate", text: 110, density: "compact", rm: true, lang: "English", mine: [mine] };
  await s.data.call("settings.set", { key: LOOK_KEY, value: look });
  const out = html(s);
  assert.match(tag(out, "skin-slate"), /aria-pressed="true"/, "Always dark wears its own skin");
  assert.ok(out.includes("110%") && out.includes("Always dark") && out.includes("slot-dark"));
  assert.ok(!out.includes(">Yours<"), "a light skin of mine waits while the dark slot is open");
  await s.data.call("settings.set", { key: LOOK_KEY, value: { ...look, mode: "light", light: mine.id } });
  const lit = html(s);
  assert.ok(lit.includes(">Yours<") && lit.includes(`data-testid="skin-${mine.id}"`) && /aria-pressed="true"/.test(tag(lit, `skin-${mine.id}`)), "a skin I made is in the gallery and marked when worn");
  const link = skinLink(mine);
  assert.match(link, /^vyre\.run\/skin\//);
});
