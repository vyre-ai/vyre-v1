// The user inside a bubblewrap sandbox has a name, and no more than that. The sandbox maps the user that runs it in as itself, and with no /etc/passwd entry `whoami` and `id -un` fail and git and ssh
// cannot name their user (13 Nov 2026: "cannot find name for user ID 1000"). Binding the host's /etc/passwd would show the code every account name, full name, home and service account of the machine, so the
// sandbox gets a generated two-user passwd and group instead: `agent` (the user's own uid and gid) and `nobody`.
import fs from "node:fs";
import path from "node:path";

export interface Who { uid: number; gid: number }

export const passwdOf = (w: Who): string => `agent:x:${w.uid}:${w.gid}:agent:/home/agent:/bin/sh\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n`;
export const groupOf = (w: Who): string => `agent:x:${w.gid}:\nnogroup:x:65534:\n`;

/** The bwrap arguments that bind the generated files over /etc/passwd and /etc/group, written under `base`; none when they cannot be written (the sandbox then runs without a name, as it did). */
export function identityBinds(base: string, who: Who = { uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000 }): string[] {
  try {
    const dir = path.join(base, `.identity-${who.uid}-${who.gid}`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    const files: Array<[string, string, string]> = [["passwd", passwdOf(who), "/etc/passwd"], ["group", groupOf(who), "/etc/group"]];
    const out: string[] = [];
    for (const [name, text, dest] of files) {
      const file = path.join(dir, name);
      let have = "";
      try { have = fs.readFileSync(file, "utf8"); } catch { /* not there yet */ }
      if (have !== text) fs.writeFileSync(file, text, { mode: 0o644 });
      out.push("--ro-bind-try", file, dest);
    }
    return out;
  } catch { return []; }
}
