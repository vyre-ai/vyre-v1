// A small chart of one series: a line and the soft area under it, drawn as one inline svg that fills its box. A quiet stretch is a gap, not a flat line (ops-model.ts, paths).
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, View } from "react-native";
import { paths } from "./ops-model.ts";

const W = 200;

export function Chart({
  series,
  height,
  testID,
  strokeWidth = 1.5,
}: {
  series: readonly (number | null)[];
  height: number;
  testID?: string;
  strokeWidth?: number;
}): ReactElement {
  const p = paths(series, W, height);
  const markup = `<svg viewBox="0 0 ${W} ${height}" width="100%" height="${height}" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="${p.area}" fill="var(--accent)" fill-opacity="0.16" stroke="none"/><path d="${p.line}" stroke="var(--accent)" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  return (
    <View testID={testID} style={{ height, width: "100%", overflow: "hidden" }} accessibilityElementsHidden>
      {Platform.OS === "web" && p.line !== ""
        ? createElement("div", {
            style: { display: "flex", width: "100%", height },
            dangerouslySetInnerHTML: { __html: markup },
          })
        : null}
    </View>
  );
}
