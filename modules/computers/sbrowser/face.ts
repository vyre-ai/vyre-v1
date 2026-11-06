// The agent's face for its browser's start page: the same DiceBear Notionists face the app shows (ui/src/Avatar/notionists.ts), drawn once into a small SVG and stored with the profile, so the page never
// fetches anything when it is viewed. The art and tint follow the app's: seeded by the agent's face seed on a soft tint (hsl(hue 55% 86%)). The library is loaded when first needed; a server without it
// leaves the page with the agent's initial, which is what it showed before.
const HUES = [250, 160, 28, 205, 330, 95, 12, 280];
const hash = (s: string): number => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function hslHex(h: number, s: number, l: number): string {
  const sat = s / 100, lig = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number): number => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("");
}
export const faceTint = (seed: string): string => hslHex(HUES[hash(seed) % HUES.length] as number, 55, 86);

const cache = new Map<string, string | null>();
const load = (name: string): Promise<Record<string, unknown>> => import(name) as Promise<Record<string, unknown>>;

/** The face as an SVG string (viewBox 0 0 64 64), or null when the drawing library is not here. */
export async function faceSvg(seed: string): Promise<string | null> {
  if (!seed) return null;
  if (cache.has(seed)) return cache.get(seed) ?? null;
  let svg: string | null = null;
  try {
    const core = (await load("@dicebear/core")) as { createAvatar: (style: unknown, o: Record<string, unknown>) => { toString(): string } };
    const style = await load("@dicebear/notionists");
    svg = core.createAvatar(style, { seed, size: 64, backgroundColor: [faceTint(seed)], backgroundType: ["solid"] }).toString();
  } catch { svg = null; }
  cache.set(seed, svg);
  return svg;
}
