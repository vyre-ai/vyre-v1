// Theme and skin before first paint (spec: no theme flash, 2.1, 3.9; ARCH 7.0).
// Resolution order, from vyre 0.6.9 apps/app/src/store-core/theme.js (the person wins for what is theirs,
// the Space supplies the default, a fixed fallback ends the chain; unknown values never throw, they fall through):
//   1. the person's stored choice for the open Space (Appearance is personal per Space)
//   2. the Space's skin default
//   3. System (Paper by day, Graphite by night, following the device)
// The 0.6 accent, density and font axes are not carried: v1 has one axis, the skin (13 skins plus System).
// Token values come from ui/src/tokens/skins.ts and are plain data, so every step here is synchronous:
// no fetch, no promise, no await between reading the choice and writing the root element.

import { documentTokens, skins, TOKEN_NAMES, typeTokens } from "../tokens/skins.ts";

/** localStorage key (web) and secure-store key (native) for the stored choice. */
export const APPEARANCE_KEY = "vyre.appearance.v1";

/** Rail places (spec 3.0) plus the shell surfaces that paint a frame of their own. */
export const PLACES = [
  "home",
  "chats",
  "inbox",
  "records",
  "files",
  "apps",
  "automations",
  "vault",
  "settings",
  "console",
  "join",
] as const;
export type PlaceId = (typeof PLACES)[number];

/** Widths the first-frame proof is taken at (desktop, phone). */
export const SHOT_WIDTHS = [1280, 390] as const;

/** The skin used when nothing is stored and the Space names none. */
export const DEFAULT_SKIN = "system";

/** perf budget theme_flash: wrong-theme frames allowed on the first paint. */
export const THEME_FLASH_WRONG_FRAMES = 0;
/** perf budget theme_flash: the apply step has to fit inside the first-paint budget (spec: first paint under 50 ms). */
export const THEME_FLASH_APPLY_MS = 50;

export type Mode = "light" | "dark";
/** "auto" follows the skin (its own base) or, for System, the device. */
export type ModeChoice = "auto" | "light" | "dark";
export type ThemeSource = "person" | "space" | "system";

export interface SpaceAppearance {
  skin: string;
  mode: ModeChoice;
}

/** What is stored: the open Space, this person's choice per Space, and each Space's skin default. */
export interface AppearanceStore {
  personId: string;
  spaceId: string;
  spaces: Record<string, SpaceAppearance>;
  spaceSkin: Record<string, string>;
}

export interface Preview {
  skin: string;
  mode?: ModeChoice;
}

export interface ThemeInput {
  personId: string;
  spaceId: string;
  person: Readonly<Record<string, SpaceAppearance>>;
  spaceSkin: Readonly<Record<string, string>>;
  prefersDark: boolean;
  preview: Preview | null;
}

export interface AppliedTheme {
  personId: string;
  spaceId: string;
  skin: string;
  mode: Mode;
  source: ThemeSource;
  tokens: Record<string, string>;
  preview: boolean;
}

/** The slice of an element's API the theme writes to (documentElement on web, a style holder on native). */
export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

export interface NativeTheme {
  applied: AppliedTheme;
  rootStyle: Record<string, string>;
}

export interface SeedSpace {
  spaceId: string;
  name: string;
  skinDefault: string;
}

/** The prototype's three seeds (V1-SPEC 2.1): Northwind (team), Harbor Studio (team, own skin), Personal. */
export const SEED_SPACES: readonly SeedSpace[] = [
  { spaceId: "nw", name: "Northwind", skinDefault: "system" },
  { spaceId: "hb", name: "Harbor Studio", skinDefault: "linen" },
  { spaceId: "me", name: "Personal", skinDefault: "system" },
];

const PLACE_TITLE: Record<PlaceId, string> = {
  home: "Home",
  chats: "Chats",
  inbox: "Inbox",
  records: "Records",
  files: "Files",
  apps: "Apps",
  automations: "Automations",
  vault: "Vault",
  settings: "Settings",
  console: "Console",
  join: "Join",
};

const MODE_CHOICES: ReadonlySet<string> = new Set(["auto", "light", "dark"]);

type ModeTokens = { light: Record<string, string>; dark: Record<string, string> };
export type TokenTable = Readonly<Record<string, ModeTokens>>;

let tableCache: TokenTable | null = null;

function documentSet(mode: Mode): Record<string, string> {
  return { ...documentTokens[mode], ...typeTokens };
}

/** Skin id to light and dark token maps: System and the thirteen skins. Built once from module data. */
export function tokenTable(): TokenTable {
  if (tableCache) return tableCache;
  const table: Record<string, ModeTokens> = { system: { light: documentSet("light"), dark: documentSet("dark") } };
  for (const skin of skins) {
    table[skin.id] = { light: { ...skin.light, ...typeTokens }, dark: { ...skin.dark, ...typeTokens } };
  }
  tableCache = table;
  return table;
}

/** The mode an explicit skin paints in unless the person overrides it. System has none (it follows the device). */
function baseOf(skinId: string): Mode | null {
  for (const skin of skins) if (skin.id === skinId) return skin.base;
  return null;
}

export function seedSpaceSkin(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const space of SEED_SPACES) out[space.spaceId] = space.skinDefault;
  return out;
}

export function emptyStore(personId: string, spaceId: string): AppearanceStore {
  return { personId, spaceId, spaces: {}, spaceSkin: {} };
}

function copy(store: AppearanceStore, over: Partial<AppearanceStore>): AppearanceStore {
  return { personId: store.personId, spaceId: store.spaceId, spaces: { ...store.spaces }, spaceSkin: { ...store.spaceSkin }, ...over };
}

/** Record this person's skin for a Space. The mode choice for that Space is kept. */
export function withSkin(store: AppearanceStore, spaceId: string, skin: string): AppearanceStore {
  const prev = store.spaces[spaceId];
  return copy(store, { spaces: { ...store.spaces, [spaceId]: { skin, mode: prev ? prev.mode : "auto" } } });
}

/** Record this person's mode choice for a Space. With no skin stored yet the Space default is pinned so the choice has a skin to apply to. */
export function withMode(store: AppearanceStore, spaceId: string, mode: ModeChoice): AppearanceStore {
  const prev = store.spaces[spaceId];
  const skin = prev ? prev.skin : (store.spaceSkin[spaceId] ?? DEFAULT_SKIN);
  return copy(store, { spaces: { ...store.spaces, [spaceId]: { skin, mode } } });
}

/** Point the open Space at `spaceId`. Every Space keeps its own choice. */
export function withOpenSpace(store: AppearanceStore, spaceId: string): AppearanceStore {
  return copy(store, { spaceId });
}

export function writeStore(store: AppearanceStore): string {
  return JSON.stringify({ personId: store.personId, spaceId: store.spaceId, spaces: store.spaces, spaceSkin: store.spaceSkin });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Parse what writeStore wrote. Anything malformed is null (the caller then uses the Space default or System). */
export function readStore(raw: string | null): AppearanceStore | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const { personId, spaceId, spaces: rawSpaces, spaceSkin: rawSkins } = data;
  if (typeof personId !== "string" || typeof spaceId !== "string" || !isRecord(rawSpaces) || !isRecord(rawSkins)) return null;
  const spaces: Record<string, SpaceAppearance> = {};
  for (const [id, row] of Object.entries(rawSpaces)) {
    if (!isRecord(row) || typeof row.skin !== "string" || typeof row.mode !== "string" || !MODE_CHOICES.has(row.mode)) return null;
    spaces[id] = { skin: row.skin, mode: row.mode as ModeChoice };
  }
  const spaceSkin: Record<string, string> = {};
  for (const [id, skin] of Object.entries(rawSkins)) {
    if (typeof skin !== "string") return null;
    spaceSkin[id] = skin;
  }
  return { personId, spaceId, spaces, spaceSkin };
}

export function toInput(store: AppearanceStore, prefersDark: boolean, preview: Preview | null = null): ThemeInput {
  return { personId: store.personId, spaceId: store.spaceId, person: store.spaces, spaceSkin: store.spaceSkin, prefersDark, preview };
}

function has(table: TokenTable, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, id);
}

function modeOf(skin: string, choice: ModeChoice, prefersDark: boolean): Mode {
  if (choice === "light" || choice === "dark") return choice;
  return baseOf(skin) ?? (prefersDark ? "dark" : "light");
}

/** Synchronous: the return value is the theme, never a promise. An unknown skin id falls through to System. */
export function resolveTheme(input: ThemeInput): AppliedTheme {
  const table = tokenTable();
  const row = Object.prototype.hasOwnProperty.call(input.person, input.spaceId) ? input.person[input.spaceId] : undefined;
  const fromSpace = Object.prototype.hasOwnProperty.call(input.spaceSkin, input.spaceId) ? input.spaceSkin[input.spaceId] : undefined;

  let wanted: string;
  let source: ThemeSource;
  let choice: ModeChoice = row ? row.mode : "auto";
  if (input.preview) {
    wanted = input.preview.skin;
    source = "person";
    if (input.preview.mode) choice = input.preview.mode;
  } else if (row && row.skin) {
    wanted = row.skin;
    source = "person";
  } else if (fromSpace) {
    wanted = fromSpace;
    source = "space";
  } else {
    wanted = DEFAULT_SKIN;
    source = "system";
  }
  const known = has(table, wanted);
  const skin = known ? wanted : DEFAULT_SKIN;
  const mode = modeOf(skin, choice, input.prefersDark);
  const entry = table[skin];
  return {
    personId: input.personId,
    spaceId: input.spaceId,
    skin,
    mode,
    source: known ? source : "system",
    tokens: { ...(entry ? entry[mode] : {}) },
    preview: input.preview !== null,
  };
}

/**
 * Blocking script for the document head. Same order as resolveTheme: the person's row for the open Space,
 * else the Space default, else System; mode "auto" follows the skin's base, or the device for System.
 * No fetch, no import, no await: it reads localStorage and matchMedia and writes the root before the body parses.
 */
export function headScript(): string {
  const json = JSON.stringify(tokenTable()).replaceAll("<", "\\u003c");
  const bases: Record<string, Mode> = {};
  for (const skin of skins) bases[skin.id] = skin.base;
  return (
    "(function(){" +
    "var key=" + JSON.stringify(APPEARANCE_KEY) + ";" +
    "var table=" + json + ";" +
    "var bases=" + JSON.stringify(bases) + ";" +
    "function own(o,p){return !!o&&typeof o===\"object\"&&Object.prototype.hasOwnProperty.call(o,p)?o[p]:null;}" +
    "var root=document.documentElement;" +
    "var dark=false;" +
    "try{dark=window.matchMedia(\"(prefers-color-scheme: dark)\").matches===true;}catch(e){dark=false;}" +
    "var raw=null;" +
    "try{raw=localStorage.getItem(key);}catch(e){raw=null;}" +
    "var data=null;" +
    "if(raw){try{data=JSON.parse(raw);}catch(e){data=null;}}" +
    "var sid=data&&typeof data.spaceId===\"string\"?data.spaceId:\"\";" +
    "var row=own(own(data,\"spaces\"),sid);" +
    "var a=own(row,\"skin\"),b=own(own(data,\"spaceSkin\"),sid);" +
    "var skin=typeof a===\"string\"&&a?a:(typeof b===\"string\"&&b?b:" + JSON.stringify(DEFAULT_SKIN) + ");" +
    "if(!Object.prototype.hasOwnProperty.call(table,skin))skin=" + JSON.stringify(DEFAULT_SKIN) + ";" +
    "var m=own(row,\"mode\");" +
    "var mode=m===\"light\"||m===\"dark\"?m:(own(bases,skin)||(dark?\"dark\":\"light\"));" +
    "var tokens=table[skin][mode];" +
    "root.setAttribute(\"data-theme\",mode);" +
    "root.setAttribute(\"data-skin\",skin);" +
    "if(sid)root.setAttribute(\"data-space\",sid);" +
    "root.style.setProperty(\"color-scheme\",mode);" +
    "for(var n in tokens){if(Object.prototype.hasOwnProperty.call(tokens,n))root.style.setProperty(n,tokens[n]);}" +
    "})();"
  );
}

/** Put the blocking theme script first in head, so nothing paints before it. A second call leaves the document alone. */
export function installHead(html: string, script: string = headScript()): string {
  if (html.includes("data-theme-boot=")) return html;
  const tag = `<script data-theme-boot="true">${script}</script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return `<head>${tag}</head>${html}`;
}

/** Native: call before the first render and hand rootStyle to the root view as its initial style. */
export function beforeFirstRender(input: ThemeInput): NativeTheme {
  const applied = resolveTheme(input);
  const rootStyle: Record<string, string> = { "color-scheme": applied.mode };
  for (const [name, value] of Object.entries(applied.tokens)) rootStyle[name] = value;
  return { applied, rootStyle };
}

/** Write a resolved theme onto the root. Tokens a skin does not set (System sets fewer) are removed, so a switch never leaves the last skin's values behind. */
export function applyToRoot(applied: AppliedTheme, root: ThemeRoot): void {
  root.setAttribute("data-theme", applied.mode);
  root.setAttribute("data-skin", applied.skin);
  root.setAttribute("data-space", applied.spaceId);
  root.setProperty("color-scheme", applied.mode);
  for (const name of TOKEN_NAMES) if (!Object.prototype.hasOwnProperty.call(applied.tokens, name)) root.removeProperty(name);
  for (const name of Object.keys(applied.tokens).sort()) {
    const value = applied.tokens[name];
    if (value !== undefined) root.setProperty(name, value);
  }
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function styleText(applied: AppliedTheme): string {
  const parts = [`color-scheme:${applied.mode}`];
  for (const name of Object.keys(applied.tokens).sort()) {
    const value = applied.tokens[name];
    if (value !== undefined) parts.push(`${name}:${value}`);
  }
  return parts.join(";");
}

/**
 * The first frame of a place as markup: themed from its first byte (data-frame is 1, there is no unthemed frame before it).
 * Screens render through the same root attributes and tokens, so the proof test can compare any frame to the resolved theme.
 */
export function firstFrame(place: PlaceId, applied: AppliedTheme, width: number): string {
  const title = PLACE_TITLE[place];
  return (
    `<main data-place="${esc(place)}" data-frame="1" data-theme="${esc(applied.mode)}" data-skin="${esc(applied.skin)}" ` +
    `data-space="${esc(applied.spaceId)}" data-width="${width}" data-title="${esc(title)}" style="${esc(styleText(applied))}">` +
    `<h1>${esc(title)}</h1></main>`
  );
}
