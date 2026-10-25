// A person's face for a table cell, drawn as an image. The shared Avatar draws the marble as inline svg with a blur filter and a blend mode; one of those per visible row repaints
// every frame of a scroll (the 100,000-row scroll probe went from 16.8 ms to over 60 ms at p95 when the table started using it). The same marble as a cached data-URI image is
// rasterised once per size and costs nothing per frame. The artwork is the shared marbleInner, so the face is the same one.
import { createElement, memo } from "react";
import type { ReactElement } from "react";
import { Platform, View } from "react-native";
import { Avatar, marbleInner } from "../../../../../../ui/src/Avatar/index.tsx";

const cache = new Map<string, string>();

/** The marble for a name as an image address. Cached by name. */
export function marbleUri(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="40" height="40">${marbleInner(name)}</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(name, uri);
  return uri;
}

export const FaceImage = memo(function FaceImage({ name, size = 18 }: { name: string; size?: number }): ReactElement {
  return (
    <View aria-hidden testID={`face-${name}`} style={{ width: size, height: size, flexShrink: 0 }}>
      {Platform.OS === "web"
        ? createElement("img", { src: marbleUri(name), alt: "", width: size, height: size, draggable: false, "data-face": "image", style: { display: "block", width: size, height: size, borderRadius: size / 2 } })
        : <Avatar name={name} kind="person" size={size} />}
    </View>
  );
});
