// Face drawing for ui/Avatar, as svg strings (testable without a renderer). All of it is a pure function of the name.
// People: a Boring Avatars style marble (the prototype's marble(), same constants). Agents: a pixel face on a soft tint, seeded the same way.

/** The prototype's string hash. Every face and tint is derived from it. */
export function hash(s: string): number {
  let h = 7;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export const HUES = [250, 160, 28, 205, 330, 95, 12, 280];
const BORING = ["#92A1C6", "#146A7C", "#F0AB3D", "#C271B4", "#C20D90"];

/** The hue an agent's tint takes from its name. */
export function hueOf(name: string): number {
  return HUES[hash(name) % HUES.length] as number;
}

export interface MarbleSpec {
  id: string;
  base: string;
  c1: string;
  c2: string;
  t1: { x: number; y: number; rot: number };
  t2: { x: number; y: number; rot: number };
}

export function marbleSpec(name: string): MarbleSpec {
  const h = hash(name);
  const c = (k: number): string => BORING[(h >>> (k * 3)) % BORING.length] as string;
  const n = (k: number, m: number): number => ((h >>> k) % m) - m / 2;
  return {
    id: `mb${h.toString(36)}`,
    base: c(0),
    c1: c(1),
    c2: c(2),
    t1: { x: n(2, 10), y: n(4, 10), rot: h % 360 },
    t2: { x: n(6, 16), y: n(8, 16), rot: (h >>> 5) % 360 },
  };
}

/** The marble as svg markup; the caller wraps it (width, height, viewBox 0 0 80 80). */
export function marbleInner(name: string): string {
  const m = marbleSpec(name);
  return (
    `<mask id="${m.id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="80" height="80"><rect width="80" height="80" rx="160" fill="#fff"/></mask>` +
    `<g mask="url(#${m.id}m)"><rect width="80" height="80" fill="${m.base}"/>` +
    `<path filter="url(#${m.id}f)" d="M32.4 59.4L50.4 70.5h22.1v-71H33.7l-7.2 13.9 19 27.1-13.1 18.9z" fill="${m.c1}" transform="translate(${m.t1.x} ${m.t1.y}) rotate(${m.t1.rot} 40 40) scale(1.2)"/>` +
    `<path filter="url(#${m.id}f)" style="mix-blend-mode:overlay" d="M22.2 24L0 46.8l14.1 38.1L78 86l-3.1-59.3-22.4 4 13 20.2-23.4 27.4L22.2 24z" fill="${m.c2}" transform="translate(${m.t2.x} ${m.t2.y}) rotate(${m.t2.rot} 40 40) scale(1.2)"/></g>` +
    `<defs><filter id="${m.id}f" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="7"/></filter></defs>`
  );
}

// ---- pixel faces

type Rect = readonly [x: number, y: number, w: number, h: number];

const SKIN = ["#F6D3B5", "#E9B896", "#C98F67", "#9A6A47", "#6E4A32"];
const INK = "#1F1F23";

/** Hair shapes on the 8 x 8 head box, in head coordinates (the top row is y 0; negative y rises above the head). */
const HAIR: readonly (readonly Rect[])[] = [
  [[0, 0, 8, 2]],
  [[0, 0, 8, 1], [0, 1, 3, 1], [6, 1, 2, 1]],
  [[0, 0, 8, 2], [3, -1, 2, 1]],
  [[0, 0, 8, 1], [0, 1, 1, 3], [7, 1, 1, 3]],
  [[0, 0, 8, 2], [0, 2, 2, 1], [6, 2, 2, 1]],
  [[0, 0, 8, 1], [-1, 1, 10, 1]],
];
/** Eye shapes in head coordinates (glasses draw their own). */
const EYES: readonly (readonly Rect[])[] = [
  [[2, 4, 1, 1], [5, 4, 1, 1]],
  [[2, 3, 1, 2], [5, 3, 1, 2]],
];
const MOUTH: readonly (readonly Rect[])[] = [
  [[2, 6, 1, 1], [3, 7, 2, 1], [5, 6, 1, 1]],
  [[2, 6, 4, 1]],
  [[3, 6, 2, 1]],
];

export interface PixelFaceSpec {
  tint: string;
  skin: string;
  hair: string;
  hairShape: number;
  eyeShape: number;
  mouthShape: number;
  /** Glasses draw a frame; the eyes sit inside it. */
  glasses: boolean;
}

export function pixelSpec(name: string): PixelFaceSpec {
  const h = hash(name);
  const hue = hueOf(name);
  const eyeShape = (h >>> 9) % 3;
  return {
    tint: `hsl(${hue} 55% 86%)`,
    skin: SKIN[(h >>> 3) % SKIN.length] as string,
    hair: `hsl(${(hue + 20) % 360} 38% ${22 + ((h >>> 12) % 3) * 8}%)`,
    hairShape: (h >>> 6) % HAIR.length,
    eyeShape: eyeShape % 2,
    mouthShape: (h >>> 15) % MOUTH.length,
    glasses: eyeShape === 2,
  };
}

const rect = (r: Rect, fill: string): string => `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="${fill}"/>`;

/** The pixel face as svg markup on a 12 x 12 grid; the caller wraps it (viewBox 0 0 12 12, crispEdges). */
export function pixelInner(name: string): string {
  const s = pixelSpec(name);
  const ox = 2;
  const oy = 3;
  const at = (r: Rect): Rect => [r[0] + ox, r[1] + oy, r[2], r[3]];
  const out: string[] = [`<rect width="12" height="12" fill="${s.tint}"/>`];
  out.push(rect(at([0, 0, 8, 8]), s.skin));
  for (const r of HAIR[s.hairShape] as readonly Rect[]) out.push(rect(at(r), s.hair));
  if (s.glasses) {
    for (const x of [1, 5]) {
      out.push(rect(at([x, 3, 3, 1]), INK), rect(at([x, 5, 3, 1]), INK), rect(at([x, 4, 1, 1]), INK), rect(at([x + 2, 4, 1, 1]), INK), rect(at([x + 1, 4, 1, 1]), "#fff"));
    }
    out.push(rect(at([4, 4, 1, 1]), INK));
  } else {
    for (const r of EYES[s.eyeShape] as readonly Rect[]) out.push(rect(at(r), INK));
  }
  for (const r of MOUTH[s.mouthShape] as readonly Rect[]) out.push(rect(at(r), INK));
  return out.join("");
}

/** Up to two letters for the native fallback and for a failed image: first letters of the first two words for a person at 24 px and above, else one. */
export function initialsOf(name: string, size: number, person: boolean): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (person && size >= 24) return words.map((w) => Array.from(w)[0] ?? "").slice(0, 2).join("").toUpperCase() || "?";
  return Array.from(words[0] ?? "?")[0]?.toUpperCase() ?? "?";
}
