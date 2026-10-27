// Auth-only presentation field. It owns no join state and never talks to a Space.
import { createElement, useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import type { JoinPalette } from "./palette.ts";

export type HalftoneIntensity = "full" | "calm";

export interface HalftoneFieldProps {
  intensity: HalftoneIntensity;
  palette?: Pick<JoinPalette, "halftone" | "halftoneAccent">;
  /** A testable override; system preference remains the production default. */
  reducedMotion?: boolean;
}

const web = Platform.OS === "web";
const defaultPalette = { halftone: "#6C57E6", halftoneAccent: "#007AFF" };
interface MediaQuery { matches: boolean; addEventListener?: (type: "change", listener: () => void) => void; removeEventListener?: (type: "change", listener: () => void) => void }
interface CanvasContext { setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void; clearRect(x: number, y: number, width: number, height: number): void; beginPath(): void; arc(x: number, y: number, radius: number, start: number, end: number): void; fill(): void; globalAlpha: number; fillStyle: string }
interface CanvasNode { width: number; height: number; getBoundingClientRect(): { width: number; height: number; left: number; top: number }; getContext(type: "2d"): CanvasContext | null }
interface BrowserDocument { visibilityState?: "hidden" | "visible"; addEventListener(type: "visibilitychange", listener: () => void): void; removeEventListener(type: "visibilitychange", listener: () => void): void }
interface BrowserWindow { devicePixelRatio?: number; requestAnimationFrame(callback: (time: number) => void): number; cancelAnimationFrame(frame: number): void; addEventListener(type: "pointermove", listener: (event: { clientX: number; clientY: number }) => void, options?: { passive?: boolean }): void; addEventListener(type: "resize", listener: () => void): void; removeEventListener(type: "pointermove", listener: (event: { clientX: number; clientY: number }) => void): void; removeEventListener(type: "resize", listener: () => void): void }
interface ResizeObserverLike { observe(target: object): void; disconnect(): void }

/** Keeps the canvas sharp without growing its backing buffer on unchanged layout. */
export function syncHalftoneCanvasSize(canvas: { width: number; height: number }, width: number, height: number, devicePixelRatio: number): boolean {
  const scale = Math.min(Math.max(devicePixelRatio || 1, 1), 2);
  const nextWidth = Math.max(1, Math.round(width)) * scale;
  const nextHeight = Math.max(1, Math.round(height)) * scale;
  if (canvas.width === nextWidth && canvas.height === nextHeight) return false;
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  return true;
}

function prefersReducedMotion(): boolean {
  const matchMedia = (globalThis as unknown as { matchMedia?: (query: string) => MediaQuery }).matchMedia;
  return !!matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** A bounded, canvas-only dot field. Native receives the same quiet static layer without DOM APIs. */
export function HalftoneField({ intensity, palette = defaultPalette, reducedMotion: reducedOverride }: HalftoneFieldProps) {
  const canvas = useRef<CanvasNode | null>(null);
  const [reduced, setReduced] = useState(() => reducedOverride ?? prefersReducedMotion());
  const staticField = reducedOverride ?? reduced;

  useEffect(() => {
    if (reducedOverride !== undefined) {
      setReduced(reducedOverride);
      return;
    }
    const media = (globalThis as unknown as { matchMedia?: (query: string) => MediaQuery }).matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const change = (): void => setReduced(media.matches);
    media.addEventListener?.("change", change);
    return () => media.removeEventListener?.("change", change);
  }, [reducedOverride]);

  useEffect(() => {
    if (!web || !canvas.current) return;
    const node = canvas.current;
    const doc = (globalThis as unknown as { document: BrowserDocument }).document;
    const win = globalThis as unknown as BrowserWindow;
    let frame = 0;
    let hidden = doc.visibilityState === "hidden";
    let pointer = { x: -10_000, y: -10_000 };

    const draw = (time = 0): void => {
      const rect = node.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const scale = Math.min(win.devicePixelRatio || 1, 2);
      syncHalftoneCanvasSize(node, width, height, scale);
      const context = node.getContext("2d");
      if (!context) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      const columns = Math.min(32, Math.max(12, Math.ceil(width / 26)));
      const rows = Math.min(22, Math.max(10, Math.ceil(height / 26)));
      const stepX = width / columns;
      const stepY = height / rows;
      const base = intensity === "full" ? 0.34 : 0.12;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x = (column + 0.5) * stepX;
          const y = (row + 0.5) * stepY;
          const distance = Math.hypot(pointer.x - x, pointer.y - y);
          const response = reduced ? 0 : Math.max(0, 1 - distance / 190);
          const wave = reduced ? 0 : Math.sin(time / 850 + column * 0.7 + row * 0.45) * 0.14;
          const radius = Math.max(0.55, 0.85 + response * 1.65 + wave);
          context.globalAlpha = base + response * 0.22;
          context.fillStyle = response > 0.45 ? palette.halftoneAccent : palette.halftone;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.globalAlpha = 1;
    };
    const tick = (time: number): void => {
      frame = 0;
      if (hidden || reduced) return;
      draw(time);
      frame = win.requestAnimationFrame(tick);
    };
    const start = (): void => {
      if (!hidden && !reduced && !frame) frame = win.requestAnimationFrame(tick);
    };
    const onVisibility = (): void => {
      hidden = doc.visibilityState === "hidden";
      if (hidden && frame) {
        win.cancelAnimationFrame(frame);
        frame = 0;
      }
      if (!hidden) {
        draw();
        start();
      }
    };
    const onPointer = (event: { clientX: number; clientY: number }): void => {
      pointer = { x: event.clientX - node.getBoundingClientRect().left, y: event.clientY - node.getBoundingClientRect().top };
      if (reduced || hidden) return;
      if (!frame) draw();
    };
    const onResize = (): void => { if (!hidden) draw(); };
    const ResizeObserver = (globalThis as unknown as { ResizeObserver?: new (callback: () => void) => ResizeObserverLike }).ResizeObserver;
    const resizeObserver = ResizeObserver ? new ResizeObserver(onResize) : null;

    draw();
    start();
    doc.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("pointermove", onPointer, { passive: true });
    win.addEventListener("resize", onResize);
    resizeObserver?.observe(node as unknown as object);
    return () => {
      if (frame) win.cancelAnimationFrame(frame);
      doc.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("pointermove", onPointer);
      win.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
    };
  }, [intensity, palette, reduced]);

  if (!web) {
    const dots = Array.from({ length: 120 }, (_, index) => {
      const column = index % 12;
      const row = Math.floor(index / 12);
      return <View key={index} style={{ position: "absolute", left: `${(column + 0.5) * (100 / 12)}%`, top: `${(row + 0.5) * 10}%`, width: 2, height: 2, borderRadius: 1, backgroundColor: palette.halftone }} />;
    });
    return <View testID="auth-halftone" pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: intensity === "full" ? 0.34 : 0.12 }}>{dots}</View>;
  }
  return createElement("canvas", {
    ref: canvas as never,
    "data-testid": "auth-halftone",
    "data-intensity": intensity,
    "data-static": staticField ? "true" : "false",
    "aria-hidden": true,
    style: { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" },
  });
}
