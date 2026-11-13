// The user inside a bubblewrap sandbox has a name, and no more than that. The sandbox maps the user that runs it in as itself, and with no /etc/passwd entry `whoami` and `id -un` fail and git and ssh
// cannot name their user (13 Nov 2026: "cannot find name for user ID 1000"). Binding the host's /etc/passwd would show the code every account name, full name, home and service account of the machine, so
// the sandbox gets a generated two-user passwd and group instead: `agent` (the user's own uid and gid) and `nobody`.
// The generated files are written ONLY in a directory the sandbox can never reach: one made for this process under the system temp folder (random name, no other user may list it), which no sandbox binds
// (a sandbox's own /tmp is a fresh tmpfs). Writing them into the scratch or wall folder, which the sandbox binds read-write, would let code in the sandbox plant a symlink there that the next spawn's
// write follows (second review, 13 Nov).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SandboxError } from "./types.ts";

export interface Who { uid: number; gid: number }

export const passwdOf = (w: Who): string => `agent:x:${w.uid}:${w.gid}:agent:/home/agent:/bin/sh\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n`;
export const groupOf = (w: Who): string => `agent:x:${w.gid}:\nnogroup:x:65534:\n`;

let privateDir: string | null = null;
/** The process's own folder for these files: made once with a random name; mode 0711 (others may pass through to a file whose name they know, never list it; the files are world-readable anyway); removed at exit. */
function dirOf(): string {
  if (privateDir !== null && fs.existsSync(privateDir)) return privateDir;
  const made = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-identity-"));
  fs.chmodSync(made, 0o711);
  privateDir = made;
  process.once("exit", () => { try { fs.rmSync(made, { recursive: true, force: true }); } catch { /* gone */ } });
  return made;
}

const within = (p: string, parent: string): boolean => p === parent || p.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
const overlaps = (a: string, b: string): boolean => within(a, b) || within(b, a);

/**
 * The bwrap arguments that bind the generated files over /etc/passwd and /etc/group; none when they cannot be written (the sandbox then runs without a name, as it did). `writable` is every path the
 * sandbox binds read-write: if the folder for these files lies inside or contains one (a profile that makes the system temp folder, or a parent of it, writable), code in the sandbox could plant a
 * link there, so that sandbox is refused with a plain error instead.
 */
export function identityBinds(who: Who = { uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000 }, writable: readonly string[] = []): string[] {
  let dir: string;
  try { dir = dirOf(); } catch { return []; }
  const hit = writable.find((w) => overlaps(dir, path.resolve(w)));
  if (hit !== undefined) throw new SandboxError("sandbox.policy", `The sandbox may write to ${hit}, which holds the server's own files for the user's name. Give it a folder of its own to write to instead.`);
  try {
    const files: Array<[string, string, string]> = [["passwd", passwdOf(who), "/etc/passwd"], ["group", groupOf(who), "/etc/group"]];
    const out: string[] = [];
    for (const [name, text, dest] of files) {
      const file = path.join(dir, `${name}-${who.uid}-${who.gid}`);
      let have = "";
      try { have = fs.readFileSync(file, "utf8"); } catch { /* not there yet */ }
      if (have !== text) fs.writeFileSync(file, text, { mode: 0o644 });
      out.push("--ro-bind-try", file, dest);
    }
    return out;
  } catch { return []; }
}
