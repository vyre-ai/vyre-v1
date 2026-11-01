// A computer that goes to sleep kills what is running on it, and a Job lost that way can only ask to be run again. While any turn runs, the Mac keeps itself awake (hole 12). `caffeinate -i` holds the
// system-idle power assertion the same way an app would, and `-w` ties it to this process, so a server that dies leaves nothing behind. Other systems: a server does not sleep, and nothing is done.
import { spawn } from "node:child_process";

export interface KeepAwake { up(): void; down(): void; stop(): void }
export interface KeepAwakeDeps { platform?: string; pid?: number; run?: (cmd: string, args: readonly string[]) => { kill(): void; on(ev: "error", fn: () => void): void } }

export function createKeepAwake(d: KeepAwakeDeps = {}): KeepAwake {
  const mac = (d.platform ?? process.platform) === "darwin";
  const run = d.run ?? ((cmd, args) => { const c = spawn(cmd, [...args], { stdio: "ignore" }); c.unref(); return c; });
  let running = 0;
  let held: { kill(): void } | null = null;
  const release = (): void => { try { held?.kill(); } catch { /* already gone */ } held = null; };
  return {
    up() {
      running += 1;
      if (!mac || held) return;
      try { const c = run("caffeinate", ["-i", "-w", String(d.pid ?? process.pid)]); c.on("error", () => { held = null; }); held = c; } catch { /* a computer that cannot hold it just sleeps as it would have */ }
    },
    down() { running = Math.max(0, running - 1); if (running === 0) release(); },
    stop() { running = 0; release(); },
  };
}
