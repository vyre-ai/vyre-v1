// The agent's screen, live (rc.9): one place that opens the stream, shows it over whatever stands in for it, and, while the person is in control, sends their clicks, right clicks, wheel and keys to the
// agent's desktop. The popup, the Computer tab in the chat pane and the live card in a message all draw it. Before the stream arrives, or when there is none, the `children` stand in (the last picture,
// the faux desk), so nothing moves when it does.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Image, Platform, Pressable, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { createForwarder, openStream } from "./actions.ts";
import type { PopupDeps } from "./actions.ts";
import type { Display } from "./model.ts";
import { streamSrc } from "./model.ts";

interface DomEvent {
  clientX?: number;
  clientY?: number;
  deltaX?: number;
  deltaY?: number;
  currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } };
  preventDefault?: () => void;
}

export interface LiveScreenProps {
  computerId: string;
  /** The computer's state: the stream opens while it is working or taken over. */
  state: string | null;
  call: PopupDeps["call"];
  note?: (text: string) => void;
  spaceUrl?: string | undefined;
  display?: Display | undefined;
  now(): number;
  /** The person is at the controls: input goes to the desktop. */
  control: boolean;
  /** Also send keys to the desktop while in control (the popup does its own, because Escape closes it). */
  keys?: boolean;
  /** A press when not in control (wake a sleeping computer, pop the view out). */
  onIdlePress?: () => void;
  testID: string;
  streamTestID?: string;
  label: string;
  style: StyleProp<ViewStyle>;
  disabled?: boolean;
  children?: ReactNode;
}

export function LiveScreen({ computerId, state, call, note, spaceUrl, display, now, control, keys = false, onIdlePress, testID, streamTestID, label, style, disabled, children }: LiveScreenProps): ReactElement {
  const [stream, setStream] = useState<{ transport: "webrtc" | "mjpeg"; url: string; ticket: string } | null>(null);
  const box = useRef({ width: 0, height: 0 });
  const node = useRef<unknown>(null);
  const deps: PopupDeps = useMemo(() => ({ call, note: note ?? (() => undefined) }), [call, note]);
  const forwarder = useMemo(() => createForwarder(deps, computerId, display), [deps, computerId, display]);
  const reachable = state === "working" || state === "takeover";

  useEffect(() => {
    if (!reachable) { setStream(null); return; }
    let live = true;
    void openStream(deps, computerId).then((s) => { if (live && s) setStream({ transport: s.transport, url: s.url, ticket: s.ticket }); });
    return () => { live = false; };
  }, [reachable, deps, computerId]);

  useEffect(() => {
    if (!keys || !control) return;
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = ((e.target as { tagName?: string } | null)?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as { isContentEditable?: boolean } | null)?.isContentEditable === true) return;
      e.preventDefault();
      void forwarder.key({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey });
      setTimeout(() => void forwarder.flush(), 120);
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [keys, control, forwarder]);

  const press = (e: { nativeEvent?: { locationX?: number; locationY?: number } }): void => {
    if (!control) { onIdlePress?.(); return; }
    void forwarder.press(e.nativeEvent?.locationX ?? 0, e.nativeEvent?.locationY ?? 0, box.current, now());
  };
  const domPoint = (e: DomEvent): { x: number; y: number } => {
    const r = e.currentTarget?.getBoundingClientRect?.();
    return { x: (e.clientX ?? 0) - (r?.left ?? 0), y: (e.clientY ?? 0) - (r?.top ?? 0) };
  };
  // Right click and long press arrive through the shared menuTrigger, which also keeps the browser's own menu from opening over the screen; the point is made relative to the screen from its box.
  // Only while the person is in control does either go to the agent's desktop.
  const trigger = menuTrigger((x, y) => {
    if (!control) return;
    const r = (node.current as { getBoundingClientRect?: () => { left: number; top: number } } | null)?.getBoundingClientRect?.();
    void forwarder.press(x - (r?.left ?? 0), y - (r?.top ?? 0), box.current, now(), "right");
  });
  delete trigger.onKeyDown;   // the menu key is a key for the desktop, not a right click
  const web: Record<string, unknown> = {
    ...trigger,
    ...(Platform.OS !== "web" ? {} : {
      onWheel: (e: DomEvent) => {
        if (!control) return;
        e.preventDefault?.();
        const p = domPoint(e);
        void forwarder.scroll(p.x, p.y, box.current, e.deltaX ?? 0, e.deltaY ?? 0);
      },
    }),
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={press} {...(disabled ? { disabled } : {})}
      onLayout={(e) => { box.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }}
      ref={(n) => { node.current = n; }} style={style} {...web}>
      {children}
      {stream && stream.transport === "mjpeg" ? <Image testID={streamTestID ?? `${testID}-stream`} accessibilityLabel="Live view" source={{ uri: streamSrc(stream.url, stream.ticket, spaceUrl) }} resizeMode="contain" style={st.stream} /> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({ stream: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } });
