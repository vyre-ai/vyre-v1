// The mark of a step: the app's logo when the step talks to an app, the step's own glyph on a quiet tile for the rest. One tile size so a list of steps lines up.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";
import { brandForStep } from "./brand.ts";
import { Glyph } from "./icons.tsx";
import type { IconKey } from "./model.ts";

export function StepLogo({ stepKey, input, icon, name, size = 28 }: { stepKey: string; input?: Readonly<Record<string, unknown>>; icon: IconKey; name: string; size?: number }): ReactElement {
  const brand = brandForStep(stepKey, input);
  if (brand) return <AppIcon brand={brand} name={name.split(":")[0] ?? name} size={size} />;
  return <View style={[s.tile, { width: size, height: size }]}><Glyph name={icon} size={Math.round(size * 0.57)} color="var(--ink-2)" /></View>;
}

const s = StyleSheet.create({
  tile: { borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string, flexShrink: 0 },
});
