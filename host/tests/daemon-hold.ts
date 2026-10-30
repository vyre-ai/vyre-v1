// Holds one daemon open until the parent kills the process. The crash proof uses this instead of a module import.
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";

const dir = process.argv[process.argv.indexOf("--data-dir") + 1];
if (!dir) {
  process.stderr.write("missing --data-dir\n");
  process.exit(2);
}

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

const daemon = await startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "killed-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (header) => {
    const token = /^Bearer (.+)$/.exec(String(header["authorization"] ?? ""))?.[1];
    return token === "tok-usr_olivia" ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "killed-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
});

process.stdout.write(`listening ${daemon.url}\n`);
setInterval(() => {}, 60_000);
