// The drawn agent faces: four DiceBear collections (Notionists, Lorelei, Thumbs and Glass, all CC0 art, MIT code) rendered here with @dicebear/core, never from the DiceBear service. Each family offers 24 curated
// faces: the options below are picked by eye so only the good combinations show (every one is checked at 20, 32 and 96 px). Faces, Friends and Blobs also draw four expressions: idle, working, asleep and done.
// Pure and cached: the same face and expression give the same svg. Loaded on demand (the collections are large), see load.ts.

import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";
import * as lorelei from "@dicebear/lorelei";
import * as thumbs from "@dicebear/thumbs";
import * as glass from "@dicebear/glass";
import { PER_FAMILY, TINTS, hasExpressions } from "./agentface.ts";
import type { Expression, Family, FaceSpec } from "./agentface.ts";

const v2 = (n: number): string => `variant${String(n).padStart(2, "0")}`;
const cyc = (l: readonly number[], i: number, k = 1): number => l[(i * k + Math.floor(i / l.length)) % l.length]!;

type Opts = Record<string, unknown>;

/** The svg of a style at options, as a string. */
const draw = (style: unknown, o: Opts): string => createAvatar(style as never, o as never).toString();

/** The svg with its metadata, mask and white backdrop removed and its whitespace folded: what is left is the drawing alone. */
function clean(s: string): string {
  return s
    .replace(/<metadata[\s\S]*?<\/metadata>/g, "")
    .replace(/<mask id="viewboxMask">[\s\S]*?<\/mask>/g, "")
    .replace(/ mask="url\(#viewboxMask\)"/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Faces: Notionists. Black line art; the face is white, the tint behind it is ours.
const HAIR = [1, 2, 3, 4, 8, 9, 10, 11, 14, 17, 20, 23, 28, 33, 36, 40, 42, 45, 47, 48, 50, 57, 59, 63];
const BODY = [1, 3, 5, 7, 9, 11, 13, 14, 16, 19, 21, 23, 2, 4, 8, 25];
const LIPS = [1, 2, 4, 5, 6, 8, 9, 12, 15, 19, 23, 24];
const BROW = [2, 4, 5, 7, 12, 9, 1, 10];
const GLASSES = [0, 0, 0, 3, 0, 0, 5, 0, 0, 0, 6, 0, 0, 9, 0, 0, 0, 11, 0, 0, 0, 0, 0, 0];
const NO_EXTRAS = { beardProbability: 0, glassesProbability: 0, gestureProbability: 0, bodyIconProbability: 0 };
const CLOSED = '<g><path d="M812 778Q857 820 902 778" stroke="#000" stroke-width="15" stroke-linecap="round"/><path d="M984 778Q1029 820 1074 778" stroke="#000" stroke-width="15" stroke-linecap="round"/></g>';
const HAPPY = '<g><path d="M812 802Q857 750 902 802" stroke="#000" stroke-width="15" stroke-linecap="round"/><path d="M984 802Q1029 750 1074 802" stroke="#000" stroke-width="15" stroke-linecap="round"/></g>';

/** The top-level parts of a Notionists drawing, in order (head, body, hair, nose, brows, eyes, mouth ...). */
const parts = (svg: string): string[] => svg.slice(svg.indexOf("<g>")).match(/<g transform="translate\([^)]*\)"[^>]*>.*?<\/g>(?=<g transform|<\/g><\/svg>)/g) ?? [];

function facesOpts(i: number): Opts {
  const o: Opts = { seed: `f${i}`, hair: [v2(HAIR[i]!)], body: [v2(BODY[i % BODY.length]!)], eyes: [v2(1 + (i % 5))], brows: [v2(cyc(BROW, i))], lips: [v2(cyc(LIPS, i, 5))], ...NO_EXTRAS };
  if (GLASSES[i]) { o["glasses"] = [v2(GLASSES[i]!)]; o["glassesProbability"] = 100; }
  return o;
}

function facesDraw(i: number, e: Expression): string {
  const o = facesOpts(i);
  const idle = clean(draw(notionists, o));
  if (e === "idle") return idle;
  const withOpts = (c: Opts): string => clean(draw(notionists, { ...o, ...c }));
  // Notionists has no closed or happy eyes, so those two draw the eyes themselves in the place the eye part sits
  const swapEyes = (svg: string, c: Opts, arcs: string): string => {
    const other = clean(draw(notionists, { ...o, ...c, eyes: [v2((o["eyes"] as string[])[0] === v2(1) ? 3 : 1)] }));
    const a = parts(svg), b = parts(other);
    const diff = a.map((_, k) => k).filter((k) => a[k] !== b[k]);
    return diff.length === 1 ? svg.replace(a[diff[0]!]!, arcs) : svg;
  };
  if (e === "working") return withOpts({ brows: [v2(8)], lips: [v2(1)] });
  if (e === "asleep") return swapEyes(withOpts({ lips: [v2(1)] }), { lips: [v2(1)] }, CLOSED);
  return swapEyes(withOpts({ lips: [v2(5)] }), { lips: [v2(5)] }, HAPPY);
}

// ---- Friends: Lorelei. Colour comes from the skin and the hair.
const SKIN = ["f6d9c8", "efc3a4", "d9a17c", "b97d56", "8a5a3c", "fbe3d3"];
const HAIRC = ["2b2433", "4a3328", "7a4a2e", "b5793a", "3d3a73", "8a2f4b", "1f1f1f", "5b5b66"];
const L_HAIR = [1, 4, 5, 6, 10, 11, 13, 14, 15, 17, 18, 20, 21, 22, 23, 24, 26, 27, 29, 31, 33, 35, 36, 38];
const L_EYES = [2, 4, 6, 8, 9, 10, 12, 13, 14, 16, 17, 21, 23, 24];
const L_MOUTH = [1, 2, 3, 4, 5, 8, 9, 13, 14, 15];
const L_BROWS = [1, 3, 5, 7, 9, 11, 13];
const L_PLAIN = { glassesProbability: 0, beardProbability: 0, frecklesProbability: 0, earringsProbability: 0, hairAccessoriesProbability: 0 };

function friendsDraw(i: number, e: Expression): string {
  const hc = HAIRC[(i * 3) % HAIRC.length]!;
  const o: Opts = {
    seed: `l${i}`, hair: [v2(L_HAIR[i]!)], eyes: [v2(cyc(L_EYES, i, 3))], mouth: [`happy${String(cyc(L_MOUTH, i, 3)).padStart(2, "0")}`], eyebrows: [v2(cyc(L_BROWS, i, 2))], head: [v2(1 + (i % 4))], nose: [v2(1 + (i % 6))],
    skinColor: [SKIN[i % SKIN.length]!], hairColor: [hc], eyesColor: ["1f1a2b"], mouthColor: ["7a2f3f"], eyebrowsColor: [hc], noseColor: ["1f1a2b"], ...L_PLAIN,
  };
  if (i % 7 === 3) Object.assign(o, { glassesProbability: 100, glasses: [v2(1 + (i % 5))], glassesColor: ["1f1a2b"] });
  if (i % 9 === 4) Object.assign(o, { frecklesProbability: 100, frecklesColor: ["a0522d"] });
  const g = (c: Opts): string => clean(draw(lorelei, { ...o, ...c }));
  if (e === "asleep") return g({ eyes: [v2(19)], mouth: ["happy01"] });
  if (e === "working") return g({ eyebrows: [v2(13)], mouth: ["happy02"] });
  if (e === "done") return g({ eyes: [v2(22)], mouth: ["happy05"] });
  return g({});
}

// ---- Blobs: Thumbs.
const SHAPE = ["69d2e7", "f88c49", "ffb3c7", "8fd3b6", "c0aede", "ffd166", "9bc4f2", "f4a4a0"];
function blobsDraw(i: number, e: Expression): string {
  // the idle eyes are never the ones another expression uses (asleep 2, done 4, working 8), so all four expressions differ
  const eye = [1, 5, 6, 7, 9][(i * 3) % 5]!;
  const o: Opts = {
    seed: `b${i}`, backgroundColor: ["transparent"], shapeColor: [SHAPE[i % SHAPE.length]!], eyes: [`variant${eye}W12`], mouth: [`variant${1 + (i % 3)}`], face: [`variant${1 + (i % 5)}`],
    eyesColor: ["1f1a2b"], mouthColor: ["1f1a2b"], faceRotation: [0, 0], faceOffsetX: [0, 0], faceOffsetY: [0, 0], shapeRotation: [((i * 37) % 40) - 20, ((i * 37) % 40) - 20],
  };
  const g = (c: Opts): string => clean(draw(thumbs, { ...o, ...c }));
  if (e === "asleep") return g({ eyes: ["variant2W12"], mouth: ["variant3"] });
  if (e === "working") return g({ eyes: ["variant8W12"], mouth: ["variant4"] });
  if (e === "done") return g({ eyes: ["variant4W12"], mouth: ["variant2"] });
  return g({});
}

// ---- Glass: abstract, no face: every expression is the same drawing (the caller dims it asleep).
const GLASS_BG = ["5a3ff0", "eb6247", "47b4eb", "47eb99", "ebb447", "eb47d0", "7e47eb", "47ebd0"];
function glassDraw(i: number): string {
  return clean(draw(glass, { seed: `g${i}`, backgroundColor: [GLASS_BG[i % 8]!], shape1: ["gradient"[i % 8]!], shape2: ["gradient"[(i * 3 + 1) % 8]!], shape1Rotation: [((i * 53) % 360) - 180, ((i * 53) % 360) - 180], shape2Rotation: [((i * 29) % 320) - 160, ((i * 29) % 320) - 160] }));
}

const FRAME: Record<Family, { zoom: number; ox: number; oy: number }> = {
  faces: { zoom: 1.55, ox: 0.5, oy: 0.3 }, friends: { zoom: 1.22, ox: 0.5, oy: 0.38 }, blobs: { zoom: 1, ox: 0.5, oy: 0.5 }, glass: { zoom: 1, ox: 0.5, oy: 0.5 },
};

const raw = new Map<string, string>();
/** The drawing of a face in an expression, without its tint. Cached. */
function drawing(fam: Family, i: number, e: Expression): string {
  const x = hasExpressions({ fam, i, tint: 0 }) ? e : "idle";
  const key = `${fam}:${i}:${x}`;
  const hit = raw.get(key);
  if (hit !== undefined) return hit;
  const s = fam === "faces" ? facesDraw(i, x) : fam === "friends" ? friendsDraw(i, x) : fam === "blobs" ? blobsDraw(i, x) : glassDraw(i);
  raw.set(key, s);
  return s;
}

/**
 * A complete svg of a drawn face on its tint, as the caller's box shows it: a square, the face framed (Faces and Friends are cropped in to the head), the tint under it. `size` is the edge in px.
 * Throws for a face that is not in the library (parseFace never returns one).
 */
export function faceSvg(spec: Exclude<FaceSpec, { fam: "img" } | { fam: "emoji" } | { fam: "file" }>, expression: Expression, size: number): string {
  if (!Number.isInteger(spec.i) || spec.i < 0 || spec.i >= PER_FAMILY) throw new Error("not a face in the library");
  const inner = drawing(spec.fam, spec.i, expression);
  const head = /<svg[^>]*viewBox="0 0 (\d+) (\d+)"[^>]*>/.exec(inner);
  const w = Number(head?.[1] ?? 100), h = Number(head?.[2] ?? 100);
  const body = inner.slice(inner.indexOf(">") + 1, inner.lastIndexOf("</svg>"));
  const f = FRAME[spec.fam];
  const tx = Math.round(w * f.ox * (1 - f.zoom)), ty = Math.round(h * f.oy * (1 - f.zoom));
  const tint = TINTS[spec.tint]!.hex;
  const g = f.zoom === 1 ? body : `<g transform="translate(${tx} ${ty}) scale(${f.zoom})">${body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${size}" height="${size}" fill="none"><rect width="${w}" height="${h}" fill="${tint}"/>${g}</svg>`;
}
