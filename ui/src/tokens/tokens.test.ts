import test from "node:test";
import assert from "node:assert/strict";
import { TOKEN_NAMES, documentTokens, skins, skinById, nativeTokens, tokensOf, system, typeTokens } from "./skins.ts";
import type { Mode, Skin, TokenSet } from "./skins.ts";

const EXPECTED: readonly string[] = [
  "--win",
  "--side",
  "--rail",
  "--raised",
  "--sunk",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--ink-4",
  "--me",
  "--hover",
  "--press",
  "--sel",
  "--sel-strong",
  "--line",
  "--line-2",
  "--accent",
  "--accent-ink",
  "--accent-wash",
  "--accent-line",
  "--beacon",
  "--ok",
  "--warn",
  "--danger",
  "--sh-1",
  "--sh-2",
  "--sh-pop",
];

const MODES: readonly Mode[] = ["light", "dark"];

function names(set: TokenSet): string[] {
  return Object.keys(set).sort();
}

test("the frozen token set is the vars() list from vyre-v1.html", () => {
  assert.deepEqual([...TOKEN_NAMES], EXPECTED);
  assert.equal(new Set(TOKEN_NAMES).size, TOKEN_NAMES.length);
});

test("thirteen skins, seven dark and six light, system kept beside them", () => {
  assert.equal(skins.length, 13);
  assert.deepEqual(
    skins.map((s) => s.id),
    ["graphite", "obsidian", "charcoal", "slate", "ember", "moss", "dusk", "paper", "fog", "linen", "sand", "sage", "mist"],
  );
  assert.equal(skins.filter((s) => s.base === "dark").length, 7);
  assert.equal(skins.filter((s) => s.base === "light").length, 6);
  assert.equal(system.id, "system");
  assert.equal(skins.some((s) => s.id === "system"), false);
  assert.equal(typeTokens["--ui"].includes("Inter"), true);
  assert.equal(typeTokens["--mono"].includes("JetBrains Mono"), true);
});

test("each skin defines every token for light and for dark", () => {
  const want = [...EXPECTED].sort();
  for (const s of skins) {
    for (const mode of MODES) {
      const set = s[mode];
      assert.deepEqual(names(set), want, `${s.id} ${mode}`);
      for (const name of EXPECTED) {
        const value = set[name as keyof TokenSet];
        assert.equal(typeof value, "string", `${s.id} ${mode} ${name}`);
        assert.ok(value.length > 0, `${s.id} ${mode} ${name}`);
        assert.equal(value.includes("undefined"), false, `${s.id} ${mode} ${name}`);
        assert.equal(value.includes("NaN"), false, `${s.id} ${mode} ${name}`);
      }
    }
  }
});

test("palette colours from vyre-v1.html land on both modes, and status colours follow the mode", () => {
  for (const s of skins) {
    for (const mode of MODES) {
      const set = s[mode];
      assert.equal(set["--win"], s.palette.win, s.id);
      assert.equal(set["--side"], s.palette.side, s.id);
      assert.equal(set["--rail"], s.palette.rail, s.id);
      assert.equal(set["--raised"], s.palette.raised, s.id);
      assert.equal(set["--sunk"], s.palette.sunk, s.id);
      assert.equal(set["--ink"], s.palette.ink, s.id);
      assert.equal(set["--ink-2"], s.palette.ink2, s.id);
      assert.equal(set["--ink-3"], s.palette.ink3, s.id);
      assert.equal(set["--ink-4"], s.palette.ink4, s.id);
      assert.equal(set["--me"], s.palette.me, s.id);
      assert.equal(set["--accent"], s.palette.accent, s.id);
      assert.equal(set["--beacon"], s.palette.accent, s.id);
      assert.equal(set["--ok"], mode === "dark" ? "#4CC38A" : "#2F9461", `${s.id} ${mode}`);
      assert.equal(set["--warn"], mode === "dark" ? "#E5A55C" : "#C2762B", `${s.id} ${mode}`);
      assert.equal(set["--danger"], mode === "dark" ? "#F06A6A" : "#D93F3F", `${s.id} ${mode}`);
    }
    assert.notEqual(s.light["--ok"], s.dark["--ok"], s.id);
    assert.notEqual(s.light["--hover"], s.dark["--hover"], s.id);
  }
});

test("native mode matches the prototype derivation for graphite and paper", () => {
  const graphite = skinById("graphite");
  const paper = skinById("paper");
  assert.ok(graphite && paper);
  assert.equal(nativeTokens(graphite), graphite.dark);
  assert.equal(nativeTokens(paper), paper.light);
  assert.equal(graphite.dark["--win"], "#161617");
  assert.equal(graphite.dark["--accent"], "#8B8BFF");
  assert.equal(graphite.dark["--accent-ink"], "#FFFFFF");
  assert.equal(graphite.dark["--hover"], "rgba(255,255,255,0.05)");
  assert.equal(graphite.dark["--accent-wash"], "rgba(139,139,255,0.14)");
  assert.equal(graphite.dark["--sel-strong"], "color-mix(in srgb, #EDEDEF 11%, #161617)");
  assert.equal(graphite.dark["--sh-1"], "0 1px 1px rgba(0,0,0,.3), 0 2px 6px -2px rgba(0,0,0,.4)");
  assert.equal(paper.light["--win"], "#FFFFFF");
  assert.equal(paper.light["--ink"], "#18181A");
  assert.equal(paper.light["--accent"], "#5B5BD6");
  assert.equal(paper.light["--accent-ink"], "#FFFFFF");
  assert.equal(paper.light["--hover"], "rgba(24,24,26,0.045)");
  assert.equal(paper.light["--accent-wash"], "rgba(91,91,214,0.1)");
  assert.equal(paper.light["--sel-strong"], "color-mix(in srgb, #18181A 8%, #FFFFFF)");
  assert.equal(paper.light["--sh-pop"], "0 0 0 1px rgba(24,24,26,.07), 0 10px 24px -8px rgba(24,24,26,.20), 0 2px 6px rgba(24,24,26,.06)");
  const obsidian = skinById("obsidian");
  const ember = skinById("ember");
  assert.ok(obsidian && ember);
  assert.equal(obsidian.dark["--accent-ink"], "#111");
  assert.equal(ember.dark["--accent-ink"], "#111");
  assert.equal(ember.palette.accent, "#E2A55B");
});

test("document tokens are the vyre-v1.html :root strings, distinct from Graphite and Paper", () => {
  assert.equal(documentTokens.light["--hover"], "rgba(0,0,0,.045)");
  assert.equal(documentTokens.light["--accent"], "#5B50E8");
  assert.equal(documentTokens.light["--accent-wash"], "rgba(91,80,232,.10)");
  assert.equal(documentTokens.light["--side"], "#F7F7F8");
  assert.equal(documentTokens.dark["--win"], "#161618");
  assert.equal(documentTokens.dark["--sh-pop"], "0 0 0 1px rgba(255,255,255,.08), 0 16px 40px rgba(0,0,0,.5)");
  const graphite = skinById("graphite") as Skin;
  const paper = skinById("paper") as Skin;
  assert.notEqual(documentTokens.dark["--win"], graphite.palette.win);
  assert.notEqual(documentTokens.light["--side"], paper.palette.side);
  assert.equal(system.light, documentTokens.light);
  assert.equal(system.dark, documentTokens.dark);
});

test("tokensOf returns the skin's set synchronously", () => {
  const linen = skinById("linen");
  assert.ok(linen);
  assert.equal(tokensOf("linen", "light"), linen.light);
  assert.equal(tokensOf("linen", "dark"), linen.dark);
  assert.equal(tokensOf("missing", "light"), undefined);
  assert.equal(tokensOf("linen", "light") instanceof Promise, false);
});
