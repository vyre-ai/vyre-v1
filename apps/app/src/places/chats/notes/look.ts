// Notes, the look: the six note colours (tints of Vyre Light and Vyre Black chosen to keep the second ink above 7:1), set as CSS variables that follow the window's mode, and the few rules
// inline styles cannot say (a card's hover, the pin and toolbar that show on hover or focus). Colours stay skin tokens, so a skin switch repaints with no re-render.
import { injectCss } from "../../../../../../ui/src/theme/css.ts";
import type { NoteColor } from "./model.ts";

export const NOTE_HEX: Readonly<Record<"light" | "dark", Readonly<Record<Exclude<NoteColor, "">, string>>>> = {
  light: { rose: "#FBE7EA", sand: "#F7EED6", sage: "#E3F1E6", sky: "#E0ECF8", lilac: "#ECE6FB", slate: "#ECEBF0" },
  dark: { rose: "#36222A", sand: "#332C1E", sage: "#1E2E26", sky: "#1C2938", lilac: "#2A2440", slate: "#25242C" },
};

/** The fill of a note of this colour: its variable, or the raised card for Default. */
export function noteFill(c: NoteColor): string {
  return c ? `var(--n-${c})` : "var(--raised)";
}

/** The dim behind an opened note or a sheet, as the prototype sets it per mode. */
export const SCRIM = { light: "rgba(23,20,31,.28)", dark: "rgba(0,0,0,.5)" } as const;

const vars = (m: "light" | "dark"): string => [...Object.entries(NOTE_HEX[m]).map(([k, v]) => `--n-${k}:${v}`), `--n-scrim:${SCRIM[m]}`].join(";");

export const NOTES_CSS =
  `:root{${vars("light")}}html[data-mode=light]{${vars("light")}}html[data-mode=dark]{${vars("dark")}}`
  // a card: the edge darkens and lifts on hover; a coloured card has no edge, only the lift; the selected or focused card wears the accent ring
  + "[data-ncard]{transition:box-shadow .12s ease;outline:none}"
  + "[data-ncard=plain]{box-shadow:0 0 0 1px var(--line)}[data-ncard=plain]:hover{box-shadow:0 0 0 1px var(--line-2),var(--sh-1)}"
  + "[data-ncard=tint]:hover{box-shadow:var(--sh-1)}"
  + "[data-ncard][data-nsel=true],[data-ncard]:focus-visible{box-shadow:0 0 0 2px var(--accent-line)!important}"
  // the pin and the toolbar fade in with the pointer or the focus on the card (120 ms, no motion); a pinned note keeps its pin
  + "[data-nfade]{opacity:0;transition:opacity .12s ease}[data-nfade=on]{opacity:1}"
  + "[data-ncard]:hover [data-nfade],[data-ncard]:focus-within [data-nfade],[data-ncard][data-nsel=true] [data-nfade]{opacity:1}"
  // a button that tints on hover
  + "[data-nbtn]:hover{background-color:var(--hover)}[data-nbtn=ghost]:hover{background-color:var(--hover);color:var(--ink)}"
  + "[data-nbtn=quiet]{background-color:var(--sel)}[data-nbtn=quiet]:hover{background-color:var(--press)}"
  + "[data-nbtn=primary]:hover{filter:brightness(1.08)}"
  + "[data-nfield]:focus-within{box-shadow:0 0 0 2px var(--accent-line)}"
  + "[data-ndrop=true]{box-shadow:0 0 0 2px var(--accent-line),var(--sh-2)!important}"
  // tints React Native's style colours cannot say (color-mix): a button over a picture, the link card's wash, the foot bar's action, the phone's fade behind Take a note
  + "[data-nover]{background-color:color-mix(in srgb,var(--raised) 85%,transparent)!important}"
  + "[data-nlk]{background-color:color-mix(in srgb,var(--ink) 4%,transparent)}"
  + "[data-nbaract]{color:color-mix(in srgb,var(--accent) 60%,var(--win))!important}"
  + "[data-nfadebg]{background-image:linear-gradient(to top,var(--win) 70%,transparent)}"
  // layers and menus fade in at 120 to 140 ms; nothing blinks, pulses or spins; reduced motion turns fades off
  + "@keyframes vyre-notes-fade{from{opacity:0}to{opacity:1}}[data-nlayer]{animation:vyre-notes-fade .14s ease}"
  + "@media (prefers-reduced-motion: reduce){[data-nlayer],[data-ncard],[data-nfade]{animation:none!important;transition:none!important}}";

let done = false;
export function ensureNotesCss(): void {
  if (done) return;
  const d = (globalThis as { document?: Parameters<typeof injectCss>[0] }).document;
  if (!d || !d.head) return;
  injectCss(d, "vyre-notes", NOTES_CSS);
  done = true;
}
