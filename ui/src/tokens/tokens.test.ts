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
  "--field",
  "--field-line",
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

test("fifteen skins, eight dark and seven light with Vyre's own first, system kept beside them", () => {
  assert.equal(skins.length, 15);
  assert.deepEqual(
    skins.map((s) => s.id),
    ["vyre-black", "graphite", "obsidian", "charcoal", "slate", "ember", "moss", "dusk", "vyre-light", "paper", "fog", "linen", "sand", "sage", "mist"],
  );
  assert.equal(skins.filter((s) => s.base === "dark").length, 8);
  assert.equal(skins.filter((s) => s.base === "light").length, 7);
  assert.equal(system.id, "system");
  assert.equal(system.name, "Vyre", "the default shows as Vyre");
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

test("the Vyre palettes are vyre-palette.json, token for token", () => {
  const black = skinById("vyre-black") as Skin;
  const light = skinById("vyre-light") as Skin;
  const want = (set: TokenSet, p: Record<string, string>): void => {
    for (const [k, v] of Object.entries(p)) assert.equal(set[k as keyof TokenSet], v, k);
  };
  want(black.dark, { "--win": "#121118", "--side": "#16151D", "--rail": "#07070A", "--raised": "#201E29", "--sunk": "#0B0A10", "--field": "#201E29", "--ink": "#F2F0F7", "--ink-2": "#C6C2D2", "--ink-3": "#928DA2", "--ink-4": "#625D70", "--me": "#2A2736", "--accent": "#A092FF", "--accent-ink": "#120E24", "--beacon": "#FF8A66", "--ok": "#5AD6A2", "--warn": "#F4BE62", "--danger": "#FF6F85", "--accent-wash": "rgba(160,146,255,0.15)", "--accent-line": "rgba(160,146,255,.4)", "--hover": "rgba(255,255,255,0.05)", "--sel": "rgba(255,255,255,0.085)", "--line": "rgba(255,255,255,0.07)", "--line-2": "rgba(255,255,255,0.12)" });
  want(light.light, { "--win": "#FBFAFD", "--side": "#F4F2F8", "--rail": "#E8E5EF", "--raised": "#FFFFFF", "--sunk": "#EEEBF3", "--field": "#EEEBF3", "--ink": "#17141F", "--ink-2": "#454052", "--ink-3": "#6A6578", "--ink-4": "#A29DAF", "--me": "#E8E3F8", "--accent": "#5A3FF0", "--accent-ink": "#FFFFFF", "--beacon": "#EE5A38", "--ok": "#16805A", "--warn": "#9C5C07", "--danger": "#CC2A4A", "--accent-wash": "rgba(90,63,240,0.1)", "--accent-line": "rgba(90,63,240,.4)", "--hover": "rgba(23,20,31,0.045)", "--sel": "rgba(23,20,31,0.075)", "--line": "rgba(23,20,31,0.08)", "--line-2": "rgba(23,20,31,0.13)" });
});

test("palette colours from vyre-v1.html land on both modes, and status colours follow the mode", () => {
  for (const s of skins) {
    if (s.id.startsWith("vyre-")) continue; // their own status colours and beacon: the test above
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

test("System paints Vyre Light by day and Vyre Black by night, distinct from Graphite and Paper", () => {
  const black = skinById("vyre-black") as Skin;
  const light = skinById("vyre-light") as Skin;
  assert.equal(documentTokens.light, light.light);
  assert.equal(documentTokens.dark, black.dark);
  assert.equal(documentTokens.light["--beacon"], "#EE5A38");
  assert.equal(documentTokens.dark["--beacon"], "#FF8A66");
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

test("every skin and System define every token the app uses", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("../../../", import.meta.url).pathname;
  const used = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
      for (const m of readFileSync(full, "utf8").matchAll(/var\((--[a-z0-9-]+)\s*\)/g)) used.add(m[1]!);
    }
  };
  walk(join(root, "ui/src")); walk(join(root, "apps/app/src"));
  const known = new Set<string>([...TOKEN_NAMES, ...Object.keys(typeTokens)]);
  const undefinedTokens = [...used].filter((n) => !known.has(n) && /^--(win|side|rail|raised|sunk|field|hover|press|sel|ink|line|accent|beacon|me|ok|warn|danger|sh)/.test(n));
  assert.deepEqual(undefinedTokens, [], "colour and shadow tokens used in code but defined nowhere");
  for (const mode of MODES) {
    for (const name of TOKEN_NAMES) assert.ok(name in documentTokens[mode], `System ${mode} ${name}`);
    for (const skin of skins) for (const name of TOKEN_NAMES) assert.ok(name in skin[mode], `${skin.id} ${mode} ${name}`);
  }
});
