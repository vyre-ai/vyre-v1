// Vault shared pieces: stroke icons, the letter tile that stands in for a logo, small buttons and the quiet line with Undo. Sizes and colours follow the prototype's Vault;
// every colour is a skin token, so a skin switch repaints with no re-render.
import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { hueOf, letterOf } from "./model.ts";
import { brandOfName } from "../itemenv/brands.ts";
import type { Brand } from "../itemenv/brands.ts";

/** 16 px viewBox stroke icons. */
export const ICON = {
  search: ["M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z", "M10.5 10.5L14 14"],
  plus: ["M8 3v10M3 8h10"],
  all: ["M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z"],
  providers: ["M8 2v3M8 11v3M2 8h3M11 8h3M3.8 3.8l2.1 2.1M10.1 10.1l2.1 2.1M12.2 3.8l-2.1 2.1M5.9 10.1l-2.1 2.1"],
  keys: ["M6 3.5C4.8 3.5 4.5 4.3 4.5 5.2v1.2c0 .8-.5 1.6-1.5 1.6 1 0 1.5.8 1.5 1.6v1.2c0 .9.3 1.7 1.5 1.7", "M10 3.5c1.2 0 1.5.8 1.5 1.7v1.2c0 .8.5 1.6 1.5 1.6-1 0-1.5.8-1.5 1.6v1.2c0 .9-.3 1.7-1.5 1.7"],
  logins: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M2.8 8h10.4M8 2.6c1.5 1.5 2.2 3.3 2.2 5.4S9.5 11.9 8 13.4C6.5 11.9 5.8 10.1 5.8 8S6.5 4.1 8 2.6z"],
  cards: ["M3 4.5h10a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5a1 1 0 011-1z", "M2 7h12"],
  health: ["M8 2l5 1.8v4c0 3-2.2 5-5 6.2C5.2 12.8 3 10.8 3 7.8v-4z"],
  requested: ["M5 11a2.5 2.5 0 110-5 2.5 2.5 0 010 5z", "M7.5 8.5H13M11 8.5v2M13 8.5v1.5"],
  mine: ["M10.5 5.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z", "M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"],
  folder: ["M2.5 5A1.5 1.5 0 014 3.5h2.2l1.3 1.5H12A1.5 1.5 0 0113.5 6.5v5A1.5 1.5 0 0112 13H4a1.5 1.5 0 01-1.5-1.5z"],
  advanced: ["M8 10a2 2 0 100-4 2 2 0 000 4z", "M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1"],
  more: ["M3.5 8h.01", "M8 8h.01", "M12.5 8h.01"],
  eye: ["M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z", "M8 9.8a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z"],
  eyeOff: ["M2.5 2.5l11 11", "M6.2 4A6.6 6.6 0 018 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 01-2 2.5M9.8 12a6.6 6.6 0 01-1.8.5C4 12.5 1.5 8 1.5 8a11 11 0 012-2.5"],
  copy: ["M5.5 5.5h6.5a1 1 0 011 1V13a1 1 0 01-1 1H5.5a1 1 0 01-1-1V6.5a1 1 0 011-1z", "M3.5 10.5v-7a1 1 0 011-1h6"],
  lock: ["M4.5 7.5h7v5.5h-7z", "M6 7.5V5.8a2 2 0 014 0v1.7"],
  check: ["M3 8.5l3 3 7-7"],
  x: ["M4 4l8 8M12 4l-8 8"],
  share: ["M8 10V2.5M5.2 5L8 2.2 10.8 5", "M3.5 8v4.5a1 1 0 001 1h7a1 1 0 001-1V8"],
  edit: ["M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"],
  clock: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 5v3l2 1.5"],
  chevron: ["M6 3.5L10.5 8 6 12.5"],
  file: ["M4 2.5h5l3 3v8H4z", "M9 2.5v3h3"],
  wand: ["M3 13l7-7M9 3l.5 1.5L11 5l-1.5.5L9 7l-.5-1.5L7 5l1.5-.5zM12.5 8l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"],
  back: ["M10 3.5L5.5 8l4.5 4.5"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  braces: ["M6 3C4.6 3 4 3.7 4 5v1.5C4 7.4 3.5 8 2.5 8c1 0 1.5.6 1.5 1.5V11c0 1.3.6 2 2 2", "M10 3c1.4 0 2 .7 2 2v1.5c0 .9.5 1.5 1.5 1.5-1 0-1.5.6-1.5 1.5V11c0 1.3-.6 2-2 2"],
  globe: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M2.8 8h10.4M8 2.6c1.5 1.5 2.2 3.3 2.2 5.4S9.5 11.9 8 13.4C6.5 11.9 5.8 10.1 5.8 8S6.5 4.1 8 2.6z"],
  card: ["M3 4.5h10a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5a1 1 0 011-1z", "M2 7h12"],
} as const;
export type IconName = keyof typeof ICON;

/** One stroke icon. Web only (an SVG); other platforms draw nothing until their own icon set lands. */
export function Glyph({ name, size = 15, color = "var(--ink-3)" }: { name: IconName; size?: number; color?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of ICON[name]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : 1.4, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}

/** A brand mark on the one neutral tile every app shares (the prototype's .lg): the mark in its own colour, ink when the brand is black. Web only; elsewhere the tile is empty until an icon set lands. */
export function BrandTile({ brand, name, size = 32 }: { brand: Brand; name: string; size?: number }): ReactElement {
  const mark = Math.round(size * (size < 24 ? 0.7 : 0.56));
  return (
    <View aria-hidden testID={`logo-${name}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center", ...({ boxShadow: "inset 0 0 0 1px var(--line)" } as object) }}>
      {Platform.OS === "web" ? createElement("svg", { viewBox: "0 0 24 24", width: mark, height: mark, fill: "currentColor", "aria-hidden": true, style: { display: "block", color: brand.color ?? "var(--ink)" }, dangerouslySetInnerHTML: { __html: brand.svg } }) : null}
    </View>
  );
}

/** The mark of an item: its brand when the name points at one, else a letter on a wash of the name's colour (spec 2.17: real logos are fetched by the Space's server). */
export function LogoTile({ name, size = 32 }: { name: string; size?: number }): ReactElement {
  const brand = brandOfName(name);
  if (brand) return <BrandTile brand={brand} name={name} size={size} />;
  const hue = hueOf(name);
  return (
    <View aria-hidden testID={`logo-${name}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: `hsla(${hue}, 60%, 50%, 0.18)` as string, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: `hsl(${hue}, 55%, 46%)` as string, fontSize: Math.round(size * 0.46), fontWeight: "600" }}>{letterOf(name)}</Text>
    </View>
  );
}

/** A small round-cornered button: quiet by default, accent when `primary`. */
export function Btn({ label, onPress, icon, primary = false, danger = false, disabled = false, testID }: { label: string; onPress: () => void; icon?: IconName | undefined; primary?: boolean; danger?: boolean; disabled?: boolean; testID?: string | undefined }): ReactElement {
  const [over, setOver] = useState(false);
  const color = danger ? "var(--danger)" : primary ? "var(--accent-ink)" : "var(--ink)";
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} testID={testID}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.btn, primary ? s.btnPrimary : { backgroundColor: (over ? "var(--hover)" : "transparent") as string }, primary && over && { opacity: 0.9 }, disabled && { opacity: 0.45 }]}
    >
      {icon ? <Glyph name={icon} size={14} color={color as string} /> : null}
      <Text style={[s.btnText, { color: color as string }]}>{label}</Text>
    </Pressable>
  );
}

/** An icon-only button with a label for screen readers and a hover wash. */
export function IconBtn({ icon, label, onPress, testID, color = "var(--ink-3)" }: { icon: IconName; label: string; onPress: (e: unknown) => void; testID?: string | undefined; color?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} style={[s.ibtn, over && { backgroundColor: "var(--hover)" as string }]}>
      <Glyph name={icon} size={15} color={over ? "var(--ink)" : color} />
    </Pressable>
  );
}

/** The quiet line (a change and its Undo). No toast: it sits in the place and fades. */
export function QuietLine({ text, onUndo, testID }: { text: string; onUndo?: (() => void) | undefined; testID?: string | undefined }): ReactElement {
  return (
    <View style={s.line} testID={testID} accessibilityRole="status" accessibilityLiveRegion="polite">
      <View style={s.lineDot} />
      <Text style={s.lineText}>{text}</Text>
      {onUndo ? <Btn label="Undo" onPress={onUndo} testID={testID ? `${testID}-undo` : undefined} /> : null}
    </View>
  );
}

export function Mono({ children, color, size = 12.5 }: { children: ReactNode; color?: string; size?: number }): ReactElement {
  return <Text style={{ fontFamily: "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)" as string, fontSize: size, color: (color ?? "var(--ink)") as string }}>{children}</Text>;
}

const s = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 7 },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnText: { fontSize: 13, fontWeight: "500" },
  ibtn: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  lineDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: "var(--ok)" as string },
  lineText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
