// The live view's frames: ffmpeg grabs the screen at a steady rate and writes motion JPEG; this file cuts the stream into whole JPEG images and hands each to everyone watching. ffmpeg runs only
// while someone watches (or a recording needs it) and stops a few seconds after the last viewer leaves.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const MAX_FRAME = 8 * 1024 * 1024;

/** Cuts a stream of concatenated JPEG images into images. A JPEG's entropy data stores 0xFF as 0xFF 0x00, so the first 0xFF 0xD9 after 0xFF 0xD8 is the end of that image. */
export function createJpegSplitter(onFrame: (jpeg: Buffer) => void): (chunk: Buffer) => void {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    for (;;) {
      const start = buf.indexOf(SOI);
      if (start < 0) { buf = Buffer.alloc(0); return; }
      const end = buf.indexOf(EOI, start + 2);
      if (end < 0) {
        buf = start > 0 ? buf.subarray(start) : buf;
        if (buf.length > MAX_FRAME) buf = Buffer.alloc(0);
        return;
      }
      onFrame(buf.subarray(start, end + 2));
      buf = buf.subarray(end + 2);
    }
  };
}

/** Width and height from a JPEG's start-of-frame marker, or null. */
export function jpegSize(jpeg: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 < jpeg.length) {
    if (jpeg[at] !== 0xff) { at += 1; continue; }
    const marker = jpeg[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (jpeg[at + 5]! << 8) | jpeg[at + 6]!, width: (jpeg[at + 7]! << 8) | jpeg[at + 8]! };
    }
    at += 2 + ((jpeg[at + 2]! << 8) | jpeg[at + 3]!);
  }
  return null;
}

export interface FrameHub {
  /** Start watching. The returned function stops. The first watcher starts ffmpeg. */
  watch(onFrame: (jpeg: Buffer) => void): () => void;
  viewers(): number;
  lastFrameAt(): number | null;
  /** The newest frame, if any. */
  latest(): Buffer | null;
}

export interface FrameHubOptions {
  display: string;
  size: string;
  fps: number;
  /** Quality for ffmpeg's -q:v, 2 (best) to 31. */
  quality?: number;
  /** How long ffmpeg stays up after the last viewer leaves. Default 3 s. */
  lingerMs?: number;
  log?: (msg: string) => void;
}

export function createFrameHub(o: FrameHubOptions): FrameHub {
  const watchers = new Set<(jpeg: Buffer) => void>();
  let proc: ChildProcess | null = null;
  let last: Buffer | null = null;
  let lastAt: number | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  const log = o.log ?? (() => undefined);

  const start = (): void => {
    if (proc) return;
    const cut = createJpegSplitter((jpeg) => {
      last = jpeg;
      lastAt = Date.now();
      for (const w of watchers) w(jpeg);
    });
    const p = spawn("ffmpeg", [
      "-loglevel", "error", "-nostdin", "-f", "x11grab", "-framerate", String(o.fps), "-video_size", o.size, "-draw_mouse", "1", "-i", o.display,
      "-vf", `fps=${o.fps}`, "-q:v", String(o.quality ?? 7), "-f", "mjpeg", "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    proc = p;
    p.stdout!.on("data", (c: Buffer) => cut(c));
    p.stderr!.on("data", (c: Buffer) => log(`ffmpeg: ${c.toString("utf8").trim().slice(0, 300)}`));
    p.on("exit", () => {
      if (proc === p) proc = null;
      // A viewer is still there: the grab died (the X server restarted). Start it again.
      if (watchers.size > 0) setTimeout(start, 500);
    });
  };

  const stop = (): void => {
    stopTimer = null;
    if (watchers.size > 0 || !proc) return;
    const p = proc;
    proc = null;
    p.kill("SIGTERM");
  };

  return {
    watch(onFrame) {
      watchers.add(onFrame);
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
      start();
      if (last) onFrame(last);
      return () => {
        watchers.delete(onFrame);
        if (watchers.size === 0 && !stopTimer) stopTimer = setTimeout(stop, o.lingerMs ?? 3000);
      };
    },
    viewers: () => watchers.size,
    lastFrameAt: () => lastAt,
    latest: () => last,
  };
}
