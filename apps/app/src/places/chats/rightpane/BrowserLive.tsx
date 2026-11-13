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
}

/**
 * Draws the frames of a live view on one canvas. A frame is decoded off to the side and drawn in one step over the last one, so the picture is never blank between two frames and the canvas keeps its
 * size (setting a canvas's size clears it, so it is set only when the page's own size changes). A frame that arrives while another is being decoded waits, and a newer one replaces it: the view skips
 * ahead instead of falling behind. A frame that cannot be read is skipped and the last good one stays. (13 Nov 2026: the preview flickered because each frame was a new picture address.)
 */
export function framePainter(d: PaintDeps): (jpeg: ArrayBuffer) => void {
  let busy = false;
  let waiting: ArrayBuffer | null = null;
  const draw = async (jpeg: ArrayBuffer): Promise<void> => {
    busy = true;
    try {
      const bmp = await d.decode(jpeg);
      const c = d.target();
      if (c) {
        if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
        c.getContext("2d")?.drawImage(bmp, 0, 0);
        d.drawn({ width: bmp.width, height: bmp.height });
      }
      bmp.close?.();
    } catch { /* a frame that cannot be read is skipped */ }
    busy = false;
    const next = waiting;
    waiting = null;
    if (next) await draw(next);
  };
  return (jpeg) => { if (busy) waiting = jpeg; else void draw(jpeg); };
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
    }) : null;
    ws.onmessage = (e) => {
      if (typeof e.data === "string") { try { const m = JSON.parse(e.data) as { t?: string; reason?: string }; if (m.t === "refused" && m.reason) note(m.reason); } catch { /* not for us */ } return; }
      if (paint) { paint(e.data as ArrayBuffer); return; }
      const next = Url.createObjectURL(new Blob_([e.data], { type: "image/jpeg" }));
      setFrame(next);
      if (last) Url.revokeObjectURL(last);
      last = next;
    };
    socket.current = ws;
    return () => { socket.current = null; ws.onmessage = null; ws.close(); if (last) Url.revokeObjectURL(last); setFrame(null); };
  }, [control, opened, spaceUrl, note, canvasOk]);

  const send = (m: Record<string, unknown>): void => { socket.current?.send(JSON.stringify({ ...m, seq: ++seq.current })); };

  useEffect(() => {
    if (!control) return;
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = ((e.target as { tagName?: string } | null)?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as { isContentEditable?: boolean } | null)?.isContentEditable === true) return;
      const out = keyMessages(e);
      if (out.length === 0) return;
      e.preventDefault();
      for (const m of out) send(m);
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [control]);

  const onPress = (e: { nativeEvent?: { locationX?: number; locationY?: number } }): void => {
    if (!control) return;
    const p = pointOf(e.nativeEvent?.locationX ?? 0, e.nativeEvent?.locationY ?? 0, box.current, sized(opened?.width, opened?.height) ?? natural.current ?? BROWSER_VIEW);
    send({ t: "move", x: p.x, y: p.y });
    send({ t: "down", n: 0 });
    send({ t: "up", n: 0 });
  };
  const wheel = Platform.OS !== "web" ? {} : { onWheel: (e: { deltaX?: number; deltaY?: number; preventDefault?: () => void }) => { if (!control) return; e.preventDefault?.(); send({ t: "scroll", dx: e.deltaX ?? 0, dy: e.deltaY ?? 0 }); } };
  const uri = control && canvasOk ? null : control && frame ? frame : !control && opened ? viewUrl(spaceUrl, opened.url) : null;
  // while you are in control the frames are painted on one canvas that fills the box and keeps the page's shape, as the picture does ("contain"): clicks are mapped the same way (pointOf)
  const painted = control && canvasOk
    ? createElement("canvas", { ref: (el: PaintTarget | null) => { canvas.current = el; }, "data-testid": `${testID}-image`, "aria-label": "Live view", style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" } })
    : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={control ? "The browser, in your control" : "The browser, live"} testID={testID} disabled={!control} onPress={onPress}
      onLayout={(e) => { box.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }} style={st.fill} {...wheel}>
      {uri ? <Image testID={`${testID}-image`} accessibilityLabel="Live view" source={{ uri }} resizeMode="contain" style={st.fill}
        onLoad={(e: { nativeEvent?: { source?: { width?: number; height?: number } } }) => { natural.current = sized(e.nativeEvent?.source?.width, e.nativeEvent?.source?.height) ?? natural.current; }} /> : null}
      {painted}
    </Pressable>
  );
}

const st = StyleSheet.create({ fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } });
