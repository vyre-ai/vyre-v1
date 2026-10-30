// The 0.6 halftone V with its violet dot, drawn dot by dot from the app icon: the dots rise in a wave from the point of the V out to its tips, then breathe. The V is drawn in the page's ink
// and the dot in its accent, so it reads in light and in dark. Web only (a canvas); elsewhere nothing is drawn. Still when the person asks for reduced motion.
import { createElement, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { useJoin } from "./kit.tsx";

interface Cell { x: number; y: number; r: number; vi: boolean; dl: number }
interface Grid { cells: Cell[]; aspect: number; cols: number }

const SRC = "/vyre-hero.png";
let grid: Grid | null = null;
let loading: Promise<Grid | null> | null = null;

/** The icon's pixels as a grid of dots: how big, which are the violet ones, and how far each is from the point of the V (for the wave). */
export function sampleIcon(d: Uint8ClampedArray, n: number): Grid {
  const X0 = 0.17, X1 = 0.94, Y0 = 0.2, Y1 = 0.85, cols = 46, rows = Math.round(cols * (Y1 - Y0) / (X1 - X0)), cells: Cell[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const px0 = Math.floor((X0 + (X1 - X0) * i / cols) * n), px1 = Math.max(px0 + 1, Math.floor((X0 + (X1 - X0) * (i + 1) / cols) * n));
    const py0 = Math.floor((Y0 + (Y1 - Y0) * j / rows) * n), py1 = Math.max(py0 + 1, Math.floor((Y0 + (Y1 - Y0) * (j + 1) / rows) * n));
    let r = 0, g = 0, b = 0, c = 0;
    for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) { const o = (y * n + x) * 4; r += d[o]!; g += d[o + 1]!; b += d[o + 2]!; c++; }
    r /= c; g /= c; b /= c;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b, violet = b - r > 28 && lum > 80, v = Math.max(0, Math.min(1, (lum - 30) / 150));
    if (v > 0.06) cells.push({ x: (i + 0.5) / cols, y: (j + 0.5) / rows, r: Math.sqrt(v), vi: violet, dl: 0 });
  }
  for (const c of cells) c.dl = Math.min(1, Math.hypot((c.x - 0.52) * 1.2, c.y - 0.97) / 1.15);
  return { cells, aspect: (X1 - X0) / (Y1 - Y0), cols };
}

function load(): Promise<Grid | null> {
  if (grid) return Promise.resolve(grid);
  if (!loading) loading = new Promise<Grid | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const n = 192, c = document.createElement("canvas"); c.width = c.height = n;
        const x = c.getContext("2d", { willReadFrequently: true }); if (!x) return resolve(null);
        x.drawImage(img, 0, 0, n, n);
        grid = sampleIcon(x.getImageData(0, 0, n, n).data, n); resolve(grid);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = SRC;
  });
  return loading;
}

export function HalftoneV({ size = 200 }: { size?: number }): ReactElement | null {
  const { p } = useJoin();
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let raf = 0, dead = false;
    const t0 = performance.now();
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    void load().then((g) => {
      const cv = ref.current;
      if (!g || !cv || dead) return;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = size * dpr; cv.height = size * dpr;
      const W = cv.width, H = cv.height, ow = W / g.aspect > H ? H * g.aspect : W, oh = ow / g.aspect, ox = (W - ow) / 2, oy = (H - oh) / 2, cell = ow / g.cols;
      const frame = (): void => {
        if (dead) return;
        const t = still ? 9 : (performance.now() - t0) / 1000;
        ctx.clearRect(0, 0, W, H);
        for (const c of g.cells) {
          const k = Math.max(0, Math.min(1, (t - 0.15 - c.dl * 0.9) / 0.5)), e = 1 - Math.pow(1 - k, 3), over = k > 0 && k < 1 ? 1 + Math.sin(k * Math.PI) * 0.35 : 1;
          const shimmer = 1 + Math.sin(t * 1.6 - c.dl * 7) * 0.05 * (t > 2 ? 1 : 0), rr = cell * 0.5 * c.r * 1.12 * e * over * shimmer;
          if (rr < 0.15) continue;
          ctx.fillStyle = c.vi ? p.blue : p.tx; ctx.beginPath(); ctx.arc(ox + c.x * ow, oy + c.y * oh, rr, 0, 6.2832); ctx.fill();
        }
        if (!still) raf = requestAnimationFrame(frame);
      };
      frame();
    });
    return () => { dead = true; cancelAnimationFrame(raf); };
  }, [size, p.blue, p.tx]);
  if (Platform.OS !== "web") return null;
  return createElement("canvas", { ref, width: size, height: size, "aria-hidden": true, "data-testid": "halftone-v", style: { width: size, height: size, display: "block", flex: "none" } });
}
