// `vyred` entry point: node host/src/daemon/main.ts --role space --data-dir D [--space spc_x] [--port 8420] [--host 127.0.0.1]
// The installer's launchd and systemd units, the Tauri sidecar and `vyre server start` all run this file. SIGTERM, SIGINT and Windows SIGBREAK stop it cleanly.
import { loadConfig } from "./config.ts";
import type { DaemonConfig } from "./config.ts";
import { startDaemon } from "./daemon.ts";
import type { Daemon } from "./daemon.ts";

const version = process.env["VYRE_VERSION"] ?? "0.0.0-dev";

async function main(): Promise<number> {
  let config: DaemonConfig;
  try { config = loadConfig(process.argv.slice(2), process.env, version); }
  catch (e) { process.stderr.write(`vyred: ${e instanceof Error ? e.message : String(e)}\n`); return 2; }
  let d: Daemon;
  try { d = await startDaemon({ config }); }
  catch (e) { process.stderr.write(`vyred: ${e instanceof Error ? e.message : String(e)}\n`); return 1; }
  process.stdout.write(`vyred ${version} ${d.roles.join(",")} ${d.space ?? "-"} listening on ${d.url}\n`);
  if (d.claim) process.stdout.write(`Claim this Space as its owner (one time, valid 24 hours): ${d.claim.url}\n`);
  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = (): void => { if (stopping) return; stopping = true; void d.stop().finally(resolve); };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    // SIGBREAK is Windows' console-control signal; unlike a forced taskkill it lets
    // the daemon remove vyred.json and close its stores before the process exits.
    if (process.platform === "win32") process.once("SIGBREAK", stop);
  });
  return 0;
}

process.exitCode = await main();
