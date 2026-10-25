// ui/Avatar: the one face for a person, an agent, the assistant, an automation, a group or a Space (replaces every letter tile).
// People: a marble seeded by the name, or their photo. Agents: a DiceBear Notionists face on a soft tint, seeded by the name (as the prototype). Spaces: a letter on a tint. The assistant is the Vyre mark.
// Automations and groups get a line glyph on the neutral tile. Radius is 30% for everything but people, who are round (as the prototype's tile.a and tile.p).
// Web draws inline svg; native has no svg here, so it shows the letters on the face's tint until a native icon set lands.

import { createElement, memo, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { faceTint, hueOf, initialsOf, marbleInner } from "./faces.ts";
import { cachedFace, currentSkin, faceKey, requestFace, wrapSvg } from "./cache.ts";
import { notionistsSvg } from "./notionists.ts";
import type { AvatarKind, AvatarProps } from "./props.ts";

export type { AvatarKind, AvatarProps } from "./props.ts";
export { faceTint, hash, hueOf, initialsOf, marbleInner, marbleSpec } from "./faces.ts";
export { notionistsSvg } from "./notionists.ts";
export { cachedFace, cachedFaceCount, clearFaceCache, faceKey } from "./cache.ts";

export const AVATAR_DEFAULT_SIZE = 18;

const web = Platform.OS === "web";

/** The face svg at the caller's size: DiceBear writes width and height 64 on the root. */
function sized(markup: string, size: number): string {
  return markup.replace(/^<svg([^>]*)>/, (_m, attrs: string) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="${size}" height="${size}">`);
}

function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return web ? props : {};
}

/** The kind a name implies when the caller does not say: "Assistant" is the assistant. */
export function kindOf(name: string, kind?: AvatarKind): AvatarKind {
  if (kind === "agent" && name === "Assistant") return "assistant";
  return kind ?? "person";
}

const VYRE_MARK =
  '<path d="M5.2 6.4l6.3 11.2 4.9-8.6" fill="none" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18.6" cy="5.6" r="2.7" fill="var(--beacon, #8B7CF6)"/>';
const BOLT = '<path d="M9 1.8L4 9h3.5L7 14.2 12 7H8.5z"/>';
const PEOPLE = '<circle cx="6" cy="6" r="2.3"/><path d="M2 13c.5-2.3 2.1-3.5 4-3.5s3.5 1.2 4 3.5"/><circle cx="11.5" cy="6.5" r="1.8"/><path d="M11.5 9.5c1.4 0 2.4.9 2.8 2.5"/>';

/** RN styles have no `color` key in their types; the web build passes it through so inline svg takes currentColor from the tile. */
const inkOf = (color: string): ViewStyle => ({ color }) as unknown as ViewStyle;

const ring = (): ViewStyle => (web ? ({ boxShadow: "inset 0 0 0 1px var(--line)" } as ViewStyle) : { borderWidth: StyleSheet.hairlineWidth, borderColor: "var(--line)" as string });

function svg(markup: string, size: number, viewBox: string, extra: Record<string, unknown> = {}): ReactElement {
  return createElement("svg", { viewBox, width: size, height: size, "aria-hidden": true, style: { display: "block" }, dangerouslySetInnerHTML: { __html: markup }, ...extra });
}

export const Avatar = memo(function Avatar({ name, kind: kindProp, size = AVATAR_DEFAULT_SIZE, photo, running = false, present = false, testID }: AvatarProps): ReactElement {
  const kind = kindOf(name, kindProp);
  // A person's marble and an agent's face are drawn once to a cached bitmap per seed, kind, size and skin; rows reuse it as an <img>.
  const drawn = web && ((kind === "person" && !photo) || kind === "agent");
  const key = faceKey(name, kind, size, currentSkin());
  const [, bump] = useState(0);
  const bitmap = drawn ? cachedFace(key) : undefined;
  useEffect(() => {
    if (!drawn || cachedFace(key) !== undefined) return;
    requestFace(key, kind === "person" ? wrapSvg(marbleInner(name), "0 0 80 80", size) : sized(notionistsSvg(name), size), size, () => bump((n) => n + 1));
  }, [drawn, key, kind, name, size]);
  const id = testID ?? `avatar-${name}`;
  const round = kind === "person";
  const box: ViewStyle = { width: size, height: size, borderRadius: round ? size / 2 : ("30%" as unknown as number), alignItems: "center", justifyContent: "center", flexShrink: 0 };
  const data = webProps({ dataSet: { avatar: kind } });
  let face: ReactElement;
  let clip = true;

  if (kind === "person" && photo) {
    face = web ? createElement("img", { src: photo, alt: "", width: size, height: size, draggable: false, style: { display: "block", objectFit: "cover", width: size, height: size } }) : <Image accessibilityIgnoresInvertColors source={{ uri: photo }} style={{ width: size, height: size }} />;
  } else if (bitmap !== undefined) {
    face = createElement("img", { src: bitmap, alt: "", width: size, height: size, draggable: false, decoding: "async", style: { display: "block", width: size, height: size }, "data-face": "cached" });
  } else if (kind === "person") {
    face = web ? svg(marbleInner(name), size, "0 0 80 80") : <NativeLetters name={name} size={size} person tint={`hsl(${hueOf(name)}, 45%, 70%)`} />;
  } else if (kind === "agent") {
    face = web ? createElement("span", { style: { display: "block", width: size, height: size, lineHeight: 0 }, dangerouslySetInnerHTML: { __html: sized(notionistsSvg(name), size) } }) : <NativeLetters name={name} size={size} tint={`#${faceTint(name)}`} />;
  } else if (kind === "space") {
    face = <NativeLetters name={name} size={size} tint={`hsla(${hueOf(name)}, 60%, 50%, 0.18)`} ink={`hsl(${hueOf(name)}, 55%, 46%)`} />;
  } else if (kind === "assistant") {
    const s = Math.round(size * 0.78);
    face = web ? svg(VYRE_MARK, s, "0 0 24 24", { className: "vmark" }) : <Text style={{ color: "var(--ink)" as string, fontWeight: "700", fontSize: Math.round(size * 0.5) }}>V</Text>;
    clip = false;
  } else {
    const s = Math.round(size * 0.62);
    const path = kind === "automation" ? BOLT : PEOPLE;
    face = web ? svg(path, s, "0 0 16 16", { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }) : <Text style={{ fontSize: Math.round(size * 0.5), color: "var(--ink-2)" as string }}>{kind === "automation" ? "+" : "··"}</Text>;
  }

  const neutral = kind === "assistant" || kind === "automation" || kind === "group";
  const glyphColor = kind === "assistant" ? "var(--ink)" : "var(--ink-2)";
  return (
    <View testID={id} accessible accessibilityRole="image" accessibilityLabel={name} style={{ width: size, height: size, flexShrink: 0 }} {...data}>
      <View style={[box, clip && { overflow: "hidden" }, neutral && { backgroundColor: "var(--sunk)" as string, ...ring() }, neutral && inkOf(glyphColor)]}>{face}</View>
      {running ? <View testID={`${id}-running`} style={[styles.dot, styles.right, dotSize(size)]} /> : null}
      {present ? <View testID={`${id}-present`} style={[styles.dot, styles.left, dotSize(size)]} /> : null}
    </View>
  );
});

function dotSize(size: number): ViewStyle {
  const d = Math.max(7, Math.round(size * 0.28));
  return { width: d, height: d, borderRadius: d / 2 };
}

function NativeLetters({ name, size, person = false, tint, ink = "#1F1F23" }: { name: string; size: number; person?: boolean; tint: string; ink?: string }): ReactElement {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", backgroundColor: tint }}>
      <Text style={{ color: ink, fontWeight: "600", fontSize: Math.max(9, Math.round(size * 0.48)) }}>{initialsOf(name, size, person)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { position: "absolute", backgroundColor: "var(--ok)" as string, ...(web ? ({ boxShadow: "0 0 0 2px var(--side)" } as ViewStyle) : {}) },
  right: { right: -3, bottom: -3 },
  left: { left: -1, bottom: -1 },
});
