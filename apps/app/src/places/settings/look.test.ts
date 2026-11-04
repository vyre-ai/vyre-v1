// Settings > Appearance logic: the stored look is checked, slots pick the right skin for the device, a pick says what changed, and made skins round-trip through a link.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOOK, buildSkin, changedLine, choose, effectiveSkin, lookFrom, paletteOf, parseSkinLink, skinLink, slotIsLive, slotKey, withMode, withSkinAdded } from "./look.ts";

test("the stored look is checked part by part; nothing unknown throws", () => {
  assert.deepEqual(lookFrom(undefined), DEFAULT_LOOK);
  assert.deepEqual(lookFrom("garbage"), DEFAULT_LOOK);
  const l = lookFrom({ mode: "dark", day: "paper", text: 117, density: "compact", rm: true, lang: "English", mine: [{ id: "my-1", name: "A", base: "dark", accent: "#112233", contrast: "high" }, { id: "bad", name: "B", base: "dark", accent: "red", contrast: "high" }] });
  assert.equal(l.mode, "dark"); assert.equal(l.day, "paper"); assert.equal(l.text, 115, "text snaps to a step of 5"); assert.equal(l.density, "compact"); assert.equal(l.rm, true);
  assert.deepEqual(l.mine.map((m) => m.id), ["my-1"], "a skin with a bad colour is left out");
  assert.equal(lookFrom({ text: 9000 }).text, 130); assert.equal(lookFrom({ text: 1 }).text, 85);
});

test("slots: matching the device uses By day or At night; a fixed mode has one slot", () => {
  const l = { ...DEFAULT_LOOK, day: "paper", night: "graphite", light: "fog", dark: "slate" };
  assert.equal(effectiveSkin(l, false), "paper"); assert.equal(effectiveSkin(l, true), "graphite");
  assert.equal(effectiveSkin(withMode(l, "light"), true), "fog"); assert.equal(effectiveSkin(withMode(l, "dark"), false), "slate");
  assert.equal(slotKey(l, "night"), "night"); assert.equal(slotKey(withMode(l, "dark"), "night"), "dark");
  assert.equal(slotIsLive(l, "night", false), false, "At night is not on screen by day"); assert.equal(slotIsLive(l, "day", false), true); assert.equal(slotIsLive(withMode(l, "light"), "day", true), true);
});

test("a pick changes one slot, says so, and picking what is there changes nothing", () => {
  assert.equal(choose(DEFAULT_LOOK, "day", "vyre-light"), null);
  assert.equal(choose(DEFAULT_LOOK, "night", "graphite")!.night, "graphite");
  assert.equal(choose(DEFAULT_LOOK, "night", "graphite")!.day, "vyre-light");
  assert.equal(changedLine("Graphite", "night", false), "Changed to Graphite at night");
  assert.equal(changedLine("Graphite", "night", true), "Changed to Graphite");
  assert.equal(changedLine("Paper", "light", false), "Changed to Paper");
});

test("a made skin has a stable id, real colours, and survives its own link", () => {
  const s = buildSkin("Sunrise", "light", "#E4572E", "standard");
  assert.equal(s.id, buildSkin("Sunrise", "light", "#E4572E", "standard").id);
  assert.notEqual(s.id, buildSkin("Sunrise", "dark", "#E4572E", "standard").id);
  const p = paletteOf(s);
  assert.equal(p.accent, "#E4572E"); assert.match(p.win, /^#[0-9a-f]{6}$/i); assert.notEqual(paletteOf(buildSkin("S", "dark", "#E4572E", "soft")).win, paletteOf(buildSkin("S", "dark", "#E4572E", "high")).win);
  const back = parseSkinLink(skinLink(s));
  assert.ok(back.ok && back.skin.id === s.id && back.skin.note === "Shared with you");
  assert.equal(buildSkin("   ", "dark", "nope", "high").name, "My skin"); assert.match(buildSkin("x", "dark", "nope", "high").accent, /^#/);
});

test("a link that is not a skin says why", () => {
  assert.equal(parseSkinLink("hello").ok, false);
  const r = parseSkinLink("vyre.run/skin/!!!"); assert.equal(r.ok, false);
  const bad = parseSkinLink("vyre.run/skin/" + btoa(JSON.stringify(["x", "dark", "red", "high"])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""));
  assert.ok(!bad.ok && /does not hold a skin/.test(bad.error));
  assert.ok(parseSkinLink("https://vyre.run/skin/" + skinLink(buildSkin("A", "dark", "#112233", "soft")).split("/").pop()).ok);
});

test("a skin is added once", () => {
  const s = buildSkin("A", "dark", "#112233", "soft");
  assert.equal(withSkinAdded(withSkinAdded(DEFAULT_LOOK, s), s).mine.length, 1);
});
