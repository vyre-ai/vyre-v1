// @ts-check
// Theme and CSS (spec 2.11: layout, theme, fonts, custom CSS, cover image). A form takes the colours of its Space's skin (Northwind is Paper, Harbor Studio is Dusk, both from
// ui/src/tokens/skins.ts), then the form's own theme on top: accent, background, ink, radius, width, one of four font stacks, a cover image and a logo. Custom CSS is the form
// author's, but it is served on a public page, so it is filtered before it is written: no @import, no url() to anything but https or a path on this site, no expression(), no
// behavior, no -moz-binding, no javascript: and nothing that can close the style element.

import { FONTS } from "./definition.js";

/** @typedef {import("./definition.js").FormDefinition} FormDefinition */

/** Palette per skin: win, side, raised, sunk, ink, ink2, ink3, ink4, accent. Copied from ui/src/tokens/skins.ts. */
export const SKIN_PALETTES = {
  paper: { win: "#ffffff", side: "#f7f7f6", raised: "#ffffff", sunk: "#f2f2f0", ink: "#18181a", ink2: "#4e4e52", ink3: "#8a8a8f", ink4: "#b4b4b8", accent: "#5b5bd6", dark: false },
  dusk: { win: "#17151c", side: "#1d1a23", raised: "#24202c", sunk: "#121016", ink: "#ece8f2", ink2: "#bcb4c9", ink3: "#8a8299", ink4: "#5f586c", accent: "#b49cff", dark: true },
};

/** Which skin a Space uses, by the Kit's skin id; an unknown id is Paper. */
export function skinFor(/** @type {unknown} */ id) {
  return id === "dusk" ? "dusk" : "paper";
}

const channel = (/** @type {string} */ h, /** @type {number} */ i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
/** Text colour that reads on a background: black or white by luminance. */
export function readableOn(/** @type {string} */ bg) {
  const l = (0.2126 * channel(bg, 0) + 0.7152 * channel(bg, 1) + 0.0722 * channel(bg, 2)) / 255;
  return l > 0.6 ? "#18181a" : "#ffffff";
}

/** Mixes two #rrggbb colours; t is the share of b. */
export function mix(/** @type {string} */ a, /** @type {string} */ b, /** @type {number} */ t) {
  const c = (/** @type {number} */ i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, "0");
  return `#${c(0)}${c(1)}${c(2)}`;
}

/** The CSS custom properties of a form, as a declaration list. @param {FormDefinition} def */
export function tokens(def) {
  const skin = SKIN_PALETTES[skinFor(def.theme.skin)];
  const win = def.theme.background ?? skin.win;
  const ink = def.theme.ink ?? skin.ink;
  const accent = def.theme.accent ?? skin.accent;
  const raised = def.theme.background ? mix(win, skin.dark ? "#ffffff" : "#000000", 0.04) : skin.raised;
  /** @type {Record<string, string>} */
  const t = {
    "--win": win, "--raised": raised, "--sunk": def.theme.background ? mix(win, skin.dark ? "#000000" : "#000000", 0.05) : skin.sunk,
    "--ink": ink, "--ink-2": def.theme.ink ? mix(ink, win, 0.3) : skin.ink2, "--ink-3": def.theme.ink ? mix(ink, win, 0.5) : skin.ink3,
    "--line": mix(win, ink, skin.dark ? 0.2 : 0.14), "--accent": accent, "--accent-ink": readableOn(accent), "--accent-wash": mix(win, accent, 0.12),
    "--danger": skin.dark ? "#ff8a80" : "#c62828",
    "--radius": `${def.theme.radius ?? 8}px`, "--width": `${def.theme.width ?? 560}px`, "--font": FONTS[/** @type {keyof typeof FONTS} */ (def.theme.font ?? "system")],
  };
  return Object.entries(t).map(([k, v]) => `${k}:${v}`).join(";");
}

const BAD = /@import|expression\s*\(|behaviou?r\s*:|-moz-binding|javascript:|vbscript:|data:text\/html|<\s*\/?\s*script/i;

/**
 * Filters an author's CSS. Returns the CSS that is safe to write into a style element. Rules are kept or dropped whole; at-rules other than @media, @supports and
 * @font-face are dropped; url() is allowed only for https addresses and paths on this site.
 */
export function sanitizeCss(/** @type {string} */ css) {
  const unescape = (/** @type {string} */ x) => x.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } }).replace(/\\(.)/g, "$1");
  let s = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<\/?style[^>]*>/gi, "").replace(/<!--|-->/g, "");
  // CSS escapes can hide a keyword (\75rl); look at the decoded text, and drop every declaration or rule that holds one of the forbidden things, not just the word
  if (BAD.test(unescape(s))) s = s.split(/(?<=[;}])/).filter(part => !BAD.test(unescape(part))).join("");
  // url(): https or a path on this site only
  s = s.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q, u) => {
    const target = String(u).trim();
    return /^https:\/\/[^\s'")]+$/i.test(target) || target === "/" || /^\/[^/\\\s'")][^\s'")]*$/.test(target) ? m : "none";
  });
  // at-rules: keep media, supports and font-face blocks, drop the rest
  s = s.replace(/@(?!media\b|supports\b|font-face\b)[a-zA-Z-]+[^{;]*(\{(?:[^{}]|\{[^{}]*\})*\}|;)/g, "");
  return s.replace(/</g, "\\3c ").trim();
}

const BASE = `
*,*::before,*::after{box-sizing:border-box}
html{background:var(--win)}
body{margin:0;background:var(--win);color:var(--ink);font:16px/1.5 var(--font);-webkit-font-smoothing:antialiased}
.vf-wrap{max-width:var(--width);margin:0 auto;padding:0 16px 48px}
.vf-cover{display:block;width:100%;height:160px;object-fit:cover;border-radius:0 0 var(--radius) var(--radius)}
.vf-logo{display:block;max-height:40px;margin:24px 0 0}
.vf-head{padding:24px 0 8px}
.vf-title{font-size:1.5rem;line-height:1.25;margin:0 0 8px;font-weight:650}
.vf-intro{color:var(--ink-2);margin:0 0 16px;white-space:pre-wrap}
.vf-progress{display:flex;gap:6px;margin:8px 0 20px;padding:0;list-style:none}
.vf-progress li{flex:1;height:4px;border-radius:2px;background:var(--line)}
.vf-progress li[data-state=done],.vf-progress li[data-state=now]{background:var(--accent)}
.vf-step-label{font-size:.8125rem;color:var(--ink-3);margin:0 0 12px}
.vf-field{margin:0 0 18px;border:0;padding:0;min-width:0}
.vf-label{display:block;font-weight:600;margin:0 0 6px}
.vf-req{color:var(--ink-3);font-weight:400}
.vf-help{color:var(--ink-3);font-size:.875rem;margin:4px 0 0}
.vf-input,.vf-select,.vf-textarea{width:100%;font:inherit;color:var(--ink);background:var(--raised);border:1px solid var(--line);border-radius:var(--radius);padding:10px 12px;min-height:44px}
.vf-textarea{min-height:110px;resize:vertical}
.vf-input:focus-visible,.vf-select:focus-visible,.vf-textarea:focus-visible,.vf-btn:focus-visible,.vf-opt input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.vf-input[aria-invalid=true],.vf-select[aria-invalid=true],.vf-textarea[aria-invalid=true]{border-color:var(--danger)}
.vf-opts{display:grid;gap:8px}
.vf-opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--raised);cursor:pointer}
.vf-opt input{margin:3px 0 0;accent-color:var(--accent)}
.vf-rating{display:flex;gap:8px;flex-wrap:wrap}
.vf-rating .vf-opt{padding:8px 14px}
.vf-show{padding:10px 12px;border-radius:var(--radius);background:var(--sunk);color:var(--ink-2);white-space:pre-wrap}
.vf-error{color:var(--danger);font-size:.875rem;margin:6px 0 0}
.vf-banner{border:1px solid var(--danger);color:var(--danger);border-radius:var(--radius);padding:10px 12px;margin:0 0 16px}
.vf-actions{display:flex;gap:12px;justify-content:space-between;margin-top:24px}
.vf-btn{font:inherit;font-weight:600;min-height:44px;padding:0 20px;border-radius:var(--radius);border:1px solid var(--line);background:var(--raised);color:var(--ink);cursor:pointer}
.vf-btn[data-primary]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.vf-btn[disabled]{opacity:.6;cursor:default}
.vf-consent{margin:20px 0 0;font-size:.875rem;color:var(--ink-2)}
.vf-thanks{padding:48px 0;text-align:center}
.vf-thanks h2{margin:0 0 8px}
.vf-thanks p{color:var(--ink-2);white-space:pre-wrap}
.vf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:480px){.vf-actions{flex-direction:column-reverse}.vf-btn{width:100%}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

/** The whole stylesheet of a form: the base rules over the tokens, then the author's filtered CSS. @param {FormDefinition} def */
export function styleSheet(def) {
  return `:root{${tokens(def)}}${BASE.replace(/\n/g, "")}${sanitizeCss(def.css)}`;
}
