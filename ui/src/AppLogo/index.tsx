// ui/AppLogo: the one mark for an app, in every place that shows one (the step picker and its submenu, the step rows, the cards in Ask Vyre, the Connect an app sheet, the Vault, Services).
// It takes the app, never a file path. In order: Vyre's own glyph for a Vyre group; a built-in brand mark (ui/AppIcon's set); the app's own icon, fetched once by the server and served from Vyre,
// never hot-linked from the person's browser; otherwise a clean letter tile in a colour taken from the app's name. Sizes: 32 step row and Needs-you card, 28 picker row, 24 card header, 20 trail line.
import { createElement, memo, useState } from "react";
import type { ReactElement } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { AppIcon, brandForName, markKey, toolKey } from "../AppIcon/index.tsx";

export type LogoSize = 20 | 24 | 28 | 32;

export interface AppLogoProps {
  /** An app id (`google`, `lawmatics`), or `vyre:<group>` for one of Vyre's own groups. */
  app: string;
  /** The name a person knows it by: the letter tile and the accessible label come from it. */
  name: string;
  size?: LogoSize;
  /** The app's own icon, as the server serves it. Used only when the app has no built-in mark. */
  iconUrl?: string | undefined;
  /** A Vyre group's glyph: stroke paths on a 16 px grid. */
  glyph?: readonly string[] | undefined;
  testID?: string;
}

export type LogoKind = "glyph" | "builtin" | "fetched" | "letter";

const brandOf = (app: string): string => brandForName(app) ?? app;

export function logoKind(p: {
  app: string;
  iconUrl?: string | undefined;
  glyph?: readonly string[] | undefined;
}): LogoKind {
  if (p.glyph && p.glyph.length > 0) return "glyph";
  const brand = brandOf(p.app);
  if (markKey(brand) !== null || toolKey(brand) !== null) return "builtin";
  if (p.iconUrl) return "fetched";
  return "letter";
}

/** A hue, 0 to 359, taken from the name so one app always wears one colour. */
export function tileColor(name: string): string {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return String(h);
}

const web = Platform.OS === "web";

function tile(size: number): object {
  return {
    width: size,
    height: size,
    borderRadius: "28%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
    ...(web ? { boxShadow: "inset 0 0 0 1px var(--line)" } : {}),
  };
}

export const AppLogo = memo(function AppLogo({
  app,
  name,
  size = 28,
  iconUrl,
  glyph,
  testID,
}: AppLogoProps): ReactElement {
  const [broken, setBroken] = useState(false);
  const id = testID ?? `applogo-${app}`;
  const kind = logoKind({ app, iconUrl: broken ? undefined : iconUrl, glyph });
  if (kind === "builtin") return <AppIcon brand={brandOf(app)} name={name} size={size} testID={id} />;
  if (kind === "glyph") {
    const s = Math.round(size * 0.57);
    return (
      <View
        testID={id}
        accessible={false}
        accessibilityLabel={name}
        style={[tile(size) as object, { backgroundColor: "var(--hover)" as string }]}
      >
        {web
          ? createElement("svg", {
              viewBox: "0 0 16 16",
              width: s,
              height: s,
              "aria-hidden": true,
              fill: "none",
              stroke: "var(--ink-2)",
              strokeWidth: 1.3,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              dangerouslySetInnerHTML: { __html: (glyph ?? []).map((d) => `<path d="${d}"/>`).join("") },
            })
          : null}
      </View>
    );
  }
  if (kind === "fetched") {
    return (
      <View
        testID={id}
        accessible={false}
        accessibilityLabel={name}
        style={[tile(size) as object, { backgroundColor: "#fff" }]}
      >
        <Image
          source={{ uri: iconUrl! }}
          accessibilityIgnoresInvertColors
          style={{ width: Math.round(size * 0.7), height: Math.round(size * 0.7) }}
          resizeMode="contain"
          onError={() => setBroken(true)}
        />
      </View>
    );
  }
  const hue = tileColor(name);
  return (
    <View
      testID={id}
      accessible={false}
      accessibilityLabel={name}
      style={[tile(size) as object, { backgroundColor: `hsl(${hue} 45% 50% / 0.16)` as string }]}
    >
      <Text style={[styles.letter, { fontSize: Math.round(size * 0.46), color: `hsl(${hue} 45% 36%)` as string }]}>
        {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({ letter: { fontWeight: "600", letterSpacing: -0.1 } });
