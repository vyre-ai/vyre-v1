// Face drawing for ui/Avatar, as svg strings (testable without a renderer). All of it is a pure function of the name.
// People: a Boring Avatars style marble (the prototype's marble(), same constants). Agents: a DiceBear Notionists face on a soft tint (see notionists.ts).

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

export const MARBLE_PATH_1 = "M32.4 59.4L50.4 70.5h22.1v-71H33.7l-7.2 13.9 19 27.1-13.1 18.9z";
export const MARBLE_PATH_2 = "M22.2 24L0 46.8l14.1 38.1L78 86l-3.1-59.3-22.4 4 13 20.2-23.4 27.4L22.2 24z";

/** The marble as svg markup; the caller wraps it (width, height, viewBox 0 0 80 80). */
export function marbleInner(name: string): string {
  const m = marbleSpec(name);
  return (
    `<mask id="${m.id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="80" height="80"><rect width="80" height="80" rx="160" fill="#fff"/></mask>` +
    `<g mask="url(#${m.id}m)"><rect width="80" height="80" fill="${m.base}"/>` +
    `<path filter="url(#${m.id}f)" d="${MARBLE_PATH_1}" fill="${m.c1}" transform="translate(${m.t1.x} ${m.t1.y}) rotate(${m.t1.rot} 40 40) scale(1.2)"/>` +
    `<path filter="url(#${m.id}f)" style="mix-blend-mode:overlay" d="${MARBLE_PATH_2}" fill="${m.c2}" transform="translate(${m.t2.x} ${m.t2.y}) rotate(${m.t2.rot} 40 40) scale(1.2)"/></g>` +
    `<defs><filter id="${m.id}f" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="7"/></filter></defs>`
  );
}

// ---- agent faces: DiceBear Notionists, as the prototype draws them

/** The prototype's hslHex: the soft tint behind a face, as six hex digits. */
export function hslHex(h: number, s: number, l: number): string {
  const sat = s / 100, lig = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number): number => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("");
}

/** The soft tint behind an agent's face (prototype: hsl(hue 55% 86%)), six hex digits. */
export function faceTint(seed: string): string {
  return hslHex(hueOf(seed), 55, 86);
}

export function initialsOf(name: string, size: number, person: boolean): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (person && size >= 24) return words.map((w) => Array.from(w)[0] ?? "").slice(0, 2).join("").toUpperCase() || "?";
  return Array.from(words[0] ?? "?")[0]?.toUpperCase() ?? "?";
}
