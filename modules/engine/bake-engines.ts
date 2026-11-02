// Bakes the CLI engines into an image: every program engine-pins.ts pins (Claude Code, Codex, Grok), for the computer this runs on, through the same checked install a computer uses when one is missing
// (engine-install.ts), then linked by name into a folder on PATH and run once with --version so a build whose engine cannot start fails here, not in a person's chat.
//   node modules/engine/bake-engines.ts <engines folder> <bin folder>      (images/vyred/Dockerfile: /usr/local/lib/vyre/engines /usr/local/bin)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_PINS } from "./engine-pins.ts";
import { enginePlatform, installEngine } from "./engine-install.ts";

export async function bakeEngines(into: string, bin: string, o: { log?: (line: string) => void; install?: typeof installEngine; run?: (program: string) => string } = {}): Promise<Record<string, string>> {
  const log = o.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const install = o.install ?? installEngine;
  const run = o.run ?? ((program: string) => execFileSync(program, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }).trim());
  if (enginePlatform() === null) throw new Error(`no engine builds are pinned for ${process.platform}-${process.arch}`);
  fs.mkdirSync(into, { recursive: true, mode: 0o755 });
  fs.mkdirSync(bin, { recursive: true });
  const out: Record<string, string> = {};
  for (const pin of Object.values(ENGINE_PINS)) {
    const at = await install(pin.program, { root: into });
    const link = path.join(bin, pin.program);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(at, link);
    out[pin.program] = run(link);
    log(`${pin.program} ${pin.version}: ${out[pin.program]}`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [into, bin] = process.argv.slice(2);
  if (!into || !bin || !path.isAbsolute(into) || !path.isAbsolute(bin)) { process.stderr.write("usage: node modules/engine/bake-engines.ts <engines folder> <bin folder> (both absolute)\n"); process.exit(2); }
  try { await bakeEngines(into, bin); }
  catch (e) { process.stderr.write(`bake-engines: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); }
}
