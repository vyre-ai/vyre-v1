// vyre-sites-runner: the one process on a Vyre server that holds the Docker socket (compose.server.yml runs it beside vyred with no network). It makes a new token each start and writes
// it next to its socket, in a folder only it and vyred mount; vyred reads it from there.
import fs from "node:fs";
import path from "node:path";
import { createSitesRunner } from "./server.ts";

const listen = process.env["VYRE_SITES_RUNNER_SOCKET"] ?? "/run/vyre-sites/runner.sock";
const tokenFile = process.env["VYRE_SITES_RUNNER_TOKEN_FILE"] ?? path.join(path.dirname(listen), "token");
const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
fs.mkdirSync(path.dirname(listen), { recursive: true });
fs.writeFileSync(`${tokenFile}.new`, token, { mode: 0o644 });
fs.renameSync(`${tokenFile}.new`, tokenFile);
const r = createSitesRunner({ dockerSocket: process.env["VYRE_DOCKER_SOCKET"] ?? "/var/run/docker.sock", listen, token, log: (l) => process.stdout.write(`vyre-sites-runner: ${l}\n`) });
await r.listening;
const stop = (): void => { void r.close().then(() => process.exit(0)); };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
