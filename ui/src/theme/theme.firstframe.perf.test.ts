// The speed half of theme.firstframe.test.ts (split out so that only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
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

test("perf theme_flash: zero wrong frames, and resolving plus writing the root fits the first-paint budget", () => {
  const runs: number[] = [];
  let wrong = 0;
  for (let i = 0; i < 5; i += 1) {
    const rec = rootRecorder();
    const t0 = performance.now();
    const applied = resolveTheme(toInput({ ...chosen("hb", "linen", "dark"), spaceSkin: seedSpaceSkin() }, false));
    applyToRoot(applied, rec.root);
    runs.push(performance.now() - t0);
  }
  for (const place of PLACES as readonly PlaceId[]) {
    for (const mode of MODES) {
      for (const space of SEED_SPACES) {
        for (const width of SHOT_WIDTHS) {
          const applied = resolveTheme(toInput(chosen(space.spaceId, space.skinDefault, mode), false));
          if (wrongTheme(firstFrame(place, applied, width), applied, place, width)) wrong += 1;
        }
      }
    }
  }
  const doc = fakeDocument(writeStore(chosen("hb", "linen", "dark")), false);
  const t1 = performance.now();
  doc.run(headScript());
  const headMs = performance.now() - t1;
  const median = [...runs].sort((a, b) => a - b)[2] ?? Infinity;
  console.log(`perf theme_flash wrong_frames=${wrong} apply_median_ms=${median.toFixed(3)} head_script_ms=${headMs.toFixed(3)} ceiling_wrong=${THEME_FLASH_WRONG_FRAMES} ceiling_ms=${THEME_FLASH_APPLY_MS}`);
  assert.equal(wrong, THEME_FLASH_WRONG_FRAMES);
  assert.ok(median < THEME_FLASH_APPLY_MS, `apply median ${median}`);
  assert.ok(headMs < THEME_FLASH_APPLY_MS, `head script ${headMs}`);
});
