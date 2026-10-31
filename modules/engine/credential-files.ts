// Sign-in files for a CLI engine that signs in with files (Codex's auth.json, Grok's own). The Vault item holds them as one secret field, `credentials`: a JSON map of path, relative to the engine's home,
// to the text of the file. The fill puts that map in the process environment under VYRE_CRED_FILES; the launcher takes it out of the environment before the engine starts, writes the files with mode 0600
// into the engine's own home (the person's scratch folder, the one place besides the work folder the sandbox lets it write), and removes them when the process ends. They are never in a log, an argv or an answer.
import fs from "node:fs";
import path from "node:path";
import { scratchFolder } from "./sandbox.ts";

export const CRED_FILES_ENV = "VYRE_CRED_FILES";
const MAX_FILES = 32;
const MAX_BYTES = 65_536;

export class CredentialFilesError extends Error {
  readonly code = "engine.account_unavailable";
  constructor(message: string) { super(message); this.name = "CredentialFilesError"; }
}

/** The environment without the sign-in files, and the files as the item holds them. */
export function takeCredentialFiles(env: Readonly<Record<string, string>>): { env: Record<string, string>; files: string | undefined } {
  const { [CRED_FILES_ENV]: files, ...rest } = env;
  return { env: rest, files };
}

/** A file map checked: relative paths that stay in the home, a bounded number of bounded files. */
export function parseCredentialFiles(json: string): Record<string, string> {
  let v: unknown;
  try { v = JSON.parse(json); } catch { throw new CredentialFilesError("The saved sign-in is not readable. Sign in again."); }
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new CredentialFilesError("The saved sign-in is not readable. Sign in again.");
  const out: Record<string, string> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_FILES) throw new CredentialFilesError("The saved sign-in has no files. Sign in again.");
  for (const [rel, text] of entries) {
    const segs = rel.split("/");
    if (typeof text !== "string" || text.length > MAX_BYTES || rel === "" || rel.startsWith("/") || rel.includes("\0") || segs.some((s) => s === "" || s === "." || s === "..")) throw new CredentialFilesError("The saved sign-in is not readable. Sign in again.");
    out[rel] = text;
  }
  return out;
}

/** The home of the engine for this person: `<scratch>/home`, where the Seatbelt profile and the bwrap home bind put it. The person is named by the work folder. */
export function engineHome(dataDir: string, cwd: string): string {
  const workRoot = fs.realpathSync(path.join(dataDir, "work"));
  const rel = path.relative(workRoot, cwd).split(path.sep);
  if (rel.length !== 2 || rel.some((x) => x === "" || x === "..")) throw new CredentialFilesError("The engine is not in one of the Space's work folders.");
  const home = path.join(scratchFolder(dataDir, rel[0] as string), "home");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

export interface Placed { home: string; release(): void }

/** Write the files, 0600, in folders 0700. `release` overwrites each with zeros and removes it; safe to call twice. */
export function placeCredentialFiles(dataDir: string, cwd: string, json: string): Placed {
  const files = parseCredentialFiles(json);
  const home = engineHome(dataDir, cwd);
  const written: string[] = [];
  const release = (): void => {
    for (const p of written.splice(0)) {
      try { const n = fs.statSync(p).size; fs.writeFileSync(p, Buffer.alloc(n)); } catch { /* already gone */ }
      try { fs.unlinkSync(p); } catch { /* already gone */ }
    }
  };
  try {
    for (const [rel, text] of Object.entries(files)) {
      const p = path.join(home, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
      // a link left where the file goes is removed, never followed
      try { fs.unlinkSync(p); } catch { /* nothing there */ }
      fs.writeFileSync(p, text, { mode: 0o600, flag: "wx" });
      fs.chmodSync(p, 0o600);
      written.push(p);
    }
  } catch (e) { release(); throw e instanceof CredentialFilesError ? e : new CredentialFilesError("The sign-in files could not be put in place."); }
  return { home, release };
}
