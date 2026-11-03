// Sign-in files for a CLI engine that signs in with files (Codex's auth.json, Grok's own). The Vault item holds them as one secret field, `credentials`: a JSON map of path, relative to the engine's home,
// to the text of the file. The fill puts that map in the process environment under VYRE_CRED_FILES; the launcher takes it out of the environment before the engine starts, writes the files with mode 0600
// into the engine's own home (the person's scratch folder, the one place besides the work folder the sandbox lets it write), and removes them when the process ends. They are never in a log, an argv or an answer.
// A CLI that refreshes its token rewrites these files, and the refresh token the Vault held is then used up. So before they are removed they are read back (`changed`) and handed to the host to save
// (session.ts spawnCli). Two turns of one person share the home: a file another live engine still runs on is left in place when the first one ends, and a newer sign-in of the same account already
// on disk (another turn refreshed it, or a daemon that died mid-turn left it) is kept rather than overwritten with the older one from the Vault.
import fs from "node:fs";
import path from "node:path";
import { scratchFolder, workParts } from "./sandbox.ts";
import { compareFresh, providerOfFiles, readSignin } from "../../host/src/seams/signin-refresh.ts";

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
  const where = workParts(dataDir, cwd);
  if (where === null) throw new CredentialFilesError("The engine is not in one of the Space's work folders.");
  const home = path.join(scratchFolder(dataDir, where.person), "home");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

export interface Placed {
  home: string;
  /** The files as the engine left them, when any differs from what was filled (a file that is gone reads as null); null when nothing changed. Read without following a link. */
  changed(): Record<string, string | null> | null;
  /** Overwrite each file with zeros and remove it, unless another live engine still holds it. Safe to call twice. */
  release(): void;
}

/** Placed files by absolute path, and how many live engines hold each: the first to end must not remove a file another still runs on. */
const holders = new Map<string, number>();

/** A regular file's text, never through a link and never larger than a sign-in file may be; null for anything else or nothing. */
function readPlain(p: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return fs.readFileSync(fd, "utf8");
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Overwrite with zeros and remove, but only a regular file: a link left in its place is removed, never followed (the daemon runs outside the sandbox). */
function wipe(p: string): void {
  try {
    const st = fs.lstatSync(p);
    if (st.isFile()) {
      const fd = fs.openSync(p, fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try { fs.writeSync(fd, Buffer.alloc(st.size)); } finally { fs.closeSync(fd); }
    }
  } catch { /* already gone */ }
  try { fs.unlinkSync(p); } catch { /* already gone */ }
}

/** The files already in the home, when they are a sign-in of the same account as `files` and newer by its own clock: then they are kept. Null otherwise. */
function newerOnDisk(home: string, files: Readonly<Record<string, string>>): Record<string, string> | null {
  const disk: Record<string, string> = {};
  for (const rel of Object.keys(files)) { const t = readPlain(path.join(home, rel)); if (t === null) return null; disk[rel] = t; }
  const provider = providerOfFiles(files);
  const want = readSignin(provider, files), have = readSignin(provider, disk);
  if (!want.ok || !have.ok || want.identity !== have.identity) return null;
  return compareFresh(have.fresh, want.fresh) > 0 ? disk : null;
}

/** Write the files, 0600, in folders 0700 (or keep a newer sign-in of the same account already there). `release` overwrites each with zeros and removes it; safe to call twice. */
export function placeCredentialFiles(dataDir: string, cwd: string, json: string): Placed {
  const files = parseCredentialFiles(json);
  const home = engineHome(dataDir, cwd);
  const written: string[] = [];
  const release = (): void => {
    for (const p of written.splice(0)) {
      const left = (holders.get(p) ?? 1) - 1;
      if (left > 0) { holders.set(p, left); continue; }
      holders.delete(p);
      wipe(p);
    }
  };
  const changed = (): Record<string, string | null> | null => {
    const now: Record<string, string | null> = {};
    let differs = false;
    for (const [rel, text] of Object.entries(files)) { const t = readPlain(path.join(home, rel)); now[rel] = t; if (t !== text) differs = true; }
    return differs ? now : null;
  };
  try {
    const keep = newerOnDisk(home, files);
    for (const [rel, text] of Object.entries(files)) {
      const p = path.join(home, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
      if (keep) {
        const fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        try { fs.fchmodSync(fd, 0o600); } finally { fs.closeSync(fd); }
      } else {
        // a link left where the file goes is removed, never followed
        try { fs.unlinkSync(p); } catch { /* nothing there */ }
        fs.writeFileSync(p, text, { mode: 0o600, flag: "wx" });
        fs.chmodSync(p, 0o600);
      }
      holders.set(p, (holders.get(p) ?? 0) + 1);
      written.push(p);
    }
  } catch (e) { release(); throw e instanceof CredentialFilesError ? e : new CredentialFilesError("The sign-in files could not be put in place."); }
  return { home, changed, release };
}
