// `vyred` entry point: node host/src/daemon/main.ts --role space --data-dir D [--space spc_x] [--port 8420] [--host 127.0.0.1]
// The installer's launchd and systemd units, the Tauri sidecar and `vyre server start` all run this file. SIGTERM, SIGINT and Windows SIGBREAK stop it cleanly.
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import type { DaemonConfig } from "./config.ts";
import { startDaemon } from "./daemon.ts";
import type { Daemon } from "./daemon.ts";

const version = process.env["VYRE_VERSION"] ?? "0.0.0-dev";

/** `vyred --role compute --server <address> --join <code>`: a guest computer for a Space (host/src/compute/node.ts). It holds no Space of its own. */
async function runCompute(config: DaemonConfig): Promise<number> {
  let host: unknown;
  const { fileExportsImporter } = await import("../loader.ts");
  const { createComputersHost } = await import("../seams/computers-host.ts");
  const importSeams = (root: string): Promise<unknown> => fileExportsImporter(root)("computers");
  const { runComputeNode } = await import("../compute/node.ts");
  const os = await import("node:os");
  if (!config.server) { process.stderr.write("vyred: --role compute needs --server <the Space address>\n"); return 2; }
  const abort = new AbortController();
  process.once("SIGTERM", () => abort.abort()); process.once("SIGINT", () => abort.abort());
  const docker = async (): Promise<boolean> => { try { const { execFileSync } = await import("node:child_process"); execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore", timeout: 4000 }); return true; } catch { return false; } };
  let dockerUp = await docker();
  const timer = setInterval(() => { void docker().then((v) => { dockerUp = v; }); }, 60_000); timer.unref();
  try {
    const end = await runComputeNode({
      server: config.server, join: config.join, dataDir: config.dataDir, name: os.hostname(), signal: abort.signal, now: Date.now,
      fetch: (url, init) => fetch(url, init) as never,
      sleep: (ms, signal) => new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("stopped")); }, { once: true }); }),
      // what runs the jobs: the agent computers module's own Docker host (the same one a Space binds), reached through its host seam; its home mirror goes back to the Space on each job's token
      makeHost: (link) => {
        const root = fileURLToPath(new URL("../../..", import.meta.url));
        const seams = importSeams(root);
        return {
          async run(kind, input) {
            const s = (await seams) as { buildComputerHost?: (c: unknown) => unknown; nodeRun?: (h: unknown, k: string, i: unknown) => Promise<unknown> } | undefined;
            if (!s?.buildComputerHost || !s.nodeRun) throw new Error("this computer has no agent computers module");
            host ??= s.buildComputerHost(createComputersHost({ dataDir: config.dataDir, callAs: link.call, putBytes: link.put, homeIntervalMs: 2_000_000_000, log: (level, msg, attrs) => process.stderr.write(`vyred: ${level} ${msg} ${JSON.stringify(attrs ?? {})}\n`) }));
            return s.nodeRun(host, kind, input);
          },
        };
      },
      pollMs: Number(process.env["VYRE_POLL_MS"]) || 3_000, log: (line) => process.stdout.write(`vyred: ${line}\n`),
      facts: () => ({ os: process.platform, arch: process.arch, docker: dockerUp, version }),
    });
    return end === "stopped" ? 0 : end === "declined" ? 3 : 4;
  } catch (e) { process.stderr.write(`vyred: ${e instanceof Error ? e.message : String(e)}\n`); return 1; } finally { clearInterval(timer); }
}

async function main(): Promise<number> {
  let config: DaemonConfig;
  try { config = loadConfig(process.argv.slice(2), process.env, version); }
  catch (e) { process.stderr.write(`vyred: ${e instanceof Error ? e.message : String(e)}\n`); return 2; }
  if (config.roles.includes("compute")) return runCompute(config);
  let resolveStopped:()=>void=()=>{};
  const stopped=new Promise<void>(resolve=>{resolveStopped=resolve;});
  let d: Daemon;
  try { d = await startDaemon({ config, onStopped:resolveStopped }); }
  catch (e) {
    // A daemon that could not start ends here, at once and non-zero, with the reason on stderr: the services it had begun (the scheduler, the stores) would otherwise keep the process alive and the
    // shell that started it would wait out its timeout instead of showing this line.
    process.stderr.write(`vyred: ${e instanceof Error ? e.message : String(e)}\n`, () => process.exit(1));
    return 1;
  }
  process.stdout.write(`vyred ${version} ${d.roles.join(",")} ${d.space ?? "-"} listening on ${d.url}\n`);
  if (d.claim) process.stdout.write(`Claim this Space as its owner (one time, valid 24 hours): ${d.claim.url}\n`);
  await Promise.race([stopped,new Promise<void>((resolve) => {
    let stopping = false;
    const stop = (): void => { if (stopping) return; stopping = true; void d.stop().finally(resolve); };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    // SIGBREAK is Windows' console-control signal; unlike a forced taskkill it lets
    // the daemon remove vyred.json and close its stores before the process exits.
    if (process.platform === "win32") process.once("SIGBREAK", stop);
  })]);
  return 0;
}

process.exitCode = await main();
