// The live view of an agent's profile in the Space browser (computers.browser.stream). Watching is MJPEG in an image. After a take-over the view reopens on the WebSocket the same call hands out, which carries
// the frames down and the person's clicks, wheel and keys up (the ticket opens once, so the two never share one). Wire format: host/src/routes/browser-stream.ts and images/space-browser/browserd/view.ts.
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Image, Platform, Pressable, StyleSheet } from "react-native";

/** The size pages are drawn at when neither the stream nor the first frame has said: browserd's screencast ceiling. Used only until a real size is known. */
export const BROWSER_VIEW = { width: 1280, height: 800 } as const;
export interface FrameSize { width: number; height: number }
const sized = (w: unknown, h: unknown): FrameSize | null => (typeof w === "number" && typeof h === "number" && w > 0 && h > 0 ? { width: w, height: h } : null);

/** A Space-relative path as an address the viewer can open. */
export const viewUrl = (spaceUrl: string | undefined, path: string): string => (path.startsWith("/") ? `${(spaceUrl ?? "").replace(/\/+$/, "")}${path}` : path);
export const socketUrl = (spaceUrl: string | undefined, path: string): string => viewUrl(spaceUrl, path).replace(/^http/, "ws");

/**
 * A press at (x, y) inside a view of `box` size, in the units of a frame of `frame` size. The picture is drawn "contain", so it keeps its shape and may leave bars; a press on a bar goes to the
 * nearest edge of the page. `frame` is what the stream said, else the first frame's own size, else BROWSER_VIEW.
 */
export function pointOf(x: number, y: number, box: { width: number; height: number }, frame: FrameSize = BROWSER_VIEW): { x: number; y: number } {
  if (box.width <= 0 || box.height <= 0 || frame.width <= 0 || frame.height <= 0) return { x: 0, y: 0 };
  const k = Math.min(box.width / frame.width, box.height / frame.height);
  const ox = (box.width - frame.width * k) / 2, oy = (box.height - frame.height * k) / 2;
  const px = Math.round((x - ox) / k), py = Math.round((y - oy) / k);
  return { x: Math.min(frame.width - 1, Math.max(0, px)), y: Math.min(frame.height - 1, Math.max(0, py)) };
}

/**
 * Where a press was, inside the view, in CSS pixels, or null when it has no place (a key pressed on the view). React Native's own `locationX` and `locationY` when the event has them; on the web a press event is the browser's click, which has only the window's
 * `clientX` and `clientY`, taken from the box of the element that was pressed. (Without this every click in control mode went to the page's top left corner: `?? 0`.)
 */
type PressEvent = { nativeEvent?: unknown; currentTarget?: unknown };
export function pressPoint(e: PressEvent): { x: number; y: number } | null {
  const n = (e.nativeEvent ?? {}) as { locationX?: number; locationY?: number; clientX?: number; clientY?: number; detail?: number };
  if (typeof n.locationX === "number" && typeof n.locationY === "number") return { x: n.locationX, y: n.locationY };
  // a click the browser makes for Space or Enter on a focused element has detail 0 and a place of (0, 0): it is a key, not a press
  if (n.detail === 0) return null;
  const box = (e.currentTarget as { getBoundingClientRect?: () => { left: number; top: number } } | undefined)?.getBoundingClientRect?.();
  if (box && typeof n.clientX === "number" && typeof n.clientY === "number") return { x: n.clientX - box.left, y: n.clientY - box.top };
  return null;
}

/** The left button as browserd numbers it. */
export const LEFT_BUTTON = 1;

/** What a key sends: a letter or digit typed alone is text; a named key (Enter, Tab, arrows) or one with Ctrl, Alt or Meta goes as a key press and release. */
export function keyMessages(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): Array<Record<string, unknown>> {
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return [{ t: "type", text: e.key }];
  if (e.key.length > 32 || e.key === "Dead" || e.key === "Unidentified") return [];
  return [{ t: "key", name: e.key, down: true }, { t: "key", name: e.key, down: false }];
}


/** A canvas as far as the painter needs it. */
export interface PaintTarget { width: number; height: number; getContext(kind: "2d"): { drawImage(source: unknown, x: number, y: number): void } | null }
export interface PaintDeps {
  /** The canvas now, or null when it is not there. */
  target(): PaintTarget | null;
  /** Decode one JPEG frame. */
  decode(jpeg: ArrayBuffer): Promise<{ width: number; height: number; close?(): void }>;
  /** A frame was drawn at this size. */
  drawn(size: FrameSize): void;
  /** This many frames in a row could not be read: the view is showing a stale picture. Called once per run of failures. */
  failed?(): void;
}
/** After this many frames in a row that cannot be read the person is told. */
export const FAILED_FRAMES = 20;

/**
 * Draws the frames of a live view on one canvas. A frame is decoded off to the side and drawn in one step over the last one, so the picture is never blank between two frames and the canvas keeps its
 * size (setting a canvas's size clears it, so it is set only when the page's own size changes). A frame that arrives while another is being decoded waits, and a newer one replaces it: the view skips
 * ahead instead of falling behind (one loop, no chain of promises). A frame that cannot be read is skipped and the last good one stays; a run of FAILED_FRAMES is reported. `dispose` ends it: nothing
 * waiting is drawn and an in-flight frame is closed unseen. (13 Nov 2026: the preview flickered because each frame was a new picture address.)
 */
export function framePainter(d: PaintDeps): { push(jpeg: ArrayBuffer): void; dispose(): void } {
  let running = false;
  let waiting: ArrayBuffer | null = null;
  let gone = false;
  let bad = 0;
  const run = async (): Promise<void> => {
    running = true;
    try {
      while (waiting && !gone) {
        const jpeg = waiting;
        waiting = null;
        let bmp: { width: number; height: number; close?(): void } | null = null;
        try {
          bmp = await d.decode(jpeg);
          const c = gone ? null : d.target();
          if (c) {
            if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
            c.getContext("2d")?.drawImage(bmp, 0, 0);
            d.drawn({ width: bmp.width, height: bmp.height });
          }
          bad = 0;
        } catch {
          if (++bad === FAILED_FRAMES) d.failed?.();
        } finally { try { bmp?.close?.(); } catch { /* already closed */ } }
      }
    } finally { running = false; }
  };
  return {
    push(jpeg) { if (gone) return; waiting = jpeg; if (!running) void run(); },
    dispose() { gone = true; waiting = null; },
  };
}

interface Opened { url: string; ws?: string; width?: number; height?: number }

export function BrowserLive({ agentId, control, call, spaceUrl, testID = "browser-live-view", onNote }: { agentId: string; control: boolean; call(cap: string, input: unknown): Promise<unknown>; spaceUrl?: string | undefined; testID?: string; onNote?: (text: string) => void }): ReactElement {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const canvas = useRef<PaintTarget | null>(null);
  // on the web the frames are drawn on a canvas; elsewhere (and where a canvas or bitmap decoding is missing) each frame is a picture address
  const canvasOk = Platform.OS === "web" && typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap === "function";
  const box = useRef({ width: 0, height: 0 });
  const socket = useRef<{ send(s: string): void; close(): void } | null>(null);
  const seq = useRef(0);
  const natural = useRef<FrameSize | null>(null);
  const note = useMemo(() => onNote ?? (() => undefined), [onNote]);

  // a new address when the controls change hands: the take-over ticket is a different one
  useEffect(() => {
    let live = true;
    setOpened(null);
    void Promise.resolve(call("computers.browser.stream", { agentId })).then((o) => { if (live) setOpened(o as Opened); }, () => { if (live) note("The live view could not open."); });
    return () => { live = false; };
  }, [call, agentId, control, note]);

  useEffect(() => {
    if (!control || !opened?.ws) return;
    const WS = (globalThis as { WebSocket?: new (u: string) => { binaryType: string; onmessage: ((e: { data: unknown }) => void) | null; onclose: (() => void) | null; send(s: string): void; close(): void } }).WebSocket;
    const Url = (globalThis as { URL?: { createObjectURL(b: unknown): string; revokeObjectURL(u: string): void } }).URL;
    const Blob_ = (globalThis as { Blob?: new (p: unknown[], o: { type: string }) => unknown }).Blob;
    if (!WS || !Url || !Blob_) return;
    const ws = new WS(socketUrl(spaceUrl, opened.ws));
    ws.binaryType = "arraybuffer";
    let last: string | null = null;
    const paint = canvasOk ? framePainter({
      target: () => canvas.current,
      decode: (jpeg) => (globalThis as unknown as { createImageBitmap(b: unknown): Promise<{ width: number; height: number }> }).createImageBitmap(new Blob_([jpeg], { type: "image/jpeg" })),
      drawn: (size) => { natural.current = size; },
      failed: () => note("The live view lost its picture. Give the browser back and take over again."),
    }) : null;
    ws.onmessage = (e) => {
      if (typeof e.data === "string") { try { const m = JSON.parse(e.data) as { t?: string; reason?: string }; if (m.t === "refused" && m.reason) note(m.reason); } catch { /* not for us */ } return; }
      if (paint) { paint.push(e.data as ArrayBuffer); return; }
      const next = Url.createObjectURL(new Blob_([e.data], { type: "image/jpeg" }));
      setFrame(next);
      if (last) Url.revokeObjectURL(last);
      last = next;
    };
    socket.current = ws;
    return () => { socket.current = null; ws.onmessage = null; paint?.dispose(); ws.close(); if (last) Url.revokeObjectURL(last); setFrame(null); };
  }, [control, opened, spaceUrl, note, canvasOk]);

  const send = (m: Record<string, unknown>): void => { socket.current?.send(JSON.stringify({ ...m, seq: ++seq.current })); };

  useEffect(() => {
    if (!control) return;
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void, c?: boolean): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void, c?: boolean): void } }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = ((e.target as { tagName?: string } | null)?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as { isContentEditable?: boolean } | null)?.isContentEditable === true) return;
      const out = keyMessages(e);
      if (out.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      for (const m of out) send(m);
    };
    // capture phase: the focused view is a button, and the framework turns Space and Enter on it into a press before a bubbling listener would see the key
    doc.addEventListener("keydown", onKey, true);
    return () => doc.removeEventListener("keydown", onKey, true);
  }, [control]);

  const onPress = (e: PressEvent): void => {
    if (!control) return;
    // a press with no place (Space or Enter on the focused view, which the framework turns into a press) is a key, not a click: it must not click the page's top left corner
    const at = pressPoint(e);
    if (!at) return;
    const p = pointOf(at.x, at.y, box.current, sized(opened?.width, opened?.height) ?? natural.current ?? BROWSER_VIEW);
    send({ t: "move", x: p.x, y: p.y });
    // browserd numbers its buttons from 1 (1 left, 2 middle, 3 right; images/space-browser/browserd/view.ts BUTTON): n 0 does not exist and every click was refused
    send({ t: "down", n: LEFT_BUTTON });
    send({ t: "up", n: LEFT_BUTTON });
  };
  // the wheel is a DOM listener on the view (a native press view does not forward onWheel): not passive, so the page behind does not scroll too
  const viewRef = useRef<unknown>(null);
  useEffect(() => {
    const el = viewRef.current as { addEventListener?: (t: string, f: (e: WheelEvent) => void, o: { passive: boolean }) => void; removeEventListener?: (t: string, f: (e: WheelEvent) => void) => void } | null;
    if (Platform.OS !== "web" || !control || !el?.addEventListener) return;
    const onWheel = (e: WheelEvent): void => { e.preventDefault(); send({ t: "scroll", dx: e.deltaX ?? 0, dy: e.deltaY ?? 0 }); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener?.("wheel", onWheel);
  }, [control]);
  const uri = control && canvasOk ? null : control && frame ? frame : !control && opened ? viewUrl(spaceUrl, opened.url) : null;
  // while you are in control the frames are painted on one canvas that fills the box and keeps the page's shape, as the picture does ("contain"): clicks are mapped the same way (pointOf)
  const painted = control && canvasOk
    ? createElement("canvas", { ref: (el: PaintTarget | null) => { canvas.current = el; }, "data-testid": `${testID}-image`, "aria-label": "Live view", style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" } })
    : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={control ? "The browser, in your control" : "The browser, live"} testID={testID} disabled={!control} onPress={onPress}
      onLayout={(e) => { box.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }} ref={viewRef as never} style={st.fill}>
      {uri ? <Image testID={`${testID}-image`} accessibilityLabel="Live view" source={{ uri }} resizeMode="contain" style={st.fill}
        onLoad={(e: { nativeEvent?: { source?: { width?: number; height?: number } } }) => { natural.current = sized(e.nativeEvent?.source?.width, e.nativeEvent?.source?.height) ?? natural.current; }} /> : null}
      {painted}
    </Pressable>
  );
}

const st = StyleSheet.create({ fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } });
