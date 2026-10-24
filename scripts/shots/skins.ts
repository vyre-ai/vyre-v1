// Place skins for shots (spec 1: one skin per Space, applied to every place).
// shell.html defaults: Northwind is system (Paper by day), Harbor Studio is linen.
// Phone width is 390 (spec 3.11). Desktop shots are 1280 wide (ARCH 10.1 screen tests).

import { nativeTokens, skinById, system, typeTokens } from "../../ui/src/tokens/skins.ts";

export const PHONE_WIDTH = 390;
export const DESKTOP_WIDTH = 1280;
export const PHONE_HEIGHT = 844;
export const DESKTOP_HEIGHT = 900;

export const DENSITIES = ["regular", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

export interface PlaceSkin {
  space: string;
  skinId: string;
  tokens: Record<string, string>;
}

/** Compact on a phone-width viewport. Regular at desktop width. */
export function defaultDensity(width: number): Density {
  return width <= PHONE_WIDTH ? "compact" : "regular";
}

/** 390x844 matches the phone walk. Desktop keeps the 900px height of that walk at 1280 wide. */
export function heightFor(width: number): number {
  return width <= PHONE_WIDTH ? PHONE_HEIGHT : DESKTOP_HEIGHT;
}

const PLACES = ["Northwind", "Harbor Studio"] as const;
export type PlaceName = (typeof PLACES)[number];

export function isPlaceName(name: string): name is PlaceName {
  return (PLACES as readonly string[]).includes(name);
}

/** Tokens for a place skin. Unknown names throw. */
export function placeSkin(name: string): PlaceSkin {
  if (name === "Northwind") {
    return { space: "Northwind", skinId: "system", tokens: { ...typeTokens, ...system.light } };
  }
  if (name === "Harbor Studio") {
    const linen = skinById("linen");
    if (!linen) throw new Error("Unknown skin: linen");
    return { space: "Harbor Studio", skinId: "linen", tokens: { ...typeTokens, ...nativeTokens(linen) } };
  }
  throw new Error(`Unknown skin: ${name}`);
}
