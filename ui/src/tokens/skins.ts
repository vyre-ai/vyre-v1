// Skins for @vyre/ui. Vyre Black and Vyre Light (team/v1/prototypes/src/vyre-palette.json) first, then thirteen palettes copied
// from vyre-v1.html (VyreUI.skins), plus the document rules used when the choice is System: the default, shown as "Vyre", which
// paints Vyre Light or Vyre Black by device. Every skin defines the frozen token set for light and for dark. The set is the one VyreUI.skins.vars writes, so a place can
// paint either mode from this module with no fetch and no wait (spec: no theme flash).
//
// `base` is the mode the prototype menu applies. The other mode keeps the same palette and
// runs the same derivation with the light or dark flag flipped, which is how hover, line,
// wash, status and shadow tokens follow the mode in that script.

export const TOKEN_NAMES = [
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
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type Mode = "light" | "dark";
export type TokenSet = Record<TokenName, string>;

export interface Palette {
  win: string;
  side: string;
  rail: string;
  raised: string;
  sunk: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  accent: string;
  me: string;
  /** The Vyre palettes name these themselves; every other skin derives them from the mode. */
  field?: string;
  beacon?: string;
  ok?: string;
  warn?: string;
  danger?: string;
  accentInk?: string;
}

export interface Skin {
  id: string;
  name: string;
  base: Mode;
  note: string;
  palette: Palette;
  light: TokenSet;
  dark: TokenSet;
}

/** Type tokens from the vyre-v1.html :root rule. Skins do not restyle them. */
export const typeTokens = {
  "--ui": '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  "--mono": '"JetBrains Mono", ui-monospace, Menlo, monospace',
} as const;

function rgb(hex: string): string {
  const h = hex.slice(1);
  const n = (i: number): number => Number.parseInt(h.slice(i, i + 2), 16);
  return `${n(0)},${n(2)},${n(4)}`;
}

function luminance(hex: string): number {
  const parts = rgb(hex).split(",");
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Port of VyreUI.skins.vars. `dark` is the flag the script takes from skin.base. */
export function derive(palette: Palette, dark: boolean): TokenSet {
  const c = palette;
  const t = dark ? "255,255,255" : rgb(c.ink);
  const a = rgb(c.accent);
  return {
    "--win": c.win,
    "--side": c.side,
    "--rail": c.rail,
    "--raised": c.raised,
    "--sunk": c.sunk,
    // a text field: a step lighter than the card in a dark skin (the sunk fill is near black on the card), the sunk fill in a light one, with a visible 1px edge
    "--field": c.field ?? (dark ? `color-mix(in srgb, #FFFFFF 7%, ${c.raised})` : c.sunk),
    "--field-line": `rgba(${t},${dark ? 0.16 : 0.13})`,
    "--ink": c.ink,
    "--ink-2": c.ink2,
    "--ink-3": c.ink3,
    "--ink-4": c.ink4,
    "--me": c.me,
    "--hover": `rgba(${t},${dark ? 0.05 : 0.045})`,
    "--press": `rgba(${t},${dark ? 0.09 : 0.08})`,
    "--sel": `rgba(${t},${dark ? 0.08 : 0.075})`,
    "--sel-strong": `color-mix(in srgb, ${c.ink} ${dark ? 11 : 8}%, ${c.win})`,
    "--line": `rgba(${t},${dark ? 0.07 : 0.08})`,
    "--line-2": `rgba(${t},${dark ? 0.12 : 0.13})`,
    "--accent": c.accent,
    "--accent-ink": c.accentInk ?? (luminance(c.accent) > 150 ? "#111" : "#FFFFFF"),
    "--accent-wash": `rgba(${a},${dark ? 0.14 : 0.1})`,
    "--accent-line": `rgba(${a},${dark ? 0.4 : 0.35})`,
    "--beacon": c.beacon ?? c.accent,
    "--ok": c.ok ?? (dark ? "#4CC38A" : "#2F9461"),
    "--warn": c.warn ?? (dark ? "#E5A55C" : "#C2762B"),
    "--danger": c.danger ?? (dark ? "#F06A6A" : "#D93F3F"),
    "--sh-1": dark
      ? "0 1px 1px rgba(0,0,0,.3), 0 2px 6px -2px rgba(0,0,0,.4)"
      : `0 1px 1px rgba(${t},.04), 0 2px 6px -2px rgba(${t},.06)`,
    "--sh-2": dark
      ? "0 0 0 1px rgba(255,255,255,.06), 0 6px 16px -6px rgba(0,0,0,.5), 0 20px 40px -20px rgba(0,0,0,.6)"
      : `0 0 0 1px rgba(${t},.06), 0 6px 16px -6px rgba(${t},.14), 0 20px 40px -20px rgba(${t},.18)`,
    "--sh-pop": dark
      ? "0 0 0 1px rgba(255,255,255,.08), 0 10px 24px -8px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.4)"
      : `0 0 0 1px rgba(${t},.07), 0 10px 24px -8px rgba(${t},.20), 0 2px 6px rgba(${t},.06)`,
  };
}

/** The two Vyre palettes, as the prototype's build writes them (vyre-palette.json, build.py). */
const VYRE_BLACK: Palette = {
  win: "#121118", side: "#16151D", rail: "#07070A", raised: "#201E29", sunk: "#0B0A10", field: "#201E29", ink: "#F2F0F7", ink2: "#C6C2D2", ink3: "#928DA2", ink4: "#625D70", me: "#2A2736",
  accent: "#A092FF", accentInk: "#120E24", beacon: "#FF8A66", ok: "#5AD6A2", warn: "#F4BE62", danger: "#FF6F85",
};
const VYRE_LIGHT: Palette = {
  win: "#FBFAFD", side: "#F4F2F8", rail: "#E8E5EF", raised: "#FFFFFF", sunk: "#EEEBF3", field: "#EEEBF3", ink: "#17141F", ink2: "#454052", ink3: "#6A6578", ink4: "#A29DAF", me: "#E8E3F8",
  accent: "#5A3FF0", accentInk: "#FFFFFF", beacon: "#EE5A38", ok: "#16805A", warn: "#9C5C07", danger: "#CC2A4A",
};

/** The prototype's washes on top of the shared derivation. */
function vyreSet(palette: Palette, dark: boolean): TokenSet {
  const a = rgb(palette.accent), t = dark ? "255,255,255" : rgb(palette.ink);
  return { ...derive(palette, dark), "--sel": `rgba(${t},${dark ? 0.085 : 0.075})`, "--accent-wash": `rgba(${a},${dark ? 0.15 : 0.1})`, "--accent-line": `rgba(${a},.4)` };
}

function vyreSkin(id: string, name: string, base: Mode, note: string, palette: Palette): Skin {
  return { id, name, base, note, palette, light: vyreSet(palette, false), dark: vyreSet(palette, true) };
}

const vyreBlack = vyreSkin("vyre-black", "Vyre Black", "dark", "Deep ink, iris and coral", VYRE_BLACK);
const vyreLight = vyreSkin("vyre-light", "Vyre Light", "light", "Soft white, iris and coral", VYRE_LIGHT);

/** What the document paints when the choice is System: Vyre Light by day, Vyre Black by night. */
export const documentTokens: { light: Record<string, string>; dark: Record<string, string> } = {
  light: vyreLight.light,
  dark: vyreBlack.dark,
};

/** System is the first menu row, shown as "Vyre". It is not an entry in `skins`. */
export const system = {
  id: "system",
  name: "Vyre",
  note: "Vyre Light by day, Vyre Black by night",
  light: documentTokens.light,
  dark: documentTokens.dark,
} as const;

function skin(id: string, name: string, base: Mode, note: string, palette: Palette): Skin {
  return {
    id,
    name,
    base,
    note,
    palette,
    light: derive(palette, false),
    dark: derive(palette, true),
  };
}

function pal(
  win: string,
  side: string,
  rail: string,
  raised: string,
  sunk: string,
  ink: string,
  ink2: string,
  ink3: string,
  ink4: string,
  accent: string,
  me: string,
): Palette {
  return { win, side, rail, raised, sunk, ink, ink2, ink3, ink4, accent, me };
}

/** Eight dark, seven light: Vyre's own first in each, then the vyre-v1.html menu order. System is `system`, not an entry here. */
export const skins: readonly Skin[] = [
  vyreBlack,
  skin("graphite", "Graphite", "dark", "Neutral dark grey", pal("#161617", "#1C1C1E", "#121213", "#232325", "#121213", "#EDEDEF", "#B9B9BE", "#85858B", "#5C5C62", "#8B8BFF", "#2A2A2D")),
  skin("obsidian", "Obsidian", "dark", "True black, for OLED screens", pal("#0A0A0A", "#101010", "#000000", "#171717", "#050505", "#E6E6E6", "#ADADAD", "#7A7A7A", "#4F4F4F", "#A0A0FF", "#1C1C1C")),
  skin("charcoal", "Charcoal", "dark", "Softer grey, lower contrast", pal("#202124", "#26272B", "#1B1C1F", "#2D2E33", "#1A1B1E", "#E3E3E6", "#B4B5BA", "#8A8B91", "#62636A", "#9AA6FF", "#34353A")),
  skin("slate", "Slate", "dark", "Cool blue grey", pal("#151A21", "#1A2029", "#10151B", "#212833", "#11161C", "#E4E9F0", "#B0BAC7", "#7E8999", "#566170", "#6FA8FF", "#252D39")),
  skin("ember", "Ember", "dark", "Warm brown grey, amber light", pal("#1B1917", "#211E1B", "#161412", "#29251F", "#151311", "#EDE6DD", "#C2B8AB", "#8E8478", "#625A51", "#E2A55B", "#2E2A25")),
  skin("moss", "Moss", "dark", "Green grey, easy at night", pal("#141815", "#191E1A", "#101310", "#1F2620", "#0F1310", "#E3EBE4", "#B1BFB3", "#7F8E82", "#57645A", "#7BC59A", "#232B25")),
  skin("dusk", "Dusk", "dark", "Deep violet ink", pal("#17151C", "#1D1A23", "#121017", "#24202C", "#121016", "#ECE8F2", "#BCB4C9", "#8A8299", "#5F586C", "#B49CFF", "#2A2533")),
  vyreLight,
  skin("paper", "Paper", "light", "Clean white", pal("#FFFFFF", "#F7F7F6", "#F0F0EE", "#FFFFFF", "#F2F2F0", "#18181A", "#4E4E52", "#8A8A8F", "#B4B4B8", "#5B5BD6", "#EFEFF1")),
  skin("fog", "Fog", "light", "Light grey, less glare", pal("#F4F4F5", "#ECECEE", "#E4E4E7", "#FBFBFB", "#E8E8EA", "#1D1D20", "#4A4A50", "#7D7D85", "#A9A9B0", "#5856D6", "#E3E3E7")),
  skin("linen", "Linen", "light", "Warm off-white", pal("#FAF7F2", "#F3EEE6", "#ECE6DC", "#FFFDF9", "#EFE9DF", "#2A2520", "#574F46", "#8A8177", "#B4AA9E", "#B45F3C", "#EDE6DA")),
  skin("sand", "Sand", "light", "Sepia, low blue light", pal("#F1EADF", "#E9E0D2", "#E1D6C5", "#F7F1E7", "#E5DBCB", "#2E2720", "#5A4F43", "#877A6A", "#ADA090", "#9A5B2E", "#E4D9C7")),
  skin("sage", "Sage", "light", "Soft green tint", pal("#F3F6F2", "#EAEFE8", "#E2E8DF", "#FAFCF9", "#E6ECE3", "#1E2420", "#48524B", "#78837B", "#A3ADA5", "#3D7F5C", "#E1E8DE")),
  skin("mist", "Mist", "light", "Cool blue grey", pal("#F3F5F8", "#EAEEF3", "#E2E7EE", "#FAFBFD", "#E6EAF0", "#1B2029", "#464F5C", "#75808F", "#A2ABB8", "#3E6FD8", "#E0E6EE")),
];

export function skinById(id: string): Skin | undefined {
  return skins.find((s) => s.id === id);
}

/** The token set the prototype applies for this skin (its `base` mode). */
export function nativeTokens(s: Skin): TokenSet {
  return s.base === "dark" ? s.dark : s.light;
}

/** Synchronous theme data. The object is the one built with the module, not a promise. */
export function tokensOf(id: string, mode: Mode): TokenSet | undefined {
  const s = skinById(id);
  if (!s) return undefined;
  return mode === "light" ? s.light : s.dark;
}
