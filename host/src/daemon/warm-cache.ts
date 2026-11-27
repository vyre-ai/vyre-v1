// Fills the compile cache (main.ts) for the next start, in a process of its own at the lowest priority, after the server that started it is listening: it imports what a start imports (the daemon and every
// module's handlers, live or stub), and exits; Node writes the cache of what it compiled when the process ends. It changes nothing of the server's.
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

try {
  os.setPriority(19);
} catch {
  /* a platform that does not allow it runs at the normal priority */
}
const root = fileURLToPath(new URL("../../../", import.meta.url));
const load = async (file: string): Promise<void> => {
  try {
    await import(pathToFileURL(file).href);
  } catch {
    /* a module that cannot load here is skipped: the server reports it itself */
  }
};
await load(path.join(root, "host/src/daemon/daemon.ts"));
for (const dir of ["modules", "generated/modules"]) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) continue;
  for (const id of fs.readdirSync(base)) {
    await load(path.join(base, id, dir === "modules" ? "impl.ts" : "stub-impl.ts"));
  }
}
process.exit(0);
