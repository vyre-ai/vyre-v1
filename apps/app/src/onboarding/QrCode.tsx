// A QR code for a link, drawn as one SVG path on a white tile (phones scan dark on light in either theme). Web only; elsewhere the link text stands in.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { toMatrix } from "./qr.ts";

const QUIET = 3;

/** The SVG path of the dark modules, one horizontal run per segment. */
export function qrPath(m: readonly (readonly boolean[])[]): string {
  let d = "";
  for (let r = 0; r < m.length; r++) {
    let c = 0;
    while (c < m.length) {
      if (!m[r]![c]) { c++; continue; }
      let e = c;
      while (e < m.length && m[r]![e]) e++;
      d += `M${c + QUIET} ${r + QUIET}h${e - c}v1h-${e - c}z`;
      c = e;
    }
  }
  return d;
}

export function QrCode({ text, size = 168 }: { text: string; size?: number }): ReactElement | null {
  const m = toMatrix(text);
  if (m === null || Platform.OS !== "web") return null;
  const box = m.length + QUIET * 2;
  return (
    <View testID="pair-qr" accessibilityLabel="QR code for the pairing link" style={[s.tile, { width: size, height: size }]}>
      {createElement("svg", { viewBox: `0 0 ${box} ${box}`, width: size, height: size, role: "img", "aria-label": "QR code", style: { display: "block", shapeRendering: "crispEdges" } },
        createElement("rect", { width: box, height: box, fill: "#fff" }),
        createElement("path", { d: qrPath(m), fill: "#111" }))}
    </View>
  );
}

const s = StyleSheet.create({
  tile: { borderRadius: 12, overflow: "hidden", backgroundColor: "#fff", borderWidth: 1, borderColor: "var(--line)" as string, alignSelf: "flex-start" },
});
