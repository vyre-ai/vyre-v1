// The entry screens' colours: the app's own tokens, so they follow the skin on the first frame with no mode to read and nothing to swap after hydration. The head script has put the skin's values on the
// root before anything paints (startup/boot.ts); a literal here could only ever be the wrong theme for somebody. The role names are the kit's; each one is one token.
import { MONO_VAR, SANS_VAR } from "../../../../ui/src/theme/fonts.ts";

export const ENTRY = {
  /** the ground, the sheet on it, and a field on the sheet */
  ground: "var(--rail)", sheet: "var(--win)", field: "var(--field)", fieldLine: "var(--field-line)",
  ink: "var(--ink)", ink2: "var(--ink-2)", ink3: "var(--ink-3)", ink4: "var(--ink-4)",
  line: "var(--line)", line2: "var(--line-2)", hover: "var(--hover)",
  accent: "var(--accent)", accentInk: "var(--accent-ink)", accentWash: "var(--accent-wash)", accentLine: "var(--accent-line)",
  spark: "var(--beacon)", ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", shadow: "var(--sh-pop)",
} as const;
export type EntryPalette = typeof ENTRY;

export const FONT = SANS_VAR;
export const MONO = MONO_VAR;
