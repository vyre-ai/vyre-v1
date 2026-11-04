// Settings > Appearance, the part beyond the skin: text size, density, language and reduce motion. Each is a person's setting (appearance.text_size, appearance.density, appearance.language, appearance.reduce_motion)
// and each one does something in the window: text size scales the whole page, density lowers the rows' least height, language sets the page's language and
// reduce motion switches transitions and animations off. The values are kept on this device too, so the next start looks right before the Space answers.

export type TextSize = "small" | "default" | "large";
export type Density = "compact" | "comfortable";
export interface Appearance { textSize: TextSize; density: Density; language: string; reduceMotion: boolean }

export const DEFAULT_APPEARANCE: Appearance = { textSize: "default", density: "comfortable", language: "auto", reduceMotion: false };
/** How much each text size scales the page. */
export const TEXT_ZOOM: Readonly<Record<TextSize, number>> = { small: 0.92, default: 1, large: 1.12 };
/** Compact lowers the rows' least height (ui/Row marks its rows .vyre-row); content taller than that still grows the row, so nothing is cut. Comfortable is the shipped height and adds no rule. */
export const DENSITY_CSS = ".vyre-row{min-height:24px!important}";
export const LANGUAGES: readonly { value: string; label: string }[] = [{ value: "auto", label: "Same as this device" }, { value: "en", label: "English" }];

const KEYS = { textSize: "appearance.text_size", density: "appearance.density", language: "appearance.language", reduceMotion: "appearance.reduce_motion" } as const;
export const APPEARANCE_SETTING_KEYS: readonly string[] = Object.values(KEYS);

/** The person's four settings, from the rows (or any key to value map); a value the app does not know falls back to the default. */
export function appearanceFrom(values: Readonly<Record<string, unknown>>): Appearance {
  const size = values[KEYS.textSize], dens = values[KEYS.density], lang = values[KEYS.language], motion = values[KEYS.reduceMotion];
  return {
    textSize: size === "small" || size === "large" ? size : "default",
    density: dens === "compact" ? "compact" : "comfortable",
    language: typeof lang === "string" && lang !== "" ? lang : "auto",
    reduceMotion: motion === true,
  };
}

/** The language a page should declare: a chosen one, else this device's. */
export const pageLanguage = (a: Appearance, device: string | undefined): string => (a.language === "auto" ? device ?? "en" : a.language);

interface Root { style: { setProperty(k: string, v: string): void; removeProperty(k: string): void; zoom?: string }; setAttribute(k: string, v: string): void; removeAttribute(k: string): void }
interface Doc { documentElement: Root; getElementById(id: string): unknown; createElement(tag: string): { id: string; textContent: string }; head?: { appendChild(n: unknown): void; removeChild?(n: unknown): void } }

export const MOTION_CSS = "*,*::before,*::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important;scroll-behavior:auto!important}";

/** Applies the four to the window at once. Safe where there is no document (tests, the server): it does nothing there and answers false. */
export function applyAppearance(a: Appearance, doc: Doc | undefined = (globalThis as { document?: Doc }).document, deviceLanguage = (globalThis as { navigator?: { language?: string } }).navigator?.language): boolean {
  if (!doc) return false;
  const root = doc.documentElement;
  root.style.zoom = String(TEXT_ZOOM[a.textSize]);
  root.setAttribute("data-density", a.density);
  root.setAttribute("data-text-size", a.textSize);
  root.setAttribute("lang", pageLanguage(a, deviceLanguage));
  const dense = doc.getElementById("vyre-density");
  if (a.density === "compact") {
    if (!dense) { const s = doc.createElement("style"); s.id = "vyre-density"; s.textContent = DENSITY_CSS; doc.head?.appendChild(s); }
  } else if (dense) doc.head?.removeChild?.(dense);
  const present = doc.getElementById("vyre-reduce-motion");
  if (a.reduceMotion) {
    if (!present) { const s = doc.createElement("style"); s.id = "vyre-reduce-motion"; s.textContent = MOTION_CSS; doc.head?.appendChild(s); }
    root.setAttribute("data-motion", "reduce");
  } else {
    if (present) doc.head?.removeChild?.(present);
    root.removeAttribute("data-motion");
  }
  return true;
}

const keyFor = (personId: string): string => `vyre.appearance.${personId}`;

/** Keeps the person's choices on this device so the next start paints right before the Space answers. */
export function rememberAppearance(personId: string, a: Appearance, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try { storage?.setItem(keyFor(personId), JSON.stringify(a)); } catch { /* a full or blocked store only loses the shortcut */ }
}

export function restoreAppearance(personId: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): Appearance {
  try {
    const raw = storage?.getItem(keyFor(personId));
    return raw ? appearanceFrom(Object.fromEntries(Object.entries(JSON.parse(raw) as Appearance).map(([k, v]) => [k === "textSize" ? KEYS.textSize : k === "density" ? KEYS.density : k === "language" ? KEYS.language : KEYS.reduceMotion, v]))) : DEFAULT_APPEARANCE;
  } catch { return DEFAULT_APPEARANCE; }
}

function safeStorage(): Storage | null { try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; } }

const asKeys = (a: Appearance): Record<string, unknown> => ({ [KEYS.textSize]: a.textSize, [KEYS.density]: a.density, [KEYS.language]: a.language, [KEYS.reduceMotion]: a.reduceMotion });

/** The set after one setting changed. A key that is not one of the four leaves it as it was. */
export const withSetting = (a: Appearance, key: string, value: unknown): Appearance => (APPEARANCE_SETTING_KEYS.includes(key) ? appearanceFrom({ ...asKeys(a), [key]: value }) : a);

/** After a setting is saved: if it is one of the four, apply the new set and keep it. Answers the set now in force. */
export function applyIfAppearance(personId: string, key: string, current: Appearance, value: unknown): Appearance {
  if (!APPEARANCE_SETTING_KEYS.includes(key)) return current;
  const a = withSetting(current, key, value);
  applyAppearance(a);
  rememberAppearance(personId, a);
  return a;
}
