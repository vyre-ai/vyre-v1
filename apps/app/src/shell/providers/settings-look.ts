// Puts the person's look on the window: the skin for the device's light or dark (or the one fixed skin), a skin made here, the page's text size, the rows' density, reduced motion and the page language. The same code
// answers a hover in the gallery (the whole app wears the skin for a moment, nothing stored) and a pick. The look is also kept on this device, so the next start paints right before the Space has answered.
import { createThemeController } from "../../../../../ui/src/theme/controller.ts";
import { derive, skinById } from "../../../../../ui/src/tokens/skins.ts";
import { TOKEN_NAMES } from "../../../../../ui/src/tokens/skins.ts";
import { DEFAULT_LOOK, effectiveSkin, lookFrom, paletteOf } from "../../places/settings/look.ts";
import type { CustomSkin, Look } from "../../places/settings/look.ts";
import type { ShellRuntime } from "./runtime.tsx";

export const MOTION_CSS = "*,*::before,*::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important;scroll-behavior:auto!important}";
export const DENSITY_CSS = ".vyre-row{min-height:24px!important}";

interface Root { style: { setProperty(k: string, v: string): void; removeProperty(k: string): void; zoom?: string }; setAttribute(k: string, v: string): void; removeAttribute(k: string): void }
interface Doc { documentElement: Root; getElementById(id: string): unknown; createElement(tag: string): { id: string; textContent: string }; head?: { appendChild(n: unknown): void; removeChild?(n: unknown): void } }
const doc = (): Doc | undefined => (globalThis as { document?: Doc }).document;
const prefersDark = (): boolean => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
const LANG: Readonly<Record<string, string>> = { English: "en" };

/** The three display choices that are not a skin, on the window. */
export function applyDisplay(look: Look, d: Doc | undefined = doc()): boolean {
  if (!d) return false;
  const root = d.documentElement;
  root.style.zoom = String(look.text / 100);
  root.setAttribute("data-density", look.density);
  root.setAttribute("lang", LANG[look.lang] ?? "en");
  const sheet = (id: string, css: string, on: boolean): void => {
    const have = d.getElementById(id);
    if (on && !have) { const s = d.createElement("style"); s.id = id; s.textContent = css; d.head?.appendChild(s); }
    else if (!on && have) d.head?.removeChild?.(have);
  };
  sheet("vyre-density", DENSITY_CSS, look.density === "compact");
  sheet("vyre-reduce-motion", MOTION_CSS, look.rm);
  if (look.rm) root.setAttribute("data-motion", "reduce"); else root.removeAttribute("data-motion");
  return true;
}

/** A skin made here, painted straight onto the window (it is only colours). */
export function paintCustom(s: CustomSkin, d: Doc | undefined = doc()): boolean {
  if (!d) return false;
  const root = d.documentElement, dark = s.base === "dark", tokens = derive(paletteOf(s), dark);
  root.setAttribute("data-theme", s.base); root.setAttribute("data-mode", s.base); root.setAttribute("data-skin", s.id);
  root.style.setProperty("color-scheme", s.base);
  for (const name of TOKEN_NAMES) { const v = tokens[name]; if (v !== undefined) root.style.setProperty(name, v); else root.style.removeProperty(name); }
  return true;
}

const keyFor = (person: string): string => `vyre.look.${person}`;
export function rememberLook(person: string, look: Look): void { try { globalThis.localStorage?.setItem(keyFor(person), JSON.stringify(look)); } catch { /* a blocked store only loses the shortcut */ } }
/** The look this device kept for the person, or null when none was ever saved (then the Space and the device decide the skin, as before). */
export function storedLook(person: string): Look | null { try { const raw = globalThis.localStorage?.getItem(keyFor(person)); return raw ? lookFrom(JSON.parse(raw)) : null; } catch { return null; } }
/** A skin named in the address (?skin=graphite): it wins for this view of the page and is never saved. */
export function explicitSkin(search: string): string | null { const v = new URLSearchParams(search).get("skin"); return v !== null && v !== "" ? v : null; }
/** What the shell does at start with the person's look: the display choices always, the skin only when the person has saved a look and no address names one. */
export function startupPlan(person: string, search: string): { look: Look | null; paintSkin: boolean } {
  const look = storedLook(person);
  return { look, paintSkin: look !== null && explicitSkin(search) === null };
}
export function restoreLook(person: string): Look { try { const raw = globalThis.localStorage?.getItem(keyFor(person)); return raw ? lookFrom(JSON.parse(raw)) : DEFAULT_LOOK; } catch { return DEFAULT_LOOK; } }

export interface LookApplier { apply(look: Look, o?: { skin?: boolean }): void; preview(skinId: string | null): void }

/** The applier for the open Space. `look` is whatever the Space last said; a hover or a device switch repaints from it. */
export function lookApplier(rt: Pick<ShellRuntime, "me" | "space">, initial: Look = restoreLook(rt.me.id)): LookApplier {
  let look = initial;
  const ctrl = (): ReturnType<typeof createThemeController> => {
    const root = doc()?.documentElement;
    let storage: Storage | null = null;
    try { storage = globalThis.localStorage ?? null; } catch { /* keep the choice in this window */ }
    return createThemeController({
      personId: rt.me.id, spaceId: rt.space.id, spaceSkin: { [rt.space.id]: root ? "system" : "system" }, prefersDark: prefersDark(), storage,
      root: { setAttribute: (k, v) => root?.setAttribute(k, v), setProperty: (k, v) => root?.style.setProperty(k, v), removeProperty: (k) => root?.style.removeProperty(k) },
    });
  };
  const show = (id: string, save: boolean): void => {
    const mine = look.mine.find((m) => m.id === id);
    if (mine) { paintCustom(mine); return; }
    if (!skinById(id) && id !== "system") return;
    const c = ctrl();
    if (save) c.setSkin(id); else c.preview({ skin: id });
  };
  return {
    apply(next, o) { look = next; rememberLook(rt.me.id, look); applyDisplay(look); if (o?.skin !== false) show(effectiveSkin(look, prefersDark()), true); },
    preview(id) { if (id === null) show(effectiveSkin(look, prefersDark()), true); else show(id, false); },
  };
}
