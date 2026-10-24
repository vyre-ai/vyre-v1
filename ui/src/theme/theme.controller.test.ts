// Appearance per person per Space, instant skin switch across Spaces, and skin preview (spec 2.1, 3.0, 3.9).

import test from "node:test";
import assert from "node:assert/strict";
import { skinById } from "../tokens/skins.ts";
import { APPEARANCE_KEY, SEED_SPACES, createThemeController, readStore, seedSpaceSkin } from "./index.ts";
import type { ThemeRoot, ThemeStorage } from "./index.ts";

function rig(seed: string | null = null, opts: { fail?: boolean; person?: string; space?: string; dark?: boolean } = {}) {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const root: ThemeRoot = {
    setAttribute: (n, v) => void (attrs[n] = v),
    setProperty: (n, v) => void (props[n] = v),
    removeProperty: (n) => void delete props[n],
  };
  const mem = new Map<string, string>();
  if (seed !== null) mem.set(APPEARANCE_KEY, seed);
  const storage: ThemeStorage = {
    getItem: (k) => {
      if (opts.fail) throw new Error("blocked");
      return mem.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (opts.fail) throw new Error("full");
      mem.set(k, v);
    },
  };
  const controller = createThemeController({
    personId: opts.person ?? "usr_irfad",
    spaceId: opts.space ?? "nw",
    spaceSkin: seedSpaceSkin(),
    prefersDark: opts.dark ?? false,
    root,
    storage,
  });
  return { controller, attrs, props, mem };
}

test("the root is themed when the controller is created", () => {
  const { attrs, props } = rig();
  assert.equal(attrs["data-skin"], "system");
  assert.equal(attrs["data-theme"], "light");
  assert.ok(props["--win"]);
});

test("a skin is personal per Space: switching Spaces swaps the skin in the same call", () => {
  const { controller, attrs, props } = rig();
  controller.setSkin("graphite");
  assert.equal(attrs["data-skin"], "graphite");
  assert.equal(attrs["data-theme"], "dark");
  const hb = controller.switchSpace("hb");
  assert.equal(hb.skin, "linen", "Harbor Studio has not been chosen yet: its Space default");
  assert.equal(attrs["data-skin"], "linen");
  assert.equal(props["--win"], skinById("linen")?.palette.win);
  controller.setSkin("moss");
  assert.equal(controller.switchSpace("nw").skin, "graphite");
  assert.equal(attrs["data-space"], "nw");
  assert.equal(controller.switchSpace("hb").skin, "moss");
  assert.equal(controller.switchSpace("me").skin, "system");
});

test("the choice is saved per Space and survives a reload, only for the same person", () => {
  const a = rig();
  a.controller.setSkin("slate");
  a.controller.switchSpace("hb");
  a.controller.setSkin("sage");
  a.controller.setMode("dark");
  const saved = a.mem.get(APPEARANCE_KEY) ?? null;
  assert.equal(readStore(saved)?.spaces.nw?.skin, "slate");
  assert.equal(readStore(saved)?.spaceId, "hb");

  const again = rig(saved, { space: "hb" });
  assert.equal(again.attrs["data-skin"], "sage");
  assert.equal(again.attrs["data-theme"], "dark");
  assert.equal(again.controller.switchSpace("nw").skin, "slate");

  const other = rig(saved, { space: "hb", person: "usr_other" });
  assert.equal(other.attrs["data-skin"], "linen", "someone else's choices do not apply");
});

test("preview shows a skin without choosing it and writes nothing", () => {
  const { controller, attrs, mem } = rig();
  controller.setSkin("paper");
  const before = mem.get(APPEARANCE_KEY);
  const seen: string[] = [];
  const off = controller.subscribe((t) => seen.push(`${t.skin}${t.preview ? "*" : ""}`));
  controller.preview({ skin: "obsidian" });
  assert.equal(attrs["data-skin"], "obsidian");
  assert.equal(attrs["data-theme"], "dark");
  assert.equal(controller.current().preview, true);
  assert.equal(mem.get(APPEARANCE_KEY), before);
  controller.preview(null);
  assert.equal(attrs["data-skin"], "paper");
  assert.equal(controller.current().preview, false);
  off();
  controller.preview({ skin: "dusk" });
  assert.deepEqual(seen, ["obsidian*", "paper"]);
  controller.switchSpace("hb");
  assert.equal(controller.current().preview, false, "opening a Space ends a preview");
});

test("System follows the device; an explicit skin does not", () => {
  const { controller, attrs } = rig();
  assert.equal(attrs["data-theme"], "light");
  controller.setPrefersDark(true);
  assert.equal(attrs["data-theme"], "dark");
  controller.setSkin("paper");
  controller.setPrefersDark(false);
  controller.setPrefersDark(true);
  assert.equal(attrs["data-theme"], "light");
});

test("blocked or full storage never blocks the theme", () => {
  const { controller, attrs } = rig(null, { fail: true });
  assert.equal(attrs["data-skin"], "system");
  controller.setSkin("fog");
  assert.equal(attrs["data-skin"], "fog");
  assert.equal(controller.switchSpace("hb").skin, "linen");
  assert.equal(SEED_SPACES.length, 3);
});
