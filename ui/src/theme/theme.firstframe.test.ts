// No theme flash (V1-SPEC "No theme flash (binding)", 2.1, 3.9). The first frame of every place, in light and dark,
// in every Space, must already carry the right theme, skin and tokens; any wrong-theme frame fails the test.
// The packet names ui/tests/theme.firstframe.test.tsx; node runs .ts only, so the file lives beside the code it tests (owned: ui/src/theme/**).

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { documentTokens, skinById, skins, TOKEN_NAMES } from "../tokens/skins.ts";
import { HEAD_SCRIPT, nativeRoot, webDocument } from "../../../apps/app/src/theme-boot/index.ts";
import {
  APPEARANCE_KEY,
  PLACES,
  SEED_SPACES,
  SHOT_WIDTHS,
  THEME_FLASH_APPLY_MS,
  THEME_FLASH_WRONG_FRAMES,
  applyToRoot,
  beforeFirstRender,
  emptyStore,
  firstFrame,
  headScript,
  installHead,
  readStore,
  resolveTheme,
  seedSpaceSkin,
  toInput,
  tokenTable,
  withMode,
  withOpenSpace,
  withSkin,
  writeStore,
} from "./index.ts";
import type { AppearanceStore, AppliedTheme, Mode, PlaceId, ThemeRoot } from "./index.ts";

const MODES: readonly Mode[] = ["light", "dark"];
const PERSON = "usr_irfad";

function attr(html: string, name: string): string {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(html)?.[1] ?? "";
}

function styleMap(html: string): Record<string, string> {
  const raw = attr(html, "style").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const cut = part.indexOf(":");
    if (cut > 0) out[part.slice(0, cut)] = part.slice(cut + 1);
  }
  return out;
}

/** null when the frame matches the theme; otherwise the name of the first thing that is wrong. */
function wrongTheme(html: string, applied: AppliedTheme, place: string, width: number): string | null {
  if (html.split('data-frame="').length !== 2) return "frames";
  if (attr(html, "data-frame") !== "1") return "frame";
  if (attr(html, "data-place") !== place) return "place";
  if (attr(html, "data-theme") !== applied.mode) return "theme";
  if (attr(html, "data-skin") !== applied.skin) return "skin";
  if (attr(html, "data-space") !== applied.spaceId) return "space";
  if (attr(html, "data-width") !== String(width)) return "width";
  const style = styleMap(html);
  if (style["color-scheme"] !== applied.mode) return "color-scheme";
  for (const [name, value] of Object.entries(applied.tokens)) if (style[name] !== value) return name;
  return null;
}

function chosen(spaceId: string, skin: string, mode: "auto" | Mode): AppearanceStore {
  return withMode(withSkin(emptyStore(PERSON, spaceId), spaceId, skin), spaceId, mode);
}

function fakeDocument(raw: string | null, prefersDark: boolean, storage: "ok" | "throw" | "no-media" = "ok") {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const context = {
    document: {
      documentElement: {
        setAttribute: (n: string, v: string) => void (attrs[n] = v),
        style: { setProperty: (n: string, v: string) => void (props[n] = v) },
      },
    },
    localStorage: {
      getItem(key: string) {
        if (storage === "throw") throw new Error("blocked");
        return key === APPEARANCE_KEY ? raw : null;
      },
    },
    window: {
      matchMedia(q: string) {
        if (storage === "no-media") throw new Error("no matchMedia");
        return { matches: prefersDark && q.includes("dark") };
      },
    },
  };
  return { attrs, props, run: (script: string) => vm.runInNewContext(script, context) };
}

function rootRecorder() {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const root: ThemeRoot = {
    setAttribute: (n, v) => void (attrs[n] = v),
    setProperty: (n, v) => void (props[n] = v),
    removeProperty: (n) => void delete props[n],
  };
  return { root, attrs, props };
}

test("token table is System plus the thirteen skins, as plain data (no promise)", () => {
  const table = tokenTable();
  assert.equal(table instanceof Promise, false);
  assert.deepEqual(Object.keys(table).sort(), ["system", ...skins.map((s) => s.id)].sort());
  assert.equal(skins.length, 13);
  assert.equal(table.system?.light["--accent"], documentTokens.light["--accent"]);
  assert.equal(table.system?.dark["--win"], documentTokens.dark["--win"]);
  for (const skin of skins) {
    for (const mode of MODES) for (const name of TOKEN_NAMES) assert.ok(table[skin.id]?.[mode][name], `${skin.id} ${mode} ${name}`);
  }
});

test("order: the person's choice for the Space, else the Space default, else System", () => {
  const nothing = resolveTheme(toInput(emptyStore(PERSON, "nw"), true));
  assert.deepEqual([nothing.source, nothing.skin, nothing.mode], ["system", "system", "dark"]);
  assert.equal(resolveTheme(toInput(emptyStore(PERSON, "nw"), false)).mode, "light");
  assert.equal(resolveTheme(toInput(emptyStore(PERSON, "nw"), false)).tokens["--accent"], "#5B50E8");

  const spaceOnly = { ...emptyStore(PERSON, "hb"), spaceSkin: seedSpaceSkin() };
  const fromSpace = resolveTheme(toInput(spaceOnly, true));
  assert.deepEqual([fromSpace.source, fromSpace.skin, fromSpace.mode], ["space", "linen", "light"]);
  assert.equal(fromSpace.tokens["--win"], skinById("linen")?.palette.win);

  const person = { ...chosen("hb", "graphite", "auto"), spaceSkin: seedSpaceSkin() };
  const mine = resolveTheme(toInput(person, false));
  assert.deepEqual([mine.source, mine.skin, mine.mode], ["person", "graphite", "dark"]);

  const forced = resolveTheme(toInput(chosen("hb", "graphite", "light"), true));
  assert.equal(forced.mode, "light");
  assert.equal(forced.tokens["--win"], skinById("graphite")?.light["--win"]);
});

test("unknown or hostile skin ids fall through to System", () => {
  for (const bad of ["constructor", "__proto__", "toString", "nope", ""]) {
    const applied = resolveTheme(toInput(chosen("nw", bad, "auto"), false));
    assert.equal(applied.skin, "system", bad);
    assert.equal(applied.mode, "light", bad);
  }
  assert.equal(resolveTheme(toInput(emptyStore(PERSON, "constructor"), false)).skin, "system");
});

test("first frame of every place, in light and dark, in both seed team Spaces, has no wrong-theme frame", () => {
  let frames = 0;
  for (const place of PLACES) {
    for (const mode of MODES) {
      for (const space of SEED_SPACES) {
        for (const skin of [space.skinDefault, "graphite", "paper"]) {
          const applied = resolveTheme(toInput(chosen(space.spaceId, skin, mode), false));
          const html = firstFrame(place, applied, 1280);
          assert.equal(wrongTheme(html, applied, place, 1280), null, `${place} ${space.spaceId} ${skin} ${mode}`);
          frames += 1;
        }
      }
    }
  }
  assert.equal(frames, PLACES.length * MODES.length * SEED_SPACES.length * 3);
});

test("the frame check fails on any wrong theme, skin, token, space or extra frame", () => {
  const light = resolveTheme(toInput(chosen("nw", "paper", "light"), false));
  const html = firstFrame("home", light, 1280);
  assert.equal(wrongTheme(html, light, "home", 1280), null);
  assert.equal(wrongTheme(html.replace('data-theme="light"', 'data-theme="dark"'), light, "home", 1280), "theme");
  assert.equal(wrongTheme(html.replace('data-skin="paper"', 'data-skin="graphite"'), light, "home", 1280), "skin");
  assert.equal(wrongTheme(html.replace('data-space="nw"', 'data-space="hb"'), light, "home", 1280), "space");
  assert.equal(wrongTheme(html + html, light, "home", 1280), "frames");
  const darkHover = skinById("paper")?.dark["--hover"] ?? "";
  assert.notEqual(darkHover, light.tokens["--hover"]);
  assert.equal(wrongTheme(html.replace(`--hover:${light.tokens["--hover"]}`, `--hover:${darkHover}`), light, "home", 1280), "--hover");
  assert.equal(wrongTheme(html.replace("color-scheme:light", "color-scheme:dark"), light, "home", 1280), "color-scheme");
});

test("Home at 1280 and 390 for Northwind (System) and Harbor Studio (Linen): right skin, mode and tokens", () => {
  const linen = skinById("linen");
  assert.ok(linen);
  for (const width of SHOT_WIDTHS) {
    for (const mode of MODES) {
      const nw = resolveTheme(toInput(chosen("nw", "system", mode), false));
      const hb = resolveTheme(toInput(chosen("hb", "linen", mode), false));
      const nwHtml = firstFrame("home", nw, width);
      const hbHtml = firstFrame("home", hb, width);
      assert.equal(wrongTheme(nwHtml, nw, "home", width), null);
      assert.equal(wrongTheme(hbHtml, hb, "home", width), null);
      assert.equal(styleMap(nwHtml)["--accent"], documentTokens[mode]["--accent"]);
      assert.equal(styleMap(hbHtml)["--accent"], linen.palette.accent);
      assert.equal(styleMap(hbHtml)["--win"], linen.palette.win);
      assert.equal(attr(nwHtml, "data-title"), "Home");
      assert.notEqual(styleMap(nwHtml)["--win"], styleMap(hbHtml)["--win"]);
    }
  }
  assert.equal(SEED_SPACES.find((s) => s.spaceId === "hb")?.name, "Harbor Studio");
  assert.equal(SEED_SPACES.find((s) => s.spaceId === "nw")?.skinDefault, "system");
});

test("the head script paints what resolveTheme resolves, for stored, default, empty, corrupt and blocked storage", () => {
  const nwStore = { ...chosen("nw", "paper", "auto"), spaceSkin: seedSpaceSkin() };
  const hbStore = withOpenSpace({ ...chosen("hb", "obsidian", "light"), spaceSkin: seedSpaceSkin() }, "hb");
  const hbDefault: AppearanceStore = { ...emptyStore(PERSON, "hb"), spaceSkin: seedSpaceSkin() };
  const hostile = chosen("nw", "constructor", "dark");
  const cases: { name: string; raw: string | null; dark: boolean; store: AppearanceStore | null; storage?: "ok" | "throw" | "no-media" }[] = [
    { name: "empty, device dark", raw: null, dark: true, store: null },
    { name: "empty, device light", raw: null, dark: false, store: null },
    { name: "corrupt", raw: "{", dark: true, store: null },
    { name: "storage blocked", raw: null, dark: false, store: null, storage: "throw" },
    { name: "no matchMedia", raw: null, dark: true, store: null, storage: "no-media" },
    { name: "light skin on dark device", raw: writeStore(nwStore), dark: true, store: nwStore },
    { name: "dark skin forced light", raw: writeStore(hbStore), dark: true, store: hbStore },
    { name: "Space default", raw: writeStore(hbDefault), dark: true, store: hbDefault },
    { name: "hostile skin id", raw: writeStore(hostile), dark: false, store: hostile },
  ];
  for (const c of cases) {
    const doc = fakeDocument(c.raw, c.dark, c.storage ?? "ok");
    doc.run(headScript());
    const deviceDark = c.storage === "no-media" ? false : c.dark;
    const applied = resolveTheme(toInput(c.store ?? emptyStore(PERSON, ""), deviceDark));
    assert.equal(doc.attrs["data-theme"], applied.mode, c.name);
    assert.equal(doc.attrs["data-skin"], applied.skin, c.name);
    assert.equal(doc.props["color-scheme"], applied.mode, c.name);
    for (const [name, value] of Object.entries(applied.tokens)) assert.equal(doc.props[name], value, `${c.name} ${name}`);
    assert.equal(doc.attrs["data-space"], c.store ? c.store.spaceId : undefined, c.name);
  }
});

test("the head script is synchronous, inline and first in head", () => {
  const script = headScript();
  assert.equal(HEAD_SCRIPT, script);
  for (const banned of ["await", "fetch(", "import(", "setTimeout", "requestAnimationFrame", "Promise"]) assert.equal(script.includes(banned), false, banned);
  const page = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/a.css"></head><body></body></html>`;
  const doc = webDocument(page);
  const boot = doc.indexOf('data-theme-boot="true"');
  assert.ok(boot > doc.indexOf("<head") && boot < doc.indexOf('<meta charset'), "first child of head");
  assert.ok(boot < doc.indexOf("<link"), "before any stylesheet");
  const tagStart = doc.lastIndexOf("<script", boot);
  const tag = doc.slice(tagStart, doc.indexOf(">", tagStart));
  for (const bad of ['type="module"', " async", " defer", " src="]) assert.equal(tag.includes(bad), false, bad);
  assert.equal(installHead(doc), doc, "second call leaves the document alone");
  assert.equal(installHead("<body></body>").startsWith("<head><script"), true, "no head element: one is made");
});

test("native: the style map is ready before the first render and equals the web paint", () => {
  const store = withOpenSpace({ ...chosen("hb", "linen", "auto"), spaceSkin: seedSpaceSkin() }, "hb");
  const input = toInput(store, true);
  const native = nativeRoot(input);
  assert.equal(native instanceof Promise, false);
  assert.deepEqual(native, beforeFirstRender(input));
  assert.equal(native.applied.skin, "linen");
  assert.equal(native.rootStyle["color-scheme"], "light");
  const doc = fakeDocument(writeStore(store), true);
  doc.run(headScript());
  for (const [name, value] of Object.entries(native.rootStyle)) assert.equal(doc.props[name], value, name);
});

test("applyToRoot clears tokens a smaller set (System) does not define", () => {
  const rec = rootRecorder();
  applyToRoot(resolveTheme(toInput(chosen("nw", "graphite", "auto"), false)), rec.root);
  assert.ok(rec.props["--me"] && rec.props["--press"]);
  applyToRoot(resolveTheme(toInput(emptyStore(PERSON, "nw"), false)), rec.root);
  assert.equal(rec.props["--me"], undefined);
  assert.equal(rec.props["--win"], documentTokens.light["--win"]);
  assert.equal(rec.attrs["data-skin"], "system");
});

test("store round trip, and malformed stores are rejected", () => {
  const store = { ...chosen("hb", "moss", "dark"), spaceSkin: seedSpaceSkin() };
  assert.deepEqual(readStore(writeStore(store)), store);
  for (const raw of [null, "", "[]", "{}", "null", '{"personId":1}', JSON.stringify({ ...store, spaces: { hb: { skin: "moss", mode: "neon" } } }), JSON.stringify({ ...store, spaceSkin: { hb: 3 } })]) {
    assert.equal(readStore(raw), null, String(raw));
  }
});

