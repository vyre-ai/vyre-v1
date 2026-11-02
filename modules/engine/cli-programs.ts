// Which CLI engine programs are installed on the computer a turn runs on, and what to tell the person when one is not. The engine's PATH is the one it is started with (sandbox-default.ts enginePath):
// the usual install folders and ~/.local/bin are on it, so a Claude Code in ~/.local/bin counts, and last Vyre's own engines folder (engine-install.ts), where Vyre installs what is missing.
import fs from "node:fs";
import path from "node:path";
import { enginePath } from "./sandbox-default.ts";
import { engines, ownedProgramDirs } from "./engine-install.ts";

export interface NodeCliEnv { PATH?: string | undefined; HOME?: string | undefined }
export interface NodeCliProbe {
  platform?: NodeJS.Platform; env?: NodeCliEnv; exists?: (p: string) => boolean; bwrapPaths?: readonly string[];
  /** Vyre's engines folder to look in last (null: none). Default: the folder of this process's installer, when it has one. */
  enginesRoot?: string | null;
}

/** The folders of Vyre's own engines a lookup ends with, for this probe. */
export function ownedDirs(o: NodeCliProbe = {}): string[] {
  const root = o.enginesRoot !== undefined ? o.enginesRoot : engines()?.root ?? null;
  return root === null ? [] : ownedProgramDirs(root);
}

/** Find a program on the PATH an engine is started with. */
export function findProgram(name: string, o: NodeCliProbe = {}): string | null {
  const exists = o.exists ?? ((p: string): boolean => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } });
  const env = o.env ?? process.env;
  for (const dir of enginePath(env, env.HOME ?? "/", o.platform ?? process.platform, o.exists ?? fs.existsSync, undefined, ownedDirs(o)).split(path.delimiter)) {
    const p = path.join(dir, name);
    if (dir !== "" && exists(p)) return p;
  }
  return null;
}

/** Is this path one of Vyre's own engines? Such a program is started by its full path: a sandbox's PATH (bwrap's is fixed) does not hold the engines folder. */
export function isOwned(found: string, o: NodeCliProbe = {}): boolean {
  return ownedDirs(o).some((d) => path.dirname(found) === d);
}


/** The program each CLI driver starts. A driver that is not here (an API driver) needs no program. */
export const CLI_PROGRAM: Readonly<Record<string, string>> = { claude_code: "claude", codex: "codex", grok: "grok" };
/** What each program is called to a person. */
export const CLI_NAME: Readonly<Record<string, string>> = { claude: "Claude", codex: "Codex", grok: "Grok" };
/** The program a connected provider's sign-in runs on (the Vault's provider keys, modules/vault/providers/*.json). An API key runs on Vyre's own API driver and needs no program. */
export const PROGRAM_OF_PROVIDER: Readonly<Record<string, string>> = { "claude-code": "claude", codex: "codex", grok: "grok" };
