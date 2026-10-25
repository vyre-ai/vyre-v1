// A "Made by" face for a list row, drawn as an image. The shared Avatar draws a person's marble as inline svg with a blur filter and a blend mode, and an agent's face as inline svg;
// one per visible row repaints every frame of a scroll (the 100,000-row table scroll probe went from 16.8 ms to over 60 ms at p95 when the table started using it). The same artwork as a
// cached data-URI image is rasterised once per size and costs nothing per frame. The artwork is the shared marbleInner and notionistsSvg, so the face is the same one.
import { createElement, memo } from "react";
import type { ReactElement } from "react";
import { Platform, View } from "react-native";
import { Avatar, marbleInner, notionistsSvg } from "../../../../../ui/src/Avatar/index.tsx";

const cache = new Map<string, string>();

/** The face for a name as an image address. Cached by kind and name. */
export function faceUri(name: string, agent: boolean): string {
  const key = `${agent ? "a" : "p"}:${name}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const svg = agent
    ? notionistsSvg(name).replace(/^<svg(?![^>]*xmlns=)/, '<svg xmlns="http://www.w3.org/2000/svg"')
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="40" height="40">${marbleInner(name)}</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

export const FaceImage = memo(function FaceImage({ name, agent = false, size = 16 }: { name: string; agent?: boolean; size?: number }): ReactElement {
  return (
    <View aria-hidden testID={`face-${name}`} style={{ width: size, height: size, flexShrink: 0 }} {...(Platform.OS === "web" ? { dataSet: { avatar: agent ? "agent" : "person" } } : {})}>
      {Platform.OS === "web"
        ? createElement("img", { src: faceUri(name, agent), alt: "", width: size, height: size, draggable: false, "data-face": "image", style: { display: "block", width: size, height: size, borderRadius: agent ? size * 0.3 : size / 2 } })
        : <Avatar name={name} kind={agent ? "agent" : "person"} size={size} />}
    </View>
  );
});
