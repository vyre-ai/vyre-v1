// The agent face: DiceBear Notionists (MIT library, CC0 art) seeded by the agent's name on a soft tint, exactly as the prototype draws it
// (createAvatar(notionists, { seed, size: 64, backgroundColor: [hsl(hue 55% 86%)], backgroundType: ["solid"] })). Pure and cached by seed: the same seed returns the same svg.

import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";
import { faceTint } from "./faces.ts";

const cache = new Map<string, string>();

/** The face as a complete svg string (viewBox 0 0 64 64 scaled by the caller's box). */
export function notionistsSvg(seed: string): string {
  const hit = cache.get(seed);
  if (hit !== undefined) return hit;
  const svg = createAvatar(notionists, { seed, size: 64, backgroundColor: [faceTint(seed)], backgroundType: ["solid"] }).toString();
  cache.set(seed, svg);
  return svg;
}
