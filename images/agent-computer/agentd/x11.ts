// The screen and the hands: Xvfb is the display, a Python helper injects input through XTEST, ffmpeg takes a still.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { sleep, unavailable } from "./errors.ts";

export interface Screen { display: string; size: string; width: number; height: number }

export function parseSize(size: string): { width: number; height: number } {
  const m = /^(\d{3,5})x(\d{3,5})$/.exec(size);
  if (!m) throw new Error(`bad screen size ${size}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export async function startXvfb(screen: Screen, log: (m: string) => void): Promise<ChildProcess> {
  const num = screen.display.replace(/^:/, "");
  const p = spawn("Xvfb", [screen.display, "-screen", "0", `${screen.size}x24`, "-nolisten", "tcp", "-ac", "+extension", "XTEST"], { stdio: ["ignore", "ignore", "pipe"] });
  p.stderr!.on("data", (c: Buffer) => log(`Xvfb: ${c.toString("utf8").trim().slice(0, 300)}`));
  const socket = `/tmp/.X11-unix/X${num}`;
  for (let i = 0; i < 100; i++) {
    if (existsSync(socket)) return p;
    if (p.exitCode !== null) throw new Error("Xvfb exited before the display was up");
    await sleep(100);
  }
  throw new Error("Xvfb did not come up in 10 seconds");
}

export interface Pointer { x: number; y: number }
export interface Injector {
  /** One input; resolves once the X server has taken it, with where the pointer is. */
  call(req: Record<string, unknown>): Promise<Pointer>;
  stop(): void;
}

export function createInjector(screen: Screen, log: (m: string) => void): Injector {
  let proc: ChildProcess | null = null;
  let next = 0;
  const pending = new Map<number, { ok: (p: Pointer) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const boot = (): ChildProcess => {
    const p = spawn("python3", ["/opt/agentd/input.py"], { env: { ...process.env, DISPLAY: screen.display }, stdio: ["pipe", "pipe", "pipe"] });
    p.stderr!.on("data", (c: Buffer) => log(`input.py: ${c.toString("utf8").trim().slice(0, 300)}`));
    createInterface({ input: p.stdout! }).on("line", (line) => {
      let r: { id?: number; ok?: boolean; x?: number; y?: number; error?: string };
      try { r = JSON.parse(line); } catch { return; }
      const w = r.id === undefined ? undefined : pending.get(r.id);
      if (!w || r.id === undefined) return;
      pending.delete(r.id);
      clearTimeout(w.timer);
      if (r.ok) w.ok({ x: Number(r.x), y: Number(r.y) });
      else w.fail(new Error(r.error ?? "the input was refused"));
    });
    p.on("exit", () => {
      if (proc === p) proc = null;
      for (const [id, w] of pending) { clearTimeout(w.timer); w.fail(new Error("the input helper stopped")); pending.delete(id); }
    });
    proc = p;
    return p;
  };

  return {
    call(req) {
      const p = proc ?? boot();
      const id = ++next;
      return new Promise<Pointer>((ok, fail) => {
        const timer = setTimeout(() => { pending.delete(id); fail(new Error("the input helper did not answer")); }, 5000);
        pending.set(id, { ok, fail, timer });
        p.stdin!.write(JSON.stringify({ ...req, id }) + "\n", (e) => { if (e) { pending.delete(id); clearTimeout(timer); fail(e); } });
      }).catch((e: unknown) => { throw unavailable(`input failed: ${e instanceof Error ? e.message : "unknown"}`); });
    },
    stop() { proc?.kill("SIGTERM"); proc = null; },
  };
}

/** A still of the whole desktop as PNG. */
export function screenshotPng(screen: Screen): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const p = spawn("ffmpeg", ["-loglevel", "error", "-nostdin", "-f", "x11grab", "-video_size", screen.size, "-draw_mouse", "1", "-i", screen.display, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout!.on("data", (c: Buffer) => out.push(c));
    p.stderr!.on("data", (c: Buffer) => { err += c.toString("utf8"); });
    p.on("error", (e) => reject(unavailable(`could not take a screenshot: ${e.message}`)));
    p.on("close", (code) => (code === 0 && out.length > 0 ? resolve(Buffer.concat(out)) : reject(unavailable(`could not take a screenshot: ${err.trim().slice(0, 200) || `ffmpeg exited ${code}`}`))));
  });
}
