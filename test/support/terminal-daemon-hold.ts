// Holds one daemon of a Personal Space with the stand-in model open until the parent stops it (SIGTERM: a clean stop, as an update stops it) or kills it (SIGKILL: a crash). The terminal's
// restart proof (test/terminal.restart.heavy.test.ts) uses it, so a stop really ends the process the way a daemon's does.
import { loadConfig } from "../../host/src/daemon/config.ts";
import { boot, standIn } from "../memory-live-kit.ts";

const dir = process.argv[process.argv.indexOf("--data-dir") + 1];
if (!dir) {
  process.stderr.write("missing --data-dir\n");
  process.exit(2);
}

const d = await boot(dir, standIn, undefined, {
  config: loadConfig(
    [
      "--data-dir",
      dir,
      "--port",
      "0",
      "--space",
      "spc_keep",
      "--space-name",
      "Personal",
      "--space-kind",
      "personal",
      "--role",
      "space,device",
    ],
    {},
    "1.2.3",
  ),
  computersHomeIntervalMs: 300,
  workspaceIdleMs: 600_000,
});
// the consumers run as a daemon's do, on their own
const pump = setInterval(() => {
  void d.hooks?.pump?.()?.catch?.(() => undefined);
}, 200);
process.stdout.write(`listening ${d.url}\n`);
if (d.claim?.url) process.stdout.write(`claim ${d.claim.url}\n`);
// on a clean stop the consumers keep being pumped while the daemon winds down (the worst case: the closing turns' records are consumed by this process, which still holds its runs' marks)
process.on("SIGTERM", () => {
  void (async () => {
    const stopping = d.stop().catch(() => undefined);
    for (let i = 0; i < 10; i++) {
      await d.hooks?.pump?.()?.catch?.(() => undefined);
      await new Promise((r) => setTimeout(r, 100));
    }
    await stopping;
    clearInterval(pump);
    process.exit(0);
  })();
});
setInterval(() => {}, 60_000);
