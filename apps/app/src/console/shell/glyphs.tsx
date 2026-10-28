// The Console's small icon set, drawn as SVG on web (the app keeps its own; apps never import each other). Sizes and stroke follow the prototype's console (con-build/console.css).
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, View } from "react-native";

const web = Platform.OS === "web";

export const PATHS: Readonly<Record<string, readonly string[]>> = {
  overview: ["M3 3h4.500v4.500H3zM8.500 3H13v4.500H8.500zM3 8.500h4.500V13H3zM8.500 8.500H13V13H8.500z"],
  people: ["M6 7.500a2.300 2.300 0 100-4.600 2.300 2.300 0 000 4.600z", "M1.800 13c.5-2.200 2.200-3.400 4.200-3.400s3.700 1.200 4.200 3.400", "M10.500 3.300a2.300 2.300 0 010 4.300M12 9.800c1.300.5 2.100 1.600 2.400 3.200"],
  agent: ["M3.500 5.500h9v7h-9z", "M8 5.500V3M6 9h.01M10 9h.01"],
  data: ["M3 4.500c0-1 2.200-1.800 5-1.800s5 .8 5 1.800-2.200 1.800-5 1.800-5-.8-5-1.800z", "M3 4.500v7c0 1 2.200 1.800 5 1.800s5-.8 5-1.800v-7"],
  ai: ["M5 5h6v6H5z", "M8 2v3M8 11v3M2 8h3M11 8h3"],
  comms: ["M2.500 4.500h11v7h-11z", "M2.800 5l5.200 3.800L13.200 5"],
  plug: ["M6 2.500v3M10 2.500v3M4.500 5.500h7v2.500a3.500 3.500 0 01-7 0z", "M8 11.500v2"],
  server: ["M3 3.500h10v3.500H3zM3 9h10v3.500H3z", "M5 5.200h.01M5 10.700h.01"],
  audit: ["M4 2.500h8v11H4z", "M6 5.500h4M6 8h4M6 10.500h2"],
  space: ["M8 2.500l5 2v4c0 2.800-2.100 4.600-5 5.500-2.900-.9-5-2.700-5-5.500v-4z"],
  search: ["M7 11.500a4.500 4.500 0 100-9 4.500 4.500 0 000 9z", "M10.400 10.400L13.500 13.500"],
  chevD: ["M3.500 6L8 10.500 12.500 6"],
  chevR: ["M6 3.500L10.500 8 6 12.500"],
  check: ["M3.500 8.500l3 3 6-7"],
  warn: ["M8 2.500l6 10.500H2z", "M8 6.800v2.600M8 11.200h.01"],
  ok: ["M8 2.500a5.500 5.500 0 100 11 5.500 5.500 0 000-11z", "M5.500 8.200l1.800 1.800 3.200-3.800"],
  download: ["M8 2.500v7M5 7l3 3 3-3M3 12.500h10"],
  filter: ["M2.500 4h11M4.500 8h7M6.500 12h3"],
  x: ["M4 4l8 8M12 4l-8 8"],
  assistant: ["M8 2.500l1.300 3.200 3.200 1.300-3.200 1.300L8 11.500 6.700 8.300 3.500 7l3.200-1.300z", "M12 11l.6 1.400 1.400.6-1.400.6L12 15l-.6-1.400L10 13l1.400-.6z"],
  open: ["M6.500 3.500H3.500v9h9v-3M9.500 2.500h4v4M13.500 2.500L7.500 8.500"],
  gear: ["M8 10a2 2 0 100-4 2 2 0 000 4z", "M8 2.500v1.600M8 11.900v1.600M2.500 8h1.600M11.900 8h1.600M4.100 4.100l1.100 1.100M10.800 10.800l1.100 1.100M11.900 4.100l-1.100 1.100M5.200 10.800l-1.100 1.100"],
  eye: ["M1.800 8s2.200-4 6.200-4 6.200 4 6.200 4-2.200 4-6.200 4-6.200-4-6.200-4z", "M8 9.800a1.800 1.800 0 100-3.600 1.800 1.800 0 000 3.600z"],
  lock: ["M3.500 7h9v6.500h-9z", "M5.500 7V5.200a2.500 2.500 0 015 0V7"],
  key: ["M6 9.500a3 3 0 110-6 3 3 0 010 6z", "M8.200 7.800L13 12.500M11 10.500l1.500 1.500"],
  up: ["M8 13V6M5 8.500l3-3 3 3M3 3h10"],
  mail: ["M2.500 4.500h11v7h-11z", "M2.800 5l5.200 3.800L13.200 5"],
  pulse: ["M2 8h2.500L6 4.500 8.500 11.500 10 8h4"],
};

export function Glyph({ name, size = 15, color = "var(--ink-3)" }: { name: string; size?: number; color?: string }): ReactElement | null {
  if (!web) return null;
  const d = PATHS[name] ?? PATHS["overview"]!;
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } },
    ...d.map((p) => createElement("path", { key: p, d: p })));
}

export type Tone = "ok" | "warn" | "bad" | "off";
export const TONE_COLOR: Readonly<Record<Tone, string>> = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--danger)", off: "var(--ink-4)" };

/** A status dot: state as a small dot and a word, never a pill. */
export function Dot({ tone, size = 7, label }: { tone: Tone; size?: number; label?: string }): ReactElement {
  return <View accessibilityLabel={label} testID={`dot-${tone}`} style={[s.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: TONE_COLOR[tone] as string }]} />;
}

const s = StyleSheet.create({ dot: { flexShrink: 0 } });
