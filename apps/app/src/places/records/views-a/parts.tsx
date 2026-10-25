// The small pieces a card and a list row are made of: a tag for a choice, a face and a first name for a person, a plain value for the rest. Colours are skin tokens, so a skin switch repaints.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Face, Glyph } from "../sidebar/parts.tsx";
import { cellText, hueOf, isNumeric, optionsOf } from "../table/model.ts";
import type { FieldDef, RecordRow } from "./model.ts";

/** A text colour for a hue that reads on its own tint in every skin: the hue mixed into the skin's ink, so it darkens on paper and lightens on graphite. */
export const inkOf = (hue: number): string => `color-mix(in srgb, hsl(${hue}, 70%, 50%) 38%, var(--ink))`;

export function Tag({ field, value }: { field: FieldDef; value: string }): ReactElement {
  const opt = optionsOf(field).find((o) => o.key === value);
  const hue = opt?.color && /^\d+$/.test(opt.color) ? Number(opt.color) : hueOf(value);
  return (
    <View testID={`tag-${field.key}`} style={[p.tag, { backgroundColor: `hsla(${hue}, 65%, 52%, 0.16)` }]}>
      <Text numberOfLines={1} style={[p.tagText, { color: inkOf(hue) }]}>{opt?.title ?? value}</Text>
    </View>
  );
}

/** One field's value on a card: a tag for a choice, a face for a person, stars for a rating, a tick for a checkbox, plain text for the rest. Empty draws nothing. */
export function Value({ field, row, names }: { field: FieldDef; row: RecordRow; names: (id: string) => string }): ReactElement | null {
  const v = row.fields[field.key];
  if (v === undefined || v === null || v === "") return null;
  if ((field.type === "choice" || field.type === "status") && typeof v === "string") return <Tag field={field} value={v} />;
  if (field.type === "checkbox") return v === true ? <View style={p.inline}><Glyph name="check" size={12} color="var(--ink-2)" width={1.8} /><Text style={p.plain}>{field.title}</Text></View> : null;
  if (field.type === "person") return <View style={p.inline}><Face name={names(String(v))} size={16} /><Text numberOfLines={1} style={p.plain}>{names(String(v)).split(" ")[0]}</Text></View>;
  if (field.type === "rating" && typeof v === "number") return <Text style={p.stars} accessibilityLabel={`${v} of 5`}>{"★".repeat(Math.max(0, Math.min(5, v)))}</Text>;
  return <Text numberOfLines={1} style={[p.plain, isNumeric(field) && p.num]}>{cellText(field, v, names)}</Text>;
}

/** The same value as plain text, for the line under a list row. A person reads by first name; a checkbox reads by its field's name. */
export function valueText(field: FieldDef, row: RecordRow, names: (id: string) => string): string {
  const v = row.fields[field.key];
  if (v === undefined || v === null || v === "") return "";
  if (field.type === "person") return names(String(v)).split(" ")[0] ?? "";
  if (field.type === "checkbox") return v === true ? field.title : "";
  if (field.type === "rating" && typeof v === "number") return `${v} of 5`;
  return cellText(field, v, names);
}

/** A picture in a box whose size is fixed before it loads, so nothing moves when it arrives. On the web the browser loads it only when it nears the screen. */
export function LazyImage({ url, name, width, height }: { url: string; name: string; width: number; height: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement("img", { src: url, alt: name, loading: "lazy", decoding: "async", width, height, draggable: false, "data-testid": "cover-image", style: { width, height, objectFit: "cover", display: "block" } });
}

export const p = StyleSheet.create({
  tag: { height: 20, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center", maxWidth: "100%", alignSelf: "flex-start" },
  tagText: { fontSize: 12, fontWeight: "500" },
  inline: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  plain: { fontSize: 12, color: "var(--ink-2)" as string, flexShrink: 1 },
  num: { fontVariant: ["tabular-nums"] },
  stars: { fontSize: 11.5, color: "var(--warn)" as string, letterSpacing: 1 },
});
