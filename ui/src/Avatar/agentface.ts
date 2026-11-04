// A drawn agent face chosen from the library, as the agent stores it in `face`: "av1:<family>:<index>:<tint>" for the four drawn families (faces, friends, blobs, glass), "av1:emoji:<emoji>:<tint>" for an emoji on a tint,
// "av1:img:<data url>" for an uploaded picture. Anything else in `face` is an older seed (a slug of the name, or "pick-..."), which keeps drawing the face it always drew until someone picks again.
// Pure: no drawing here, so the picker, the stores and the tests share it.

export type Family = "faces" | "friends" | "blobs" | "glass";
export type Expression = "idle" | "working" | "asleep" | "done";

export type FaceSpec =
  | { fam: Family; i: number; tint: number }
  | { fam: "emoji"; e: string; tint: number }
  | { fam: "img"; url: string };

export const FAMILIES: readonly { key: Family | "emoji" | "upload"; label: string }[] = [
  { key: "faces", label: "Faces" }, { key: "friends", label: "Friends" }, { key: "blobs", label: "Blobs" }, { key: "glass", label: "Glass" }, { key: "emoji", label: "Emoji" }, { key: "upload", label: "Upload" },
];
export const DRAWN: readonly Family[] = ["faces", "friends", "blobs", "glass"];
/** How many curated faces each drawn family offers. */
export const PER_FAMILY = 24;
/** The tints a face can sit on: soft, and good on paper and graphite alike. */
export const TINTS: readonly { name: string; hex: string }[] = [
  { name: "Violet", hex: "#E9E3FF" }, { name: "Coral", hex: "#FFE3D6" }, { name: "Mint", hex: "#D9F2E5" }, { name: "Sun", hex: "#FFF0C7" },
  { name: "Sky", hex: "#D9E9FF" }, { name: "Rose", hex: "#FFDDEB" }, { name: "Stone", hex: "#E4E1EA" }, { name: "Teal", hex: "#D3EFEF" },
];
export const EMOJI: readonly string[] = ["🦊", "🐙", "🦉", "🐝", "🐳", "🦄", "🐱", "🐼", "🦋", "🐸", "🌵", "🍄", "🐧", "🦔", "🐨", "🦁", "🐯", "🐰", "🌻", "🍋", "🪐", "⚡", "🔭", "🧭"];
/** An uploaded picture is kept inline in `face`, so it is small: a square of at most 192 px, about 24 KB. */
export const IMG_MAX_CHARS = 32_000;

const PREFIX = "av1:";
const FAMS = new Set<string>(DRAWN);

/** The stored text for a face. */
export function formatFace(s: FaceSpec): string {
  if (s.fam === "img") return `${PREFIX}img:${s.url}`;
  if (s.fam === "emoji") return `${PREFIX}emoji:${s.e}:${s.tint}`;
  return `${PREFIX}${s.fam}:${s.i}:${s.tint}`;
}

/** The face a stored text names, or null for anything older or malformed (those keep their old drawing). */
export function parseFace(text: string | undefined | null): FaceSpec | null {
  if (typeof text !== "string" || !text.startsWith(PREFIX)) return null;
  const rest = text.slice(PREFIX.length);
  if (rest.startsWith("img:")) {
    const url = rest.slice(4);
    return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) && url.length <= IMG_MAX_CHARS ? { fam: "img", url } : null;
  }
  const [fam, a, b] = rest.split(":");
  const tint = Number(b);
  if (!Number.isInteger(tint) || tint < 0 || tint >= TINTS.length) return null;
  if (fam === "emoji") return a !== undefined && EMOJI.includes(a) ? { fam: "emoji", e: a, tint } : null;
  if (fam !== undefined && FAMS.has(fam)) {
    const i = Number(a);
    return Number.isInteger(i) && i >= 0 && i < PER_FAMILY ? { fam: fam as Family, i, tint } : null;
  }
  return null;
}

export const isFace = (text: string | undefined | null): boolean => parseFace(text) !== null;

/** The key a face is told apart by when looking for one nobody wears yet (the tint does not make a face different). */
export const faceKeyOf = (s: FaceSpec): string => (s.fam === "img" ? "img" : s.fam === "emoji" ? `emoji:${s.e}` : `${s.fam}:${s.i}`);

/** A face no one in the Space wears yet, from the drawn families first. `taken` is every stored face text in the Space. Same inputs and `random` give the same answer. */
export function suggestFace(taken: Iterable<string | undefined>, random: () => number = Math.random): FaceSpec {
  const used = new Set<string>();
  for (const t of taken) { const p = parseFace(t); if (p) used.add(faceKeyOf(p)); }
  const tint = Math.floor(random() * TINTS.length) % TINTS.length;
  const open: FaceSpec[] = [];
  for (const fam of DRAWN) for (let i = 0; i < PER_FAMILY; i++) if (!used.has(`${fam}:${i}`)) open.push({ fam, i, tint });
  if (open.length > 0) return open[Math.floor(random() * open.length) % open.length]!;
  for (const e of EMOJI) if (!used.has(`emoji:${e}`)) return { fam: "emoji", e, tint };
  return { fam: "faces", i: Math.floor(random() * PER_FAMILY) % PER_FAMILY, tint };
}

/** A random face of one family (Shuffle in the picker). */
export function shuffleFace(fam: Family | "emoji", random: () => number = Math.random): FaceSpec {
  const tint = Math.floor(random() * TINTS.length) % TINTS.length;
  if (fam === "emoji") return { fam: "emoji", e: EMOJI[Math.floor(random() * EMOJI.length) % EMOJI.length]!, tint };
  return { fam, i: Math.floor(random() * PER_FAMILY) % PER_FAMILY, tint };
}

/** The tint a face sits on, as a colour. */
export const tintHex = (s: FaceSpec): string => (s.fam === "img" ? "transparent" : TINTS[s.tint]!.hex);

/** What a face does for a state: an agent that works looks focused, one that finished smiles, one that sleeps has closed eyes (Faces, Friends and Blobs only; the others do not change). */
export const hasExpressions = (s: FaceSpec): boolean => s.fam === "faces" || s.fam === "friends" || s.fam === "blobs";

/** The emoji on its tint, as a complete svg, so a face of any kind is one picture. */
export function emojiSvg(e: string, tint: number, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" fill="${TINTS[tint]!.hex}"/><text x="50" y="52" font-size="54" text-anchor="middle" dominant-baseline="central">${e}</text></svg>`;
}
