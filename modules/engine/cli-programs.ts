// Which CLI engine programs are installed on the computer a turn runs on, and what to tell the person when one is not. The engine's PATH is the one it is started with (sandbox-default.ts enginePath):
// the usual install folders and ~/.local/bin are on it, so a Claude Code in ~/.local/bin counts.
import fs from "node:fs";
import path from "node:path";
import { enginePath } from "./sandbox-default.ts";

export interface NodeCliEnv { PATH?: string | undefined; HOME?: string | undefined }
export interface NodeCliProbe { platform?: NodeJS.Platform; env?: NodeCliEnv; exists?: (p: string) => boolean; bwrapPaths?: readonly string[] }

/** Find a program on the PATH an engine is started with. */
export function findProgram(name: string, o: NodeCliProbe = {}): string | null {
  const exists = o.exists ?? ((p: string): boolean => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } });
  const env = o.env ?? process.env;
  for (const dir of enginePath(env, env.HOME ?? "/", o.platform ?? process.platform, o.exists ?? fs.existsSync).split(path.delimiter)) {
    const p = path.join(dir, name);
    if (dir !== "" && exists(p)) return p;
  }
  return null;
}


/** The program each CLI driver starts. A driver that is not here (an API driver) needs no program. */
export const CLI_PROGRAM: Readonly<Record<string, string>> = { claude_code: "claude", codex: "codex", grok: "grok" };
/** What each program is called to a person. */
export const CLI_NAME: Readonly<Record<string, string>> = { claude: "Claude", codex: "Codex", grok: "Grok" };
/** The exact command that installs a program, when there is one we can name. */
export const CLI_INSTALL: Readonly<Record<string, string>> = { claude: "npm install -g @anthropic-ai/claude-code", codex: "npm install -g @openai/codex" };
