// First frame of every place, light and dark. A wrong theme, skin or token fails the test.
// The head script runs here against a fake document, before any body markup.

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { documentTokens, skinById, skins } from "../src/tokens/skins.ts";
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
} from "../src/theme/index.ts";
import type { AppliedTheme, AppearanceStore, Mode, ThemeRoot } from "../src/theme/index.ts";

const bootPath = fileURLToPath(new URL("../../apps/app/src/theme-boot/index.ts", import.meta.url));

const MODES: readonly Mode[] = ["light", "dark"];

function attr(html: string, name: string): string {
  const found = new RegExp(`\\b${name}="([^"]*)"`).exec(html);
  return found?.[1] ?? "";
}

function unescapeAttr(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function styleMap(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of unescapeAttr(attr(html, "style")).split(";")) {
    if (!part) continue;
    const cut = part.indexOf(":");
    if (cut <= 0) continue;
    out[part.slice(0, cut)] = part.slice(cut + 1);
  }
  return out;
}

/** Null when the frame matches the theme. Any other string is a wrong-theme frame. */
function wrongTheme(html: string, applied: AppliedTheme, place: string, width: number): string | null {
  if (attr(html, "data-frame") !== "1") return "frame";
  if (html.includes('data-frame="0"')) return "flash";
  if (html.split('data-frame="').length !== 2) return "frames";
  if (attr(html, "data-place") !== place) return "place";
  if (attr(html, "data-theme") !== applied.mode) return "theme";
  if (attr(html, "data-skin") !== applied.skin) return "skin";
  if (attr(html, "data-space") !== applied.spaceId) return "space";
  if (attr(html, "data-width") !== String(width)) return "width";
  const style = styleMap(html);
  if (style["color-scheme"] !== applied.mode) return "color-scheme";
  for (const name of Object.keys(applied.tokens)) {
    if (style[name] !== applied.tokens[name]) return name;
  }
  return null;
}

function paintedStore(spaceId: string, skin: string, mode: Mode): AppearanceStore {
  return withMode(withSkin(emptyStore("usr_irfad", spaceId), spaceId, skin), spaceId, mode);
}

interface Painted {
  attrs: Record<string, string>;
  props: Record<string, string>;
}

function runHead(script: string, raw: string | null, prefersDark: boolean, storage: "ok" | "throw" = "ok"): Painted {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const document = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attrs[name] = value;
      },
      style: {
        setProperty(name: string, value: string) {
          props[name] = value;
        },
      },
    },
  };
  const localStorage = {
    getItem(key: string) {
      if (storage === "throw") throw new Error("blocked");
      return key === APPEARANCE_KEY ? raw : null;
    },
  };
  const window = {
    matchMedia(query: string) {
      return { matches: prefersDark && query.includes("dark") };
    },
  };
  vm.runInNewContext(script, { document, localStorage, window });
  return { attrs, props };
}

function agree(painted: Painted, applied: AppliedTheme): void {
  assert.equal(painted.attrs["data-theme"], applied.mode);
  assert.equal(painted.attrs["data-skin"], applied.skin);
  assert.equal(painted.props["color-scheme"], applied.mode);
  for (const name of Object.keys(applied.tokens)) {
    assert.equal(painted.props[name], applied.tokens[name], name);
  }
}

test("token table is classic, system and the thirteen skins, ready as data", () => {
  const table = tokenTable();
  assert.equal(table instanceof Promise, false);
  const ids = Object.keys(table).sort();
  assert.deepEqual(ids, ["classic", "system", ...skins.map((skin) => skin.id)].sort());
  assert.equal(table.classic?.light["--accent"], documentTokens.light["--accent"]);
  assert.equal(table.classic?.dark["--win"], documentTokens.dark["--win"]);
  assert.deepEqual(table.system?.light, table.classic?.light);
  const paper = skinById("paper");
  assert.ok(paper);
  assert.notEqual(table.classic?.light["--accent"], paper.light["--accent"]);
  assert.notEqual(table.classic?.light["--hover"], paper.light["--hover"]);
});

test("stored person choice wins, else the Space skin, else the system palette", () => {
  const none = resolveTheme(toInput(emptyStore("usr_irfad", "spc_northwind"), true, null));
  assert.equal(none.source, "system");
  assert.equal(none.skin, "classic");
  assert.equal(none.mode, "dark");
  assert.equal(none.tokens["--hover"], documentTokens.dark["--hover"]);
  assert.equal(none.preview, false);
  assert.equal(none instanceof Promise, false);

  const day = resolveTheme(toInput(emptyStore("usr_irfad", "spc_northwind"), false, null));
  assert.equal(day.mode, "light");
  assert.equal(day.tokens["--accent"], "#5B50E8");

  const spaceOnly: AppearanceStore = { ...emptyStore("usr_irfad", "spc_harbor"), spaceSkin: seedSpaceSkin() };
  const fromSpace = resolveTheme(toInput(spaceOnly, false, null));
  assert.equal(fromSpace.source, "space");
  assert.equal(fromSpace.skin, "linen");
  assert.equal(fromSpace.mode, "light");
  assert.equal(fromSpace.tokens["--win"], skinById("linen")?.palette.win);

  const person = paintedStore("spc_harbor", "paper", "dark");
  const chosen = resolveTheme(toInput({ ...person, spaceSkin: seedSpaceSkin() }, false, null));
  assert.equal(chosen.source, "person");
  assert.equal(chosen.skin, "paper");
  assert.equal(chosen.mode, "dark");
  assert.equal(chosen.tokens["--ok"], "#4CC38A");

  const unknown = resolveTheme(toInput(paintedStore("spc_northwind", "constructor", "light"), false, null));
  assert.equal(unknown.skin, "classic");
  assert.equal(unknown.source, "system");
  assert.equal(unknown.mode, "light");
});

test("skin switch is instant across Spaces and preview does not write the store", () => {
  let store = emptyStore("usr_irfad", "spc_northwind");
  store = { ...store, spaceSkin: seedSpaceSkin() };
  store = withMode(withSkin(store, "spc_northwind", "classic"), "spc_northwind", "light");
  store = withMode(withSkin(store, "spc_harbor", "linen"), "spc_harbor", "dark");

  const north = resolveTheme(toInput(store, true, null));
  const harbor = resolveTheme(toInput(withOpenSpace(store, "spc_harbor"), true, null));
  assert.equal(north.spaceId, "spc_northwind");
  assert.equal(north.skin, "classic");
  assert.equal(north.mode, "light");
  assert.equal(harbor.spaceId, "spc_harbor");
  assert.equal(harbor.skin, "linen");
  assert.equal(harbor.mode, "dark");
  assert.notEqual(north.tokens["--accent"], harbor.tokens["--accent"]);
  assert.equal(store.spaces.spc_northwind?.skin, "classic");
  assert.equal(withOpenSpace(store, "spc_harbor").spaces.spc_northwind?.skin, "classic");

  const preview = resolveTheme(toInput(store, false, { skin: "moss", mode: "dark" }));
  assert.equal(preview.preview, true);
  assert.equal(preview.skin, "moss");
  assert.equal(preview.mode, "dark");
  assert.equal(writeStore(store).includes("moss"), false);
  const restored = resolveTheme(toInput(store, false, null));
  assert.equal(restored.skin, "classic");
  assert.equal(restored.preview, false);

  const root: ThemeRoot & { attrs: Record<string, string>; props: Record<string, string> } = {
    attrs: {},
    props: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    setProperty(name, value) {
      this.props[name] = value;
    },
  };
  applyToRoot(north, root);
  applyToRoot(harbor, root);
  assert.equal(root.attrs["data-skin"], "linen");
  assert.equal(root.attrs["data-theme"], "dark");
  assert.equal(root.attrs["data-space"], "spc_harbor");
  assert.equal(root.props["--win"], harbor.tokens["--win"]);
  assert.equal(root.props["--accent"], harbor.tokens["--accent"]);

  const frames = [firstFrame("home", harbor, 1280)];
  assert.equal(frames.length, 1);
  assert.equal(wrongTheme(frames[0] ?? "", harbor, "home", 1280), null);
  assert.equal(readStore(writeStore(store))?.spaces.spc_harbor?.mode, "dark");
});

test("first frame of every place in light and dark uses that theme and fails on a wrong frame", () => {
  const harborSkin = "linen";
  const northSkin = "classic";
  for (const place of PLACES) {
    for (const mode of MODES) {
      for (const [spaceId, skin] of [
        ["spc_northwind", northSkin],
        ["spc_harbor", harborSkin],
      ] as const) {
        const applied = resolveTheme(toInput(paintedStore(spaceId, skin, mode), false, null));
        const html = firstFrame(place, applied, 1280);
        const problem = wrongTheme(html, applied, place, 1280);
        assert.equal(problem, null, `${place} ${spaceId} ${mode} ${problem ?? ""}`);
        const other = spaceId === "spc_northwind" ? "spc_harbor" : "spc_northwind";
        assert.equal(html.includes(other), false, place);
      }
    }
  }

  const north = resolveTheme(toInput(paintedStore("spc_northwind", "classic", "light"), false, null));
  const html = firstFrame("home", north, 1280);
  assert.equal(wrongTheme(html, north, "home", 1280), null);
  assert.equal(wrongTheme(html.replace('data-theme="light"', 'data-theme="dark"'), north, "home", 1280), "theme");
  const darkHover = documentTokens.dark["--hover"] ?? "";
  assert.notEqual(darkHover, north.tokens["--hover"]);
  assert.equal(wrongTheme(html.replace(north.tokens["--hover"] ?? "", darkHover), north, "home", 1280) === null, false);

  const harbor = resolveTheme(toInput(paintedStore("spc_harbor", "linen", "dark"), false, null));
  const harborHtml = firstFrame("records", harbor, 1280);
  const lightOk = skinById("linen")?.light["--ok"] ?? "";
  assert.notEqual(lightOk, harbor.tokens["--ok"]);
  assert.equal(wrongTheme(harborHtml.replace(harbor.tokens["--ok"] ?? "", lightOk), harbor, "records", 1280) === null, false);
  assert.equal(wrongTheme(harborHtml.replace('data-skin="linen"', 'data-skin="classic"'), harbor, "records", 1280), "skin");
});

test("Home first frames for Northwind classic and Harbor Studio linen at 1280 and 390", () => {
  const linen = skinById("linen");
  const paper = skinById("paper");
  assert.ok(linen && paper);
  for (const width of SHOT_WIDTHS) {
    for (const mode of MODES) {
      const north = resolveTheme(toInput(paintedStore("spc_northwind", "classic", mode), false, null));
      const harbor = resolveTheme(toInput(paintedStore("spc_harbor", "linen", mode), false, null));
      const northHtml = firstFrame("home", north, width);
      const harborHtml = firstFrame("home", harbor, width);
      assert.equal(wrongTheme(northHtml, north, "home", width), null);
      assert.equal(wrongTheme(harborHtml, harbor, "home", width), null);
      assert.equal(attr(northHtml, "data-title"), "Home");
      assert.equal(attr(harborHtml, "data-skin"), "linen");
      assert.equal(attr(northHtml, "data-skin"), "classic");
      assert.equal(styleMap(northHtml)["--accent"], documentTokens[mode]["--accent"]);
      assert.equal(styleMap(northHtml)["--hover"], documentTokens[mode]["--hover"]);
      assert.notEqual(styleMap(northHtml)["--hover"], paper[mode]["--hover"]);
      assert.equal(styleMap(harborHtml)["--win"], linen.palette.win);
      assert.equal(styleMap(harborHtml)["--ok"], mode === "dark" ? "#4CC38A" : "#2F9461");
      assert.notEqual(styleMap(northHtml)["--accent"], styleMap(harborHtml)["--accent"]);
    }
  }
  assert.equal(SEED_SPACES.find((space) => space.key === "northwind")?.skinDefault, "classic");
  assert.equal(SEED_SPACES.find((space) => space.key === "harbor")?.skinDefault, "linen");
  assert.equal(SEED_SPACES.find((space) => space.key === "harbor")?.name, "Harbor Studio");
});

test("web head script matches the resolver and runs before the body", () => {
  const script = headScript();
  assert.equal(script.startsWith("(function(){"), true);
  assert.equal(script.endsWith("})();"), true);
  assert.equal(script.includes("await"), false);
  assert.equal(script.includes("fetch("), false);
  assert.equal(script.includes("import("), false);
  for (const id of ["classic", "system", ...skins.map((skin) => skin.id)]) {
    assert.equal(script.includes(JSON.stringify(id)), true, id);
  }

  const doc = installHead(`<!doctype html><html><head><meta charset="utf-8"></head><body><main></main></body></html>`, script);
  const bootAt = doc.indexOf('data-theme-boot="true"');
  const bodyAt = doc.indexOf("<body");
  assert.ok(bootAt > 0 && bootAt < bodyAt);
  assert.equal(doc.includes('type="module"'), false);
  assert.equal(doc.includes(" async"), false);
  assert.equal(doc.includes(" defer"), false);
  assert.equal(installHead(doc, script), doc);

  const cases: { raw: string | null; prefersDark: boolean; storage?: "ok" | "throw"; store: AppearanceStore }[] = [];
  const blank = emptyStore("usr_irfad", "spc_northwind");
  cases.push({ raw: null, prefersDark: true, store: blank });
  cases.push({ raw: null, prefersDark: false, store: blank });
  cases.push({ raw: "{", prefersDark: true, store: blank });
  cases.push({ raw: null, prefersDark: false, storage: "throw", store: blank });

  const north = paintedStore("spc_northwind", "classic", "light");
  north.spaceSkin = seedSpaceSkin();
  cases.push({ raw: writeStore(north), prefersDark: true, store: north });

  const harbor = withOpenSpace(paintedStore("spc_harbor", "linen", "dark"), "spc_harbor");
  harbor.spaceSkin = seedSpaceSkin();
  cases.push({ raw: writeStore(harbor), prefersDark: false, store: harbor });

  const spaceDefault: AppearanceStore = { ...emptyStore("usr_irfad", "spc_harbor"), spaceSkin: seedSpaceSkin() };
  cases.push({ raw: writeStore(spaceDefault), prefersDark: true, store: spaceDefault });

  const hostile = paintedStore("spc_northwind", "constructor", "dark");
  cases.push({ raw: writeStore(hostile), prefersDark: false, store: hostile });

  for (const item of cases) {
    const expectsSystem = item.raw === null || item.raw === "{" || item.storage === "throw";
    const applied = expectsSystem
      ? resolveTheme(toInput(emptyStore("usr_irfad", ""), item.prefersDark, null))
      : resolveTheme(toInput(item.store, item.prefersDark, null));
    const painted = runHead(script, item.raw, item.prefersDark, item.storage ?? "ok");
    agree(painted, applied);
    if (!expectsSystem) assert.equal(painted.attrs["data-space"], item.store.spaceId);
    else assert.equal(painted.attrs["data-space"], undefined);
  }
});

test("native theme is a style map before the first render", () => {
  const store = withOpenSpace(paintedStore("spc_harbor", "linen", "light"), "spc_harbor");
  const input = toInput(store, true, null);
  const native = beforeFirstRender(input);
  assert.equal(native instanceof Promise, false);
  assert.equal(native.applied.mode, "light");
  assert.equal(native.applied.skin, "linen");
  assert.equal(native.rootStyle["color-scheme"], "light");
  assert.equal(native.rootStyle["--win"], native.applied.tokens["--win"]);
  assert.equal(native.rootStyle["--ok"], "#2F9461");

  const bootSrc = readFileSync(bootPath, "utf8");
  assert.equal(bootSrc.includes("headScript()"), true);
  assert.equal(bootSrc.includes("installHead(html, HEAD_SCRIPT)"), true);
  assert.equal(bootSrc.includes("beforeFirstRender(input)"), true);
  assert.equal(bootSrc.includes("../../../../ui/src/theme/index.ts"), true);
  assert.equal(bootSrc.includes("fetch("), false);
  assert.equal(bootSrc.includes("await "), false);
});

test("theme_flash stays inside the ceiling of zero wrong frames", () => {
  const started = performance.now();
  let wrong = 0;
  for (const place of PLACES) {
    for (const mode of MODES) {
      for (const space of SEED_SPACES) {
        for (const width of SHOT_WIDTHS) {
          const applied = resolveTheme(toInput(paintedStore(space.spaceId, space.skinDefault, mode), false, null));
          const html = firstFrame(place, applied, width);
          if (wrongTheme(html, applied, place, width)) wrong += 1;
        }
      }
    }
  }
  const applyMs = performance.now() - started;
  console.log(
    `theme_flash wrong_frames=${wrong} apply_ms=${applyMs.toFixed(2)} ceiling_wrong=${THEME_FLASH_WRONG_FRAMES} ceiling_ms=${THEME_FLASH_APPLY_MS}`,
  );
  assert.equal(wrong, THEME_FLASH_WRONG_FRAMES);
  assert.equal(applyMs < THEME_FLASH_APPLY_MS, true, `apply_ms=${applyMs}`);
});
