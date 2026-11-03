// "Use the sign-in on this computer" (owner decision D2, 3 Nov 2026): in a Personal Space, whose server is this computer, the Claude Code or Codex sign-in the person already has here is
// taken as their account instead of asking them to sign in again. It is read once, when they press the button, and saved into their own Mine item like any sign-in (the Vault module does
// that); it is never sent to a client, an agent or a log. Nothing is read in a Team Space: the provider-signin seam is only given this reader by a Personal Space daemon.
//
//   codex        $CODEX_HOME/auth.json, else ~/.codex/auth.json: the file `codex login` writes. Saved as the same file map the device sign-in saves ({".codex/auth.json": text}).
//   claude-code  $CLAUDE_CONFIG_DIR/.credentials.json, else ~/.claude/.credentials.json (Linux, Windows); on a Mac, Claude Code keeps it in the login Keychain under
//                "Claude Code-credentials". Saved as {".claude/.credentials.json": text}, the file Claude Code reads from its config folder, so the engine's own refresh writes it back
//                (signin-refresh.ts) and the sign-in does not run out after a few hours.
// UNVERIFIED against live accounts: the layouts are read as the CLIs write them today (Codex tokens.access_token and refresh_token; Claude claudeAiOauth.accessToken and refreshToken). A
// layout that changes reads as "no sign-in here" and nothing is saved.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexIdentity } from "./signin-identity.ts";
import type { SigninProvider, SigninStep } from "./provider-signin.ts";

export interface LocalSigninDeps {
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
  platform?: string;
  /** Read a file as text; null when it is not there. */
  readFile?: (p: string) => string | null;
  /** The Mac Keychain entry Claude Code keeps its sign-in in; null when there is none. */
  keychain?: (service: string) => string | null;
}

const CLAUDE_KEYCHAIN = "Claude Code-credentials";
const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const parse = (t: string): unknown => { try { return JSON.parse(t) as unknown; } catch { return undefined; } };

function readText(p: string): string | null {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function macKeychain(service: string): string | null {
  try { return execFileSync("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { return null; }
}

const none = (who: string): SigninStep => ({ state: "failed", message: `There is no ${who} sign-in on this computer. Sign in instead.` });

/** The sign-in already on this computer, as the fields a sign-in saves. A failed step names what is missing in plain words. */
export function readLocalSignin(provider: SigninProvider, deps: LocalSigninDeps = {}): SigninStep {
  const env = deps.env ?? process.env;
  const home = deps.home ?? os.homedir();
  const read = deps.readFile ?? readText;
  if (provider === "codex") {
    const dir = str(env["CODEX_HOME"]) || path.join(home, ".codex");
    const text = read(path.join(dir, "auth.json"));
    const j = text === null ? null : rec(parse(text));
    const tokens = rec(j?.["tokens"]);
    if (!j || str(tokens?.["access_token"]) === "" || str(tokens?.["refresh_token"]) === "") return none("ChatGPT (Codex)");
    const who = codexIdentity(str(tokens?.["id_token"]));
    return { state: "done", fields: [{ key: "credentials", value: JSON.stringify({ ".codex/auth.json": text }), secret: true }], ...(who ? { identity: who } : {}) };
  }
  if (provider === "claude-code") {
    const dir = str(env["CLAUDE_CONFIG_DIR"]) || path.join(home, ".claude");
    let text = read(path.join(dir, ".credentials.json"));
    if (text === null && (deps.platform ?? process.platform) === "darwin") text = (deps.keychain ?? macKeychain)(CLAUDE_KEYCHAIN);
    const oauth = text === null ? null : rec(rec(parse(text))?.["claudeAiOauth"]);
    if (!oauth || str(oauth["accessToken"]) === "" || str(oauth["refreshToken"]) === "") return none("Claude Code");
    return { state: "done", fields: [{ key: "credentials", value: JSON.stringify({ ".claude/.credentials.json": text }), secret: true }] };
  }
  return { state: "failed", message: "Only a Claude Code or Codex sign-in on this computer can be used. Sign in instead." };
}
