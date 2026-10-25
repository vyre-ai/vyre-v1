// Recording (spec 2.7): the screen as video in the agent's Files folder (work/recordings/<id>/video.mp4), and beside it the events and the network log the module masks and saves.
// ffmpeg writes a fragmented mp4, so a recording that is cut short (the container stops) still plays up to the cut.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { badInput, notFound, unavailable } from "./errors.ts";
import type { Screen } from "./x11.ts";

const ID = /^rcd_[a-z0-9]+$/;

export interface RecordResult { events: string; har: string; durationMs: number; bytes: number }

export interface Recorder {
  start(recordingId: string): void;
  /** Add one thing the agent or the person did to the recording's events. No-op when nothing is recording. */
  note(event: Record<string, unknown>): void;
  recording(): string | null;
  stop(recordingId: string): Promise<RecordResult>;
}

export function createRecorder(screen: Screen, filesRoot: string, fps: number): Recorder {
  let cur: { id: string; proc: ChildProcess; startedAt: number; file: string; events: string[] } | null = null;

  return {
    start(id) {
      if (!ID.test(id)) throw badInput("A recording id looks like rcd_ followed by letters and digits.");
      if (cur) throw badInput(`Already recording ${cur.id}.`);
      const dir = join(filesRoot, "work", "recordings", id);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "video.mp4");
      const proc = spawn("ffmpeg", [
        "-loglevel", "error", "-nostdin", "-y", "-f", "x11grab", "-framerate", String(fps), "-video_size", screen.size, "-draw_mouse", "1", "-i", screen.display,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+frag_keyframe+empty_moov+default_base_moof", file,
      ], { stdio: ["pipe", "ignore", "pipe"] });
      proc.on("error", () => { if (cur?.proc === proc) cur = null; });
      cur = { id, proc, startedAt: Date.now(), file, events: [] };
    },
    note(event) {
      if (cur) cur.events.push(JSON.stringify({ t: Date.now() - cur.startedAt, ...event }));
    },
    recording: () => cur?.id ?? null,
    async stop(id) {
      if (!cur || cur.id !== id) throw notFound(`Nothing is recording as ${id}.`);
      const r = cur;
      cur = null;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { r.proc.kill("SIGKILL"); resolve(); }, 10_000);
        r.proc.once("exit", () => { clearTimeout(t); resolve(); });
        r.proc.once("error", (e) => { clearTimeout(t); reject(unavailable(`the recorder failed: ${e.message}`)); });
        // "q" is how ffmpeg is asked to finish a file cleanly.
        try { r.proc.stdin!.write("q"); r.proc.stdin!.end(); } catch { r.proc.kill("SIGINT"); }
      });
      let bytes = 0;
      try { bytes = statSync(r.file).size; } catch { /* nothing was written */ }
      const har = { log: { version: "1.2", creator: { name: "agentd", version: "1.0" }, entries: [] as unknown[] } };
      return { events: r.events.length > 0 ? r.events.join("\n") + "\n" : "", har: JSON.stringify(har), durationMs: Date.now() - r.startedAt, bytes };
    },
  };
}
