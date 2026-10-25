// ui/AppIcon: the one tile for an app or service, from one shared set of real brand marks (copied from the prototype's vault logos).
// Neutral ground (--sunk), one ring (--line), 28% radius, the mark in the brand's own colour (ink when the brand is black).
// Web draws inline svg; native has no svg here, so it shows the brand's first letter until a native icon set lands.

import { createElement, memo } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { BRANDS } from "./brands.ts";
import { markKey } from "./domains.ts";
import type { AppIconProps } from "./props.ts";

export type { AppIconProps } from "./props.ts";
export { BRANDS } from "./brands.ts";
export type { BrandMark } from "./brands.ts";
export { brandForDomain, brandForName, brandForUrl, markKey } from "./domains.ts";

export const APP_ICON_DEFAULT_SIZE = 28;

const web = Platform.OS === "web";

function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return web ? props : {};
}

/** The generic glyphs of the prototype (a card, a web login, a blank item): line icons on the same tile. */
const GLYPHS: Record<string, string> = {
  card: '<rect x="2" y="3.5" width="12" height="9" rx="1.8"/><path d="M2 6.8h12M4.5 10h2.5"/>',
  login: '<circle cx="8" cy="8" r="5.8"/><path d="M2.2 8h11.6M8 2.2c2 2 2 9.6 0 11.6M8 2.2c-2 2-2 9.6 0 11.6"/>',
  blank: '<path d="M6 3C4.3 3 4.5 4.5 4.5 6S4 7.8 3 8c1 .2 1.5.5 1.5 2s-.2 3 1.5 3M10 3c1.7 0 1.5 1.5 1.5 3s.5 1.8 1.5 2c-1 .2-1.5.5-1.5 2s.2 3-1.5 3"/>',
};

/** The mark's edge inside the tile: bigger on small tiles so it stays readable (as the prototype). */
export function markSize(size: number): number {
  return Math.round(size * (size < 24 ? 0.7 : 0.56));
}

/** The letter a brand without a mark shows: the name's first letter, upper case. */
export function letterOf(brand: string, name?: string): string {
  const src = (name ?? brand).trim();
  return Array.from(src)[0]?.toUpperCase() ?? "?";
}

function tileStyle(size: number): ViewStyle {
  const ring = web ? ({ boxShadow: "inset 0 0 0 1px var(--line)" } as ViewStyle) : { borderWidth: StyleSheet.hairlineWidth, borderColor: "var(--line)" as string };
  return { width: size, height: size, borderRadius: "28%" as unknown as number, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, ...ring };
}

export const AppIcon = memo(function AppIcon({ brand, size = APP_ICON_DEFAULT_SIZE, name, testID }: AppIconProps): ReactElement {
  const label = name ?? brand;
  const id = testID ?? `appicon-${brand}`;
  const glyph = GLYPHS[brand];
  if (glyph) {
    const s = Math.round(size * 0.55);
    return (
      <View testID={id} accessible={false} accessibilityLabel={label} style={tileStyle(size)} {...webProps({ dataSet: { appicon: brand } })}>
        {web ? (
          createElement("svg", { viewBox: "0 0 16 16", width: s, height: s, "aria-hidden": true, fill: "none", stroke: "var(--ink-2)", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", dangerouslySetInnerHTML: { __html: glyph } })
        ) : (
          <Text style={[styles.letter, { fontSize: Math.round(size * 0.46) }]}>{brand === "card" ? "C" : brand === "login" ? "W" : "{}"}</Text>
        )}
      </View>
    );
  }
  const key = markKey(brand);
  const mark = key ? BRANDS[key] : undefined;
  if (!mark) {
    return (
      <View testID={id} accessible={false} accessibilityLabel={label} style={tileStyle(size)} {...webProps({ dataSet: { appicon: "letter" } })}>
        <Text style={[styles.letter, { fontSize: Math.round(size * 0.46) }]}>{letterOf(brand, name)}</Text>
      </View>
    );
  }
  const color = mark.c ?? "var(--ink)";
  const s = markSize(size);
  return (
    <View testID={id} accessible={false} accessibilityLabel={label} style={tileStyle(size)} {...webProps({ dataSet: { appicon: key } })}>
      {web ? (
        createElement("svg", { viewBox: "0 0 24 24", width: s, height: s, "aria-hidden": true, fill: "currentColor", style: { color, display: "block" }, dangerouslySetInnerHTML: { __html: mark.svg ?? `<path d="${mark.p ?? ""}"/>` } })
      ) : (
        <Text style={[styles.letter, { fontSize: Math.round(size * 0.46), color }]}>{letterOf(brand, name)}</Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  letter: { color: "var(--ink-2)" as string, fontWeight: "600", letterSpacing: -0.1 },
});
