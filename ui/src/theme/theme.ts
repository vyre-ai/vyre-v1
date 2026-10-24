// Theme and skin before first paint (spec: no theme flash, 2.1, 3.9).
// The stored choice is per person per Space. A missing choice uses the Space skin
// default, then the system palette (the shipped "classic" row) and the system mode.
// Web paints from a blocking script in the document head. Native paints from the
// style returned here, which the root view must take as its initial style.
// Token values come from ui/src/tokens/skins.ts. classic and system share the
// document :root sets. The 0.6 theme files named in the packet are not in this tree.

import { documentTokens, skins, typeTokens } from "../tokens/skins.ts";

export const APPEARANCE_KEY = "vyre.appearance.v1";

/** Rail places (spec 3.0) plus shell, console and join, which have screens. */
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
  "shell",
  "console",
  "join",
] as const;

export type PlaceId = (typeof PLACES)[number];

export const SHOT_WIDTHS = [1280, 390] as const;

/** Wrong-theme frames allowed on the first paint. perf/budgets.json is not in this tree; the spec ceiling is zero. */
export const THEME_FLASH_WRONG_FRAMES = 0;

/** Theme apply has to finish inside the first-paint budget so the themed frame is the first frame. */
export const THEME_FLASH_APPLY_MS = 50;

export type Mode = "light" | "dark";
export type ModeChoice = "system" | "light" | "dark";
export type ThemeSource = "person" | "space" | "system";

export interface SpaceAppearance {
  skin: string;
  mode: ModeChoice;
}

export interface AppearanceStore {
  personId: string;
  spaceId: string;
  spaces: Record<string, SpaceAppearance>;
  spaceSkin: Record<string, string>;
}

export interface Preview {
  skin: string;
  mode: ModeChoice | null;
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

export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  setProperty(name: string, value: string): void;
}

export interface NativeTheme {
  applied: AppliedTheme;
  rootStyle: Record<string, string>;
}

export interface SeedSpace {
  key: "northwind" | "harbor" | "personal";
  spaceId: string;
  name: string;
  skinDefault: string;
}

/**
 * Northwind keeps the shipped classic default. Harbor Studio uses linen so the
 * third seed is a different skin (spec 2.1) before settings is live.
 */
export const SEED_SPACES: readonly SeedSpace[] = [
  { key: "northwind", spaceId: "spc_northwind", name: "Northwind", skinDefault: "classic" },
  { key: "harbor", spaceId: "spc_harbor", name: "Harbor Studio", skinDefault: "linen" },
  { key: "personal", spaceId: "spc_personal", name: "Personal", skinDefault: "classic" },
];

const PLACE_TITLE: Record<string, string> = {
  home: "Home",
  chats: "Chats",
  inbox: "Inbox",
  records: "Records",
  files: "Files",
  apps: "Apps",
  automations: "Automations",
  vault: "Vault",
  settings: "Settings",
  shell: "Shell",
  console: "Console",
  join: "Join",
};

const MODE_CHOICES = new Set<string>(["system", "light", "dark"]);

type ModeTokens = { light: Record<string, string>; dark: Record<string, string> };

let tableCache: Record<string, ModeTokens> | null = null;

function documentSet(mode: Mode): Record<string, string> {
  const base = mode === "light" ? documentTokens.light : documentTokens.dark;
  return { ...base, ...typeTokens };
}

/** Skin id to light and dark token maps, including classic and system. Built once with the module data. */
export function tokenTable(): Record<string, ModeTokens> {
  if (tableCache) return tableCache;
  const classic: ModeTokens = { light: documentSet("light"), dark: documentSet("dark") };
  const system: ModeTokens = { light: documentSet("light"), dark: documentSet("dark") };
  const table: Record<string, ModeTokens> = { classic, system };
  for (const skin of skins) {
    table[skin.id] = {
      light: { ...skin.light, ...typeTokens },
      dark: { ...skin.dark, ...typeTokens },
    };
  }
  tableCache = table;
  return table;
}

export function seedSpaceSkin(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const space of SEED_SPACES) out[space.spaceId] = space.skinDefault;
  return out;
}

export function emptyStore(personId: string, spaceId: string): AppearanceStore {
  return { personId, spaceId, spaces: {}, spaceSkin: {} };
}

export function withSkin(store: AppearanceStore, spaceId: string, skin: string): AppearanceStore {
  const prev = store.spaces[spaceId];
  const mode: ModeChoice = prev ? prev.mode : "system";
  return {
    personId: store.personId,
    spaceId: store.spaceId,
    spaces: { ...store.spaces, [spaceId]: { skin, mode } },
    spaceSkin: { ...store.spaceSkin },
  };
}

export function withMode(store: AppearanceStore, spaceId: string, mode: ModeChoice): AppearanceStore {
  const prev = store.spaces[spaceId];
  const skin = prev && prev.skin ? prev.skin : store.spaceSkin[spaceId] ?? "classic";
  return {
    personId: store.personId,
    spaceId: store.spaceId,
    spaces: { ...store.spaces, [spaceId]: { skin, mode } },
    spaceSkin: { ...store.spaceSkin },
  };
}

/** Point the open Space at `spaceId`. The other Space's choice stays where it was. */
export function withOpenSpace(store: AppearanceStore, spaceId: string): AppearanceStore {
  return {
    personId: store.personId,
    spaceId,
    spaces: { ...store.spaces },
    spaceSkin: { ...store.spaceSkin },
  };
}

export function writeStore(store: AppearanceStore): string {
  return JSON.stringify({
    personId: store.personId,
    spaceId: store.spaceId,
    spaces: store.spaces,
    spaceSkin: store.spaceSkin,
  });
}

export function readStore(raw: string | null): AppearanceStore | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  if (typeof rec.personId !== "string" || typeof rec.spaceId !== "string") return null;
  if (!rec.spaces || typeof rec.spaces !== "object" || !rec.spaceSkin || typeof rec.spaceSkin !== "object") return null;
  const spaces: Record<string, SpaceAppearance> = {};
  for (const [id, row] of Object.entries(rec.spaces as Record<string, unknown>)) {
    if (!row || typeof row !== "object") return null;
    const item = row as Record<string, unknown>;
    if (typeof item.skin !== "string" || typeof item.mode !== "string" || !MODE_CHOICES.has(item.mode)) return null;
    spaces[id] = { skin: item.skin, mode: item.mode as ModeChoice };
  }
  const spaceSkin: Record<string, string> = {};
  for (const [id, skin] of Object.entries(rec.spaceSkin as Record<string, unknown>)) {
    if (typeof skin !== "string") return null;
    spaceSkin[id] = skin;
  }
  return { personId: rec.personId, spaceId: rec.spaceId, spaces, spaceSkin };
}

export function toInput(store: AppearanceStore, prefersDark: boolean, preview: Preview | null): ThemeInput {
  return {
    personId: store.personId,
    spaceId: store.spaceId,
    person: store.spaces,
    spaceSkin: store.spaceSkin,
    prefersDark,
    preview,
  };
}

function resolvedMode(choice: ModeChoice, prefersDark: boolean): Mode {
  if (choice === "light" || choice === "dark") return choice;
  return prefersDark ? "dark" : "light";
}

function pick(input: ThemeInput): { skin: string; modeChoice: ModeChoice; source: ThemeSource; preview: boolean } {
  if (input.preview) {
    const row = input.person[input.spaceId];
    const modeChoice = input.preview.mode ?? row?.mode ?? "system";
    return { skin: input.preview.skin || "classic", modeChoice, source: "person", preview: true };
  }
  const row = input.person[input.spaceId];
  if (row && row.skin) {
    return { skin: row.skin, modeChoice: row.mode, source: "person", preview: false };
  }
  const spaceDefault = input.spaceSkin[input.spaceId];
  if (spaceDefault) {
    return { skin: spaceDefault, modeChoice: row?.mode ?? "system", source: "space", preview: false };
  }
  return { skin: "classic", modeChoice: row?.mode ?? "system", source: "system", preview: false };
}

/** Synchronous. The return value is the theme, not a promise. */
export function resolveTheme(input: ThemeInput): AppliedTheme {
  const choice = pick(input);
  const table = tokenTable();
  const known = Object.prototype.hasOwnProperty.call(table, choice.skin);
  const skin = known ? choice.skin : "classic";
  const mode = resolvedMode(choice.modeChoice, input.prefersDark);
  const entry = table[skin];
  const tokens = { ...(entry ? entry[mode] : {}) };
  return {
    personId: input.personId,
    spaceId: input.spaceId,
    skin,
    mode,
    source: known ? choice.source : "system",
    tokens,
    preview: choice.preview,
  };
}

/**
 * Blocking script for the document head. Same choice order as resolveTheme:
 * person row for the open Space, else the Space skin default, else classic,
 * and mode system follows prefers-color-scheme. No fetch, no import, no await.
 */
export function headScript(): string {
  const json = JSON.stringify(tokenTable()).replaceAll("<", "\\u003c");
  return (
    "(function(){" +
    "var key=" + JSON.stringify(APPEARANCE_KEY) + ";" +
    "var table=" + json + ";" +
    "function own(obj,prop){return !!obj&&typeof obj===\"object\"&&Object.prototype.hasOwnProperty.call(obj,prop)?obj[prop]:null;}" +
    "var root=document.documentElement;" +
    "var prefersDark=false;" +
    "try{prefersDark=window.matchMedia(\"(prefers-color-scheme: dark)\").matches===true;}catch(e){prefersDark=false;}" +
    "var raw=null;" +
    "try{raw=localStorage.getItem(key);}catch(e){raw=null;}" +
    "var data=null;" +
    "if(raw){try{data=JSON.parse(raw);}catch(e){data=null;}}" +
    "var spaceId=data&&typeof data.spaceId===\"string\"?data.spaceId:\"\";" +
    "var spaces=own(data,\"spaces\");" +
    "var row=own(spaces,spaceId);" +
    "var spaceSkin=own(data,\"spaceSkin\");" +
    "var fromRow=own(row,\"skin\");" +
    "var fromSpace=own(spaceSkin,spaceId);" +
    "var skin=typeof fromRow===\"string\"&&fromRow?fromRow:(typeof fromSpace===\"string\"&&fromSpace?fromSpace:\"classic\");" +
    "var picked=own(row,\"mode\");" +
    "var modeChoice=picked===\"light\"||picked===\"dark\"||picked===\"system\"?picked:\"system\";" +
    "var mode=modeChoice===\"light\"||modeChoice===\"dark\"?modeChoice:(prefersDark?\"dark\":\"light\");" +
    "if(!Object.prototype.hasOwnProperty.call(table,skin))skin=\"classic\";" +
    "var tokens=table[skin][mode];" +
    "root.setAttribute(\"data-theme\",mode);" +
    "root.setAttribute(\"data-skin\",skin);" +
    "if(spaceId)root.setAttribute(\"data-space\",spaceId);" +
    "root.style.setProperty(\"color-scheme\",mode);" +
    "for(var name in tokens){if(Object.prototype.hasOwnProperty.call(tokens,name))root.style.setProperty(name,tokens[name]);}" +
    "})();"
  );
}

/** Insert the blocking theme script as the first child of head. A second call leaves the document alone. */
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

/** Call this before the first native render and pass rootStyle in as the root view's initial style. */
export function beforeFirstRender(input: ThemeInput): NativeTheme {
  const applied = resolveTheme(input);
  const rootStyle: Record<string, string> = { "color-scheme": applied.mode };
  for (const name of Object.keys(applied.tokens)) {
    const value = applied.tokens[name];
    if (value !== undefined) rootStyle[name] = value;
  }
  return { applied, rootStyle };
}

export function applyToRoot(applied: AppliedTheme, root: ThemeRoot): void {
  root.setAttribute("data-theme", applied.mode);
  root.setAttribute("data-skin", applied.skin);
  root.setAttribute("data-space", applied.spaceId);
  root.setProperty("color-scheme", applied.mode);
  const names = Object.keys(applied.tokens).sort();
  for (const name of names) {
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

/** The first frame of a place. data-frame is 1. There is no unthemed frame before it. */
export function firstFrame(place: string, applied: AppliedTheme, width: number): string {
  const title = PLACE_TITLE[place] ?? place;
  return (
    `<main data-place="${esc(place)}" data-frame="1" data-theme="${esc(applied.mode)}" data-skin="${esc(applied.skin)}" ` +
    `data-space="${esc(applied.spaceId)}" data-width="${width}" data-title="${esc(title)}" style="${esc(styleText(applied))}">` +
    `<h1>${esc(title)}</h1></main>`
  );
}
