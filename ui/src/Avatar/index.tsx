// ui/Avatar: the one face for a person, an agent, the assistant, an automation, a group or a Space (replaces every letter tile).
// People: a marble seeded by the name, or their photo. Agents: a DiceBear Notionists face on a soft tint, seeded by the name (as the prototype). Spaces: a letter on a tint. The assistant is the Vyre mark.
// Automations and groups get a line glyph on the neutral tile. Radius is 30% for everything but people, who are round (as the prototype's tile.a and tile.p).
// Web draws inline svg; native has no svg here, so it shows the letters on the face's tint until a native icon set lands.

import { createElement, memo, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { faceTint, hueOf, initialsOf, marbleGradient, marbleInner } from "./faces.ts";
import { cachedFace, currentSkin, faceKey, requestFace } from "./cache.ts";
import { loadLibrary, loadNotionists } from "./load.ts";
import { emojiSvg, hasExpressions, parseFace } from "./agentface.ts";
import type { Expression, FaceSpec } from "./agentface.ts";
import { injectCss } from "../theme/css.ts";
import type { AvatarKind, AvatarProps, FaceState } from "./props.ts";
import { assistantLook, isAssistantId, lookOf, pickedFace, standInOf, subscribeAssistant } from "./assistant.ts";
import { faceImageOf, requestFaceImage, subscribeFaceImages } from "./faceimages.ts";

export type { AvatarKind, AvatarProps, FaceState } from "./props.ts";
export { assistantId, assistantLook, avatarOf, isAssistantId, pickedFace, resetAssistant, setAgentFaces, setAgentStatuses, setAssistantId, setShotFaces, setAssistantLook, setStandIns, standInOf, subscribeAssistant, takenFaces } from "./assistant.ts";
export type { AvatarEntity } from "./assistant.ts";
export { faceTint, hash, hueOf, initialsOf, marbleGradient, marbleInner, marbleSpec } from "./faces.ts";
export { faceImageOf, primeFaceImage, requestFaceImage, resetFaceImages, setFaceImageLoader, subscribeFaceImages } from "./faceimages.ts";
export { cachedFace, cachedFaceCount, clearFaceCache, currentSkin, faceKey, requestFace, wrapSvg } from "./cache.ts";

export const AVATAR_DEFAULT_SIZE = 18;

/**
 * The drawing modules, held once loaded so a face can be written in the same frame its row is first drawn (no placeholder frame, no timer). The browser starts loading both when this file
 * is first evaluated, ahead of the first row that asks, so by the time a surface opens they are almost always here. Before they land a row shows its tinted placeholder, as it always did.
 */
let notionistsMod: typeof import("./notionists.ts") | null = null;
let libraryMod: typeof import("./library.ts") | null = null;
if (typeof document !== "undefined" && Platform.OS === "web") {
  void loadNotionists().then((m) => { notionistsMod = m; }, () => undefined);
  void loadLibrary().then((m) => { libraryMod = m; }, () => undefined);
}
const drawnMarkup = new Map<string, string>();
/** The face svg for a key, written now when its module is loaded, else undefined (the effect below fetches it and the row draws again). */
function drawnNow(key: string, spec: FaceSpec | null, seed: string, expression: Expression, size: number): string | undefined {
  const hit = drawnMarkup.get(key);
  if (hit !== undefined) return hit;
  let markup: string | undefined;
  try {
    if (spec !== null && spec.fam === "emoji") markup = emojiSvg(spec.e, spec.tint, size);
    else if (spec !== null && spec.fam !== "img" && spec.fam !== "file") markup = libraryMod === null ? undefined : libraryMod.faceSvg(spec, expression, size);
    else markup = notionistsMod === null ? undefined : sized(notionistsMod.notionistsSvg(seed), size);
  } catch { markup = undefined; }
  if (markup !== undefined) {
    drawnMarkup.set(key, markup);
    if (drawnMarkup.size > 800) { const first = drawnMarkup.keys().next(); if (first.done !== true) drawnMarkup.delete(first.value); }
  }
  return markup;
}

const web = Platform.OS === "web";

/** The ring follows the face's shape, a rounded square on agents and a circle on people. It stays still and the colour travels round it, iris into coral, ours and nobody else's: an animated conic angle behind a
 * border-only mask, never a rotating element. The waiting ring is amber. CSS only, so a list of faces costs no frames and nothing restarts on a re-render. */
export const FACE_STATE_CSS = [
  "@property --vyre-ra{syntax:\"<angle>\";inherits:false;initial-value:0deg}",
  "@keyframes vyre-ring-turn{to{--vyre-ra:360deg}}",
  ".vyre-face-ring{position:absolute;inset:-2.5px;border-radius:calc(30% + 2px);pointer-events:none}",
  ".vyre-face-ring.vyre-round{border-radius:50%}",
  ".vyre-face-ring.vyre-working{padding:1.5px;background:conic-gradient(from var(--vyre-ra),transparent 0 45%,var(--accent) 75%,var(--beacon) 100%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);animation:vyre-ring-turn 2.6s linear infinite}",
  ".vyre-face-ring.vyre-waiting{box-shadow:inset 0 0 0 1.5px var(--warn)}",
  "@media (prefers-reduced-motion:reduce){.vyre-face-ring.vyre-working{animation:none}}",
].join("\n");

/** The face svg at the caller's size: DiceBear writes width and height 64 on the root. */
function sized(markup: string, size: number): string {
  return markup.replace(/^<svg([^>]*)>/, (_m, attrs: string) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="${size}" height="${size}">`);
}

function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return web ? props : {};
}

/** The kind a name implies when the caller does not say: "Assistant" is the assistant. */
export function kindOf(name: string, kind?: AvatarKind, seedId?: string): AvatarKind {
  if (kind === "agent" && (name === "Assistant" || isAssistantId(seedId))) return "assistant";
  return kind ?? "person";
}

const VYRE_MARK =
  '<path d="M5.2 6.4l6.3 11.2 4.9-8.6" fill="none" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18.6" cy="5.6" r="2.7" fill="var(--beacon, #8B7CF6)"/>';
const AGENT_PLACEHOLDER = '<circle cx="8" cy="5.6" r="2.7"/><path d="M3.6 14c.5-3 2-4.5 4.4-4.5s3.9 1.5 4.4 4.5"/>';
const BOLT = '<path d="M9 1.8L4 9h3.5L7 14.2 12 7H8.5z"/>';
const PEOPLE = '<circle cx="6" cy="6" r="2.3"/><path d="M2 13c.5-2.3 2.1-3.5 4-3.5s3.5 1.2 4 3.5"/><circle cx="11.5" cy="6.5" r="1.8"/><path d="M11.5 9.5c1.4 0 2.4.9 2.8 2.5"/>';

/** RN styles have no `color` key in their types; the web build passes it through so inline svg takes currentColor from the tile. */
const inkOf = (color: string): ViewStyle => ({ color }) as unknown as ViewStyle;

const ring = (): ViewStyle => (web ? ({ boxShadow: "inset 0 0 0 1px var(--line)" } as ViewStyle) : { borderWidth: StyleSheet.hairlineWidth, borderColor: "var(--line)" as string });

function svg(markup: string, size: number, viewBox: string, extra: Record<string, unknown> = {}): ReactElement {
  return createElement("svg", { viewBox, width: size, height: size, "aria-hidden": true, style: { display: "block" }, dangerouslySetInnerHTML: { __html: markup }, ...extra });
}

/** The ring round a working or waiting face. */
function FaceRing({ state, round, id }: { state: FaceState; round: boolean; id: string }): ReactElement | null {
  if (state !== "working" && state !== "waiting") return null;
  if (!web) return <View testID={`${id}-ring`} style={[styles.ringNative, { borderRadius: round ? 999 : 8, borderColor: (state === "working" ? "var(--accent)" : "var(--warn)") as string }]} />;
  injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-ui-face-state", FACE_STATE_CSS);
  return createElement("span", { className: `vyre-face-ring vyre-${state}${round ? " vyre-round" : ""}`, "data-testid": `${id}-ring`, "data-state": state, "aria-hidden": true });
}

/** The expression a state draws on a library face. */
export const expressionOf = (state: FaceState | undefined): Expression => (state === "working" ? "working" : state === "done" ? "done" : state === "asleep" ? "asleep" : "idle");

let blinkInstalled = false;
/** A library face blinks once when the pointer arrives: its asleep drawing for 150 ms. Not under reduced motion. One listener for every face on the page; the closed eyes are drawn on the first hover. */
function installBlink(): void {
  const d = (globalThis as { document?: Document }).document;
  if (blinkInstalled || d === undefined) return;
  blinkInstalled = true;
  d.addEventListener("mouseover", (e) => {
    const t = e.target as Element | null;
    const img = (t?.closest?.("[data-avatar]")?.querySelector?.("img[data-face-blink]") ?? null) as HTMLImageElement | null;
    if (img === null || img.dataset["blinking"] !== undefined) return;
    if ((globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) return;
    const text = img.dataset["faceBlink"] ?? "";
    const size = Number(img.dataset["faceSize"] ?? 0);
    const spec = parseFace(text);
    if (spec === null || spec.fam === "img" || spec.fam === "file" || spec.fam === "emoji" || !hasExpressions(spec) || !(size > 0)) return;
    img.dataset["blinking"] = "1";
    const done = (): void => { delete img.dataset["blinking"]; };
    void loadLibrary().then(({ faceSvg }) => {
      const key = faceKey(text, "spec:asleep", size, currentSkin());
      const show = (): void => {
        const url = cachedFace(key);
        if (url === undefined) { done(); return; }
        const prev = img.src;
        img.src = url;
        setTimeout(() => { img.src = prev; setTimeout(done, 300); }, 150);
      };
      if (cachedFace(key) !== undefined) show(); else requestFace(key, faceSvg(spec, "asleep", size), size, show);
    }, done);
  });
}

export const Avatar = memo(function Avatar({ name, seedId: ownId, kind: ownKind, size = AVATAR_DEFAULT_SIZE, photo, running = false, present = false, state, face: ownFace, testID }: AvatarProps): ReactElement {
  // someone else's private agent wears its person's face: their marble, seeded by their id
  const standIn = useSyncExternalStore(subscribeAssistant, () => standInOf(ownId), () => standInOf(ownId));
  const seedId = standIn !== "" ? standIn : ownId;
  const kindProp = standIn !== "" ? "person" : ownKind;
  const kind = kindOf(name, kindProp, seedId);
  // A look the person picked in Settings turns the assistant into a drawn face from the agent library; with none it stays the Vyre mark.
  const look = useSyncExternalStore(subscribeAssistant, assistantLook, assistantLook);
  const looked = kind === "assistant" && look !== "";
  // One person, one face everywhere: the face is seeded by the id when the caller has one, by the name only as a fallback. Letters and the label still come from the name.
  const stored = useSyncExternalStore(subscribeAssistant, () => pickedFace(seedId), () => pickedFace(seedId));
  const chosen = ownFace ?? stored;
  const seed = looked ? look : chosen !== "" ? chosen : seedId !== undefined && seedId !== "" ? seedId : name;
  // a face chosen from the library (av1:...) is drawn from its own curated lists, in the expression the state asks for; any older seed keeps drawing as it did
  const spec: FaceSpec | null = kind === "agent" && !looked ? parseFace(chosen) : null;
  // what the agent is doing, wherever it is known, shows on every one of its faces: an explicit state first, else its status
  const doing = useSyncExternalStore(subscribeAssistant, () => lookOf(seedId), () => lookOf(seedId));
  const expression = expressionOf(state ?? (doing === "" ? undefined : doing));
  const pictureId = spec?.fam === "file" ? spec.id : "";
  const picture = useSyncExternalStore(subscribeFaceImages, () => (pictureId === "" ? undefined : faceImageOf(pictureId)), () => (pictureId === "" ? undefined : faceImageOf(pictureId)));
  useEffect(() => { if (pictureId !== "") requestFaceImage(pictureId); }, [pictureId]);
  // A person's marble and an agent's face are drawn once to a cached bitmap per seed, kind, size and skin; rows reuse it as an <img>.
  const browser = web && typeof document !== "undefined";
  const drawn = web && (kind === "agent" || looked) && spec?.fam !== "img" && spec?.fam !== "file";
  const key = spec !== null ? faceKey(seed, `spec:${expression}`, size, currentSkin()) : faceKey(seed, looked ? "agent" : kind, size, currentSkin());
  const [, bump] = useState(0);
  const [agentFace, setAgentFace] = useState<{ key: string; markup: string } | null>(null);
  const bitmap = drawn ? cachedFace(key) : undefined;
  // drawn in this frame from the loaded modules (and the bitmap replaces it when it is ready): a surface that opens shows its faces at once
  const now = drawn && bitmap === undefined ? drawnNow(key, spec, seed, expression, size) : undefined;
  useEffect(() => {
    if (!drawn || cachedFace(key) !== undefined) return;
    let alive = true;
    if (now !== undefined) { requestFace(key, now, size, () => { if (alive) bump((n) => n + 1); }); return () => { alive = false; }; }
    const paint = (markup: string): void => { if (!alive) return; setAgentFace({ key, markup }); requestFace(key, markup, size, () => bump((n) => n + 1)); };
    if (spec !== null && spec.fam === "emoji") paint(emojiSvg(spec.e, spec.tint, size));
    else if (spec !== null && spec.fam !== "img" && spec.fam !== "file") { installBlink(); void loadLibrary().then(({ faceSvg }) => paint(faceSvg(spec, expression, size))); }
    else void loadNotionists().then(({ notionistsSvg }) => paint(sized(notionistsSvg(seed), size)));
    return () => { alive = false; };
  }, [drawn, key, kind, seed, size, expression]);
  const id = testID ?? `avatar-${name}`;
  const round = kind === "person";
  const box: ViewStyle = { width: size, height: size, borderRadius: round ? size / 2 : ("30%" as unknown as number), alignItems: "center", justifyContent: "center", flexShrink: 0 };
  const data = webProps({ dataSet: { avatar: kind } });
  let face: ReactElement;
  let clip = true;

  if (kind === "person" && photo) {
    face = web ? createElement("img", { src: photo, alt: "", width: size, height: size, draggable: false, style: { display: "block", objectFit: "cover", width: size, height: size } }) : <Image accessibilityIgnoresInvertColors source={{ uri: photo }} style={{ width: size, height: size }} />;
  } else if (spec !== null && spec.fam === "file") {
    face = picture !== undefined ? (web ? createElement("img", { src: picture, alt: "", width: size, height: size, draggable: false, style: { display: "block", objectFit: "cover", width: size, height: size }, "data-face": "upload" }) : <Image accessibilityIgnoresInvertColors source={{ uri: picture }} style={{ width: size, height: size }} />) : <AgentFallback name={name} seed={seed} size={size} />;
  } else if (spec !== null && spec.fam === "img") {
    face = web ? createElement("img", { src: spec.url, alt: "", width: size, height: size, draggable: false, style: { display: "block", objectFit: "cover", width: size, height: size }, "data-face": "upload" }) : <Image accessibilityIgnoresInvertColors source={{ uri: spec.url }} style={{ width: size, height: size }} />;
  } else if (bitmap !== undefined) {
    face = createElement("img", { src: bitmap, alt: "", width: size, height: size, draggable: false, decoding: "async", style: { display: "block", width: size, height: size, ...(spec !== null && expression === "asleep" && !hasExpressions(spec) ? { opacity: 0.6 } : {}) }, "data-face": "cached", ...(spec !== null && spec.fam !== "emoji" && spec.fam !== "file" && spec.fam !== "img" && hasExpressions(spec) ? { "data-face-blink": chosen, "data-face-size": size } : {}) });
  } else if (kind === "person" && browser) {
    face = createElement("span", { style: { display: "block", width: size, height: size, background: marbleGradient(seed) }, "data-face": "gradient" });
  } else if (kind === "person") {
    face = web ? svg(marbleInner(seed), size, "0 0 80 80") : <NativeLetters name={name} size={size} person tint={`hsl(${hueOf(seed)}, 45%, 70%)`} />;
  } else if (kind === "agent" || looked) {
    const markup = agentFace?.key === key ? agentFace.markup : (now ?? null);
    face = web && markup ? createElement("span", { style: { display: "block", width: size, height: size, lineHeight: 0 }, dangerouslySetInnerHTML: { __html: markup } }) : <AgentFallback name={name} seed={seed} size={size} />;
  } else if (kind === "space") {
    face = <NativeLetters name={name} size={size} tint={`hsla(${hueOf(seed)}, 60%, 50%, 0.18)`} ink={`hsl(${hueOf(seed)}, 55%, 46%)`} />;
  } else if (kind === "assistant") {
    const s = Math.round(size * 0.78);
    face = web ? svg(VYRE_MARK, s, "0 0 24 24", { className: "vmark" }) : <Text style={{ color: "var(--ink)" as string, fontWeight: "700", fontSize: Math.round(size * 0.5) }}>V</Text>;
    clip = false;
  } else {
    const s = Math.round(size * 0.62);
    const path = kind === "automation" ? BOLT : PEOPLE;
    face = web ? svg(path, s, "0 0 16 16", { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }) : <Text style={{ fontSize: Math.round(size * 0.5), color: "var(--ink-2)" as string }}>{kind === "automation" ? "+" : "··"}</Text>;
  }

  const neutral = (kind === "assistant" && !looked) || kind === "automation" || kind === "group";
  const glyphColor = kind === "assistant" ? "var(--ink)" : "var(--ink-2)";
  return (
    <View testID={id} accessible accessibilityRole="image" accessibilityLabel={name} style={{ width: size, height: size, flexShrink: 0 }} {...data}>
      {state ? <FaceRing state={state} round={round} id={id} /> : null}
      <View style={[box, clip && { overflow: "hidden" }, neutral && { backgroundColor: kind === "assistant" ? "var(--accent-wash)" as string : "var(--sunk)" as string, ...(kind === "assistant" ? {} : ring()) }, neutral && inkOf(glyphColor), state === "idle" && styles.idle]}>{face}</View>
      {state === "done" ? <View testID={`${id}-done`} style={styles.done} /> : null}
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

function AgentFallback({ name, seed, size }: { name: string; seed: string; size: number }): ReactElement {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", backgroundColor: `#${faceTint(seed)}` }}>
      {web ? svg(AGENT_PLACEHOLDER, Math.round(size * 0.72), "0 0 16 16", { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }) : <Text style={{ color: "#1F1F23", fontWeight: "600", fontSize: Math.max(9, Math.round(size * 0.48)) }}>{initialsOf(name, size)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  idle: { opacity: 0.45 },
  ringNative: { position: "absolute", left: -3, top: -3, right: -3, bottom: -3, borderWidth: 1.5 },
  done: { position: "absolute", right: -3, bottom: -3, width: 9, height: 9, borderRadius: 5, backgroundColor: "var(--ok)" as string, ...(web ? ({ boxShadow: "0 0 0 2px var(--raised)" } as ViewStyle) : {}) },
  dot: { position: "absolute", backgroundColor: "var(--ok)" as string, ...(web ? ({ boxShadow: "0 0 0 2px var(--side)" } as ViewStyle) : {}) },
  right: { right: -3, bottom: -3 },
  left: { left: -1, bottom: -1 },
});
