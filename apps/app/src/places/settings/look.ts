// Settings > Appearance, the logic with no renderer: when Vyre is light or dark (match the device, always light, always dark), which skin each slot wears (By day, At night, or the one), the display choices (text size,
// density, reduce motion, language) and the skins a person made or was sent. The whole thing is one person setting, `appearance.look`, so it follows the person to every device; a value the app does not know falls
// back to the default and is never thrown on. A skin made here is only colours (a base, an accent and a contrast), so one that arrives by a link is as safe as one made by hand.
import type { Palette } from "../../../../../ui/src/tokens/skins.ts";

export type LookMode = "device" | "light" | "dark";
export type Density = "comfortable" | "compact";
export type Contrast = "soft" | "standard" | "high";
export type Slot = "day" | "night" | "light" | "dark";

export interface CustomSkin { id: string; name: string; base: "light" | "dark"; accent: string; contrast: Contrast; note: string }
export interface Look {
  mode: LookMode; day: string; night: string; light: string; dark: string;
  /** percent: 85 to 130 */ text: number; density: Density; rm: boolean; lang: string; mine: CustomSkin[];
}

export const LOOK_KEY = "appearance.look";
export const TEXT_MIN = 85, TEXT_MAX = 130, TEXT_STEP = 5;
export const DEFAULT_LOOK: Look = { mode: "device", day: "vyre-light", night: "vyre-black", light: "vyre-light", dark: "vyre-black", text: 100, density: "comfortable", rm: false, lang: "English", mine: [] };
export const LANGUAGES: readonly string[] = ["English"];
export const ACCENTS: readonly string[] = ["#5A3FF0", "#2F6FED", "#0E8A8A", "#2E9E5B", "#E4572E", "#D6336C", "#C98A0B", "#6B7280"];

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v: unknown, d: string): string => (typeof v === "string" && v !== "" ? v : d);

/** The look from what the Space stored, every part checked. */
export function lookFrom(value: unknown): Look {
  const v = (value !== null && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const mine = Array.isArray(v["mine"]) ? (v["mine"] as unknown[]).flatMap((x): CustomSkin[] => {
    const c = x as Partial<CustomSkin> | null;
    return c && typeof c.id === "string" && typeof c.name === "string" && (c.base === "light" || c.base === "dark") && typeof c.accent === "string" && HEX.test(c.accent) && (c.contrast === "soft" || c.contrast === "standard" || c.contrast === "high")
      ? [{ id: c.id, name: c.name.slice(0, 40), base: c.base, accent: c.accent, contrast: c.contrast, note: typeof c.note === "string" ? c.note : "Made by you" }] : [];
  }) : [];
  const text = typeof v["text"] === "number" ? Math.min(TEXT_MAX, Math.max(TEXT_MIN, Math.round(v["text"] / TEXT_STEP) * TEXT_STEP)) : DEFAULT_LOOK.text;
  return {
    mode: v["mode"] === "light" || v["mode"] === "dark" ? v["mode"] : "device",
    day: str(v["day"], DEFAULT_LOOK.day), night: str(v["night"], DEFAULT_LOOK.night), light: str(v["light"], DEFAULT_LOOK.light), dark: str(v["dark"], DEFAULT_LOOK.dark),
    text, density: v["density"] === "compact" ? "compact" : "comfortable", rm: v["rm"] === true, lang: str(v["lang"], DEFAULT_LOOK.lang), mine,
  };
}

/** The slot a pick goes to: By day or At night while Vyre matches the device, else the one for the chosen mode. */
export const slotKey = (look: Look, editing: "day" | "night"): Slot => (look.mode === "device" ? editing : look.mode);
/** Whether a slot is a dark one. */
export const baseOfSlot = (k: Slot): "light" | "dark" => (k === "night" || k === "dark" ? "dark" : "light");
/** The skin on the window now: the slot the device's own light or dark selects. */
export const effectiveSkin = (look: Look, prefersDark: boolean): string => (look.mode === "light" ? look.light : look.mode === "dark" ? look.dark : prefersDark ? look.night : look.day);
/** Whether the slot being edited is the one on screen (a pick then changes the window; otherwise it is only kept). */
export const slotIsLive = (look: Look, editing: "day" | "night", prefersDark: boolean): boolean => look.mode !== "device" || (editing === "night") === prefersDark;
export const SLOT_WORDS: Readonly<Record<Slot, string>> = { day: "by day", night: "at night", light: "", dark: "" };

/** One pick: the new look, or null when it is the skin already there. */
export function choose(look: Look, key: Slot, id: string): Look | null {
  return look[key] === id ? null : { ...look, [key]: id };
}
export const withMode = (look: Look, mode: LookMode): Look => ({ ...look, mode });

/** "Changed to Graphite at night". */
export function changedLine(name: string, key: Slot, live: boolean): string {
  return `Changed to ${name}${!live && SLOT_WORDS[key] ? ` ${SLOT_WORDS[key]}` : ""}`;
}

/* ---------- skins made here ---------- */

const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number): string => "#" + hex(a).map((v, i) => Math.round(v + (hex(b)[i]! - v) * t).toString(16).padStart(2, "0")).join("");
const hashOf = (s: string): number => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

export function buildSkin(name: string, base: "light" | "dark", accent: string, contrast: Contrast): CustomSkin {
  const a = HEX.test(accent) ? accent : ACCENTS[0]!;
  const n = name.trim() === "" ? "My skin" : name.trim().slice(0, 40);
  return { id: `my-${hashOf(n + a + base + contrast).toString(36)}`, name: n, base, accent: a, contrast, note: "Made by you" };
}

/** The colours of a made skin, in the shape every skin has. */
export function paletteOf(s: CustomSkin): Palette {
  const d = s.base === "dark", k = { soft: 0, standard: 1, high: 2 }[s.contrast];
  const win = d ? ["#1F1F23", "#161617", "#0A0A0B"][k]! : ["#F0F0F3", "#FFFFFF", "#FFFFFF"][k]!;
  const ink = d ? ["#C4C4CB", "#EDEDEF", "#FFFFFF"][k]! : ["#4A4A52", "#18181B", "#000000"][k]!;
  return {
    win, side: mix(win, ink, d ? 0.04 : 0.035), rail: mix(win, d ? "#000000" : ink, d ? 0.3 : 0.07), raised: d ? mix(win, "#FFFFFF", 0.05) : "#FFFFFF", sunk: mix(win, d ? "#000000" : ink, d ? 0.25 : 0.05),
    ink, ink2: mix(ink, win, 0.28), ink3: mix(ink, win, 0.5), ink4: mix(ink, win, 0.7), accent: s.accent, me: mix(win, s.accent, d ? 0.2 : 0.13),
  };
}

/** A skin as a link: `vyre.run/skin/<code>`. The code is the skin's four choices, so the link is the skin and nothing else. */
export function skinLink(s: CustomSkin): string {
  const code = btoa(JSON.stringify([s.name, s.base, s.accent, s.contrast])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `vyre.run/skin/${code}`;
}

export type LinkResult = { ok: true; skin: CustomSkin } | { ok: false; error: string };
/** The skin a pasted link holds, or why it is not one. */
export function parseSkinLink(text: string): LinkResult {
  const m = /^(?:https?:\/\/)?(?:www\.)?vyre\.run\/skin\/([A-Za-z0-9_-]+)\/?$/.exec(text.trim());
  if (!m) return { ok: false, error: "That is not a skin link. It looks like vyre.run/skin/..." };
  try {
    const raw = m[1]!.replaceAll("-", "+").replaceAll("_", "/");
    const [name, base, accent, contrast] = JSON.parse(atob(raw + "=".repeat((4 - (raw.length % 4)) % 4))) as [unknown, unknown, unknown, unknown];
    if (typeof name !== "string" || (base !== "light" && base !== "dark") || typeof accent !== "string" || !HEX.test(accent) || (contrast !== "soft" && contrast !== "standard" && contrast !== "high")) throw new Error("shape");
    return { ok: true, skin: { ...buildSkin(name, base, accent, contrast), note: "Shared with you" } };
  } catch {
    return { ok: false, error: "That link does not hold a skin. Ask them to send it again." };
  }
}

/** Adds a made or received skin once. */
export const withSkinAdded = (look: Look, s: CustomSkin): Look => (look.mine.some((x) => x.id === s.id) ? look : { ...look, mine: [...look.mine, s] });
