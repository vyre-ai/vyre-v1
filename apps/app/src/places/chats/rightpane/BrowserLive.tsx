// The live view of an agent's profile in the Space browser (computers.browser.stream). Watching is MJPEG in an image. After a take-over the view reopens on the WebSocket the same call hands out, which carries
// the frames down and the person's clicks, wheel and keys up (the ticket opens once, so the two never share one). Wire format: host/src/routes/browser-stream.ts and images/space-browser/browserd/view.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Image, Platform, Pressable, StyleSheet } from "react-native";

/** The size the browser draws its pages at (browserd screencast). Pointer positions are sent in these units. */
export const BROWSER_VIEW = { width: 1280, height: 800 } as const;

/** A Space-relative path as an address the viewer can open. */
export const viewUrl = (spaceUrl: string | undefined, path: string): string => (path.startsWith("/") ? `${(spaceUrl ?? "").replace(/\/+$/, "")}${path}` : path);
export const socketUrl = (spaceUrl: string | undefined, path: string): string => viewUrl(spaceUrl, path).replace(/^http/, "ws");

/** A press at (x, y) inside a view of `box` size, in the browser's own units; clamped to the page. */
export function pointOf(x: number, y: number, box: { width: number; height: number }): { x: number; y: number } {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  const px = Math.round((x / box.width) * BROWSER_VIEW.width), py = Math.round((y / box.height) * BROWSER_VIEW.height);
  return { x: Math.min(BROWSER_VIEW.width - 1, Math.max(0, px)), y: Math.min(BROWSER_VIEW.height - 1, Math.max(0, py)) };
}

/** What a key sends: a letter or digit typed alone is text; a named key (Enter, Tab, arrows) or one with Ctrl, Alt or Meta goes as a key press and release. */
export function keyMessages(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): Array<Record<string, unknown>> {
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return [{ t: "type", text: e.key }];
  if (e.key.length > 32 || e.key === "Dead" || e.key === "Unidentified") return [];
  return [{ t: "key", name: e.key, down: true }, { t: "key", name: e.key, down: false }];
}

interface Opened { url: string; ws?: string }

export function BrowserLive({ agentId, control, call, spaceUrl, testID = "browser-live-view", onNote }: { agentId: string; control: boolean; call(cap: string, input: unknown): Promise<unknown>; spaceUrl?: string | undefined; testID?: string; onNote?: (text: string) => void }): ReactElement {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const box = useRef({ width: 0, height: 0 });
  const socket = useRef<{ send(s: string): void; close(): void } | null>(null);
  const seq = useRef(0);
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
    ws.onmessage = (e) => {
      if (typeof e.data === "string") { try { const m = JSON.parse(e.data) as { t?: string; reason?: string }; if (m.t === "refused" && m.reason) note(m.reason); } catch { /* not for us */ } return; }
      const next = Url.createObjectURL(new Blob_([e.data], { type: "image/jpeg" }));
      setFrame(next);
      if (last) Url.revokeObjectURL(last);
      last = next;
    };
    socket.current = ws;
    return () => { socket.current = null; ws.onmessage = null; ws.close(); if (last) Url.revokeObjectURL(last); setFrame(null); };
  }, [control, opened, spaceUrl, note]);

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
    const p = pointOf(e.nativeEvent?.locationX ?? 0, e.nativeEvent?.locationY ?? 0, box.current);
    send({ t: "move", x: p.x, y: p.y });
    send({ t: "down", n: 0 });
    send({ t: "up", n: 0 });
  };
  const wheel = Platform.OS !== "web" ? {} : { onWheel: (e: { deltaX?: number; deltaY?: number; preventDefault?: () => void }) => { if (!control) return; e.preventDefault?.(); send({ t: "scroll", dx: e.deltaX ?? 0, dy: e.deltaY ?? 0 }); } };
  const uri = control && frame ? frame : !control && opened ? viewUrl(spaceUrl, opened.url) : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={control ? "The browser, in your control" : "The browser, live"} testID={testID} disabled={!control} onPress={onPress}
      onLayout={(e) => { box.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }} style={st.fill} {...wheel}>
      {uri ? <Image testID={`${testID}-image`} accessibilityLabel="Live view" source={{ uri }} resizeMode="contain" style={st.fill} /> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({ fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } });
