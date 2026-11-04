// @ts-check
// Icons, the Vyre mark and faces for the extension's own pages (side panel, review page), from the approved prototype's set. Each returns a DOM node. The icon set is
// static markup in this file, parsed once as SVG; names and avatars from the app go in as text or as an image address, never as markup.

import { h } from "./dom.js";

const SVG = "http://www.w3.org/2000/svg";

export const D = /** @type {Record<string, string>} */ ({
  plus: '<path d="M8 3v10M3 8h10"/>', check: '<path d="M3.5 8.5l3 3 6-7"/>', x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  chev: '<path d="M5 6.5l3 3 3-3"/>', chevr: '<path d="M6.5 4.5l3 3.5-3 3.5"/>', chevl: '<path d="M9.5 4.5L6.5 8l3 3.5"/>',
  more: '<circle cx="3.5" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12.5" cy="8" r=".8"/>',
  up: '<path d="M8 12.5v-9M4.5 7L8 3.5 11.5 7"/>', open: '<path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1h2.5"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
  vault: '<rect x="2.5" y="3" width="11" height="10" rx="2"/><circle cx="8" cy="8" r="1.8"/><path d="M8 6.2V5M9.8 8H11"/>',
  eye: '<path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.8"/>',
  eyeoff: '<path d="M2.5 2.5l11 11M6.6 6.7a1.8 1.8 0 002.6 2.6M4.3 4.9C2.7 6 1.8 8 1.8 8S4 12.2 8 12.2c1.3 0 2.4-.4 3.3-1M7 3.9c.3 0 .6-.1 1-.1 4 0 6.2 4.2 6.2 4.2s-.5 1-1.4 2"/>',
  hand: '<path d="M5.5 8.5V4a1 1 0 012 0v3.5M7.5 7V3a1 1 0 012 0v4M9.5 7V3.8a1 1 0 012 0V9M11.5 6.5a1 1 0 012 0V10a4.5 4.5 0 01-4.5 4.5H8.6a4 4 0 01-3.1-1.5L3 9.8a1 1 0 011.5-1.3L5.5 9.5"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1.5"/>', pause: '<path d="M6 4v8M10 4v8"/>', play: '<path d="M5.5 3.8v8.4L12 8z"/>',
  chrome: '<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="2.2"/><path d="M8 5.8h5.3M6.1 9.1L3.4 4.6M9.9 9.1L7.2 13.7"/>',
  server: '<rect x="2.5" y="3" width="11" height="4" rx="1"/><rect x="2.5" y="9" width="11" height="4" rx="1"/><path d="M5 5h.01M5 11h.01"/>',
  monitor: '<rect x="2" y="3" width="12" height="8" rx="1.2"/><path d="M6 14h4M8 11v3"/>',
  note: '<path d="M4 2.5h6l2.5 2.5v8.5H4z"/><path d="M6 7h4.5M6 9.5h4.5"/>',
  camera: '<path d="M2.5 5.5h2.2l1-1.5h4.6l1 1.5h2.2v7h-11z"/><circle cx="8" cy="9" r="2.2"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>', region: '<path d="M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11"/><rect x="5.5" y="5.5" width="5" height="5" rx=".5"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"/>', link: '<path d="M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 00-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 003.7 3.7l.8-.8"/>',
  list: '<path d="M6 4.5h7M6 8h7M6 11.5h7"/><path d="M3 4.5h.01M3 8h.01M3 11.5h.01"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.3 3.3"/>', user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.6-2.4 2.6-3.5 5-3.5s4.4 1.1 5 3.5"/>',
  users: '<circle cx="6" cy="5.5" r="2.2"/><path d="M2 13c.5-2.1 2-3.2 4-3.2s3.5 1.1 4 3.2"/><path d="M10.2 3.6a2.2 2.2 0 010 4M11.6 9.9c1.3.4 2.1 1.4 2.4 3.1"/>',
  spark: '<path d="M8 2.5l1.3 3.4 3.4 1.3-3.4 1.3L8 12l-1.3-3.5-3.4-1.3 3.4-1.3z"/>', skill: '<path d="M9 2.5L4 9h4l-1 4.5L12 7H8z"/>',
  chat: '<path d="M2.5 4a1.5 1.5 0 011.5-1.5h8A1.5 1.5 0 0113.5 4v6a1.5 1.5 0 01-1.5 1.5H7L4 14v-2.5A1.5 1.5 0 012.5 10z"/>',
  watch: '<path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.8"/><path d="M12.5 2.2l1.3-1"/>',
  goal: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/><circle cx="8" cy="8" r=".6"/>', clip: '<path d="M11 6.5L7 10.5a1.8 1.8 0 01-2.5-2.5l4.6-4.6a1.2 1.2 0 011.7 1.7L6.2 9.7"/>',
  incog: '<path d="M2 8.5h12M4 8.5l1.5-4h5l1.5 4"/><circle cx="5" cy="11.5" r="1.6"/><circle cx="11" cy="11.5" r="1.6"/><path d="M6.6 11.5h2.8"/>',
  shield: '<path d="M8 2.2l5 1.8v4c0 3-2.2 5-5 5.8-2.8-.8-5-2.8-5-5.8V4z"/>', copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1 1 0 0010 2.5H3.5a1 1 0 00-1 1V10a1 1 0 001 1H5"/>',
  undo: '<path d="M4.5 6.5h5.5a3 3 0 010 6H7"/><path d="M6.5 4L4 6.5 6.5 9"/>', edit: '<path d="M10.5 3l2.5 2.5-7 7H3.5V10z"/>', refresh: '<path d="M13 8a5 5 0 11-1.6-3.7M13 2.5v3h-3"/>',
  rec: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/>',
  globe: '<circle cx="8" cy="8" r="5.6"/><path d="M2.4 8h11.2M8 2.4c1.6 1.6 2.4 3.4 2.4 5.6S9.6 12 8 13.6C6.4 12 5.6 10.2 5.6 8S6.4 4 8 2.4z"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
  record: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M6 6.5v6.5"/>',
  gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
});

/** @type {Map<string, Element[]>} */
const parsed = new Map();
/** @param {string} name */
function shapes(name) {
  let got = parsed.get(name);
  if (!got) {
    const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG}">${D[name] ?? ""}</svg>`, "image/svg+xml");
    got = [...doc.documentElement.children];
    parsed.set(name, got);
  }
  return got;
}

/** @param {string} name @param {"" | "s" | "xs"} [size] @returns {SVGSVGElement} */
export function ic(name, size = "") {
  const s = /** @type {SVGSVGElement} */ (document.createElementNS(SVG, "svg"));
  s.setAttribute("class", `ic ${size}`.trim());
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("aria-hidden", "true");
  for (const n of shapes(name)) s.appendChild(document.importNode(n, true));
  return s;
}

/** The Vyre mark. @param {number} z @param {string} [col] */
export function mark(z, col) {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("width", String(z)); s.setAttribute("height", String(z)); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
  s.style.display = "block";
  const p = document.createElementNS(SVG, "path");
  for (const [k, v] of Object.entries({ d: "M5.2 6.4l6.3 11.2 4.9-8.6", fill: "none", stroke: col || "currentColor", "stroke-width": "3.1", "stroke-linecap": "round", "stroke-linejoin": "round" })) p.setAttribute(k, v);
  const c = document.createElementNS(SVG, "circle");
  c.setAttribute("cx", "18.6"); c.setAttribute("cy", "5.6"); c.setAttribute("r", "2.7"); c.style.fill = "var(--beacon)";
  s.append(p, c);
  return s;
}

const HUES = [250, 160, 28, 205, 330, 95, 12, 280];
/** @param {string} s */
const hash = (s) => { let x = 7; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
const dark = () => Boolean(globalThis.matchMedia && globalThis.matchMedia("(prefers-color-scheme: dark)").matches);
const IMG = /^data:image\/(svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/=]+$|^data:image\/svg\+xml;utf8,|^https:\/\//;

/**
 * A face: an agent's own avatar when the app sent one, the Assistant's mark, else a tile with the initial; a person gets a soft marble.
 * @param {{ name: string, kind?: string, avatar?: string | null, assistant?: boolean }} who @param {number} z
 */
export function face(who, z = 22) {
  const name = String(who.name || "?");
  const size = { width: `${z}px`, height: `${z}px`, fontSize: `${Math.round(z * 0.45)}px` };
  if (who.assistant) return h("span.face.ag", { css: { ...size, background: "var(--sunk)", boxShadow: "inset 0 0 0 1px var(--line)" } }, mark(Math.round(z * 0.72)));
  const hu = HUES[hash(name) % 8];
  const avatar = typeof who.avatar === "string" && IMG.test(who.avatar) ? who.avatar : null;
  if (who.kind !== "person") {
    if (avatar) return h("span.face.ag", { css: { ...size, background: `hsl(${hu} 50% ${dark() ? 30 : 90}%)` } }, h("img", { alt: "", src: avatar }));
    return h("span.face.ag", { css: { ...size, background: `hsl(${hu} 45% ${dark() ? 30 : 88}%)`, color: `hsl(${hu} 40% ${dark() ? 85 : 30}%)` } }, name[0] ?? "?");
  }
  if (avatar) return h("span.face", { css: size }, h("img", { alt: "", src: avatar }));
  const x = hash(name);
  const c = [0, 1, 2].map((i) => `hsl(${(x * (i + 3) * 37) % 360} ${55 + i * 10}% ${55 + i * 6}%)`);
  return h("span.face", { css: { ...size, background: `radial-gradient(circle at ${20 + (x % 40)}% ${25 + (x % 30)}%, ${c[1]} 0, transparent 60%), radial-gradient(circle at ${75 - (x % 20)}% ${80 - (x % 30)}%, ${c[2]} 0, transparent 55%), ${c[0]}` } });
}

/** The Space tile: its initial on the accent. @param {string} name @param {number} [z] */
export const spaceTile = (name, z = 24) => h("span.ptile", { css: { width: `${z}px`, height: `${z}px` } }, (String(name || "V").trim()[0] ?? "V").toUpperCase());
