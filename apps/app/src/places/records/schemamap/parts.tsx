// Small pieces shared by the Schema map and the Record types list: the type tile and the web-only helpers.
import type { ReactElement } from "react";
import { Platform, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { hueOf } from "./model.ts";

export const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
export const sx = (o: Record<string, unknown>): ViewStyle => o as unknown as ViewStyle;

/** A record type's tile: its first letter on a translucent colour taken from its key, so it reads on every skin and stays the same colour everywhere. */
export function TypeTile({ type, title, size = 22 }: { type: string; title: string; size?: number }): ReactElement {
  const h = hueOf(type);
  return (
    <View aria-hidden testID={`tile-${type}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: `hsla(${h}, 65%, 52%, 0.22)` as string, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Text style={{ color: `hsl(${h}, 55%, 46%)` as string, fontSize: Math.max(10, Math.round(size * 0.5)), fontWeight: "600" }}>{(title.trim()[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}
