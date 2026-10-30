// The agents module's host seam for plugins (CHAT-DESIGN ruling 6): the module exports `hostSeams = { setPluginsHost }` and the daemon hands it a way to read a marketplace or a plugin as a map of
// text files. The module never touches the network or the disk; this is the only place a plugin is fetched. Fetching is only reading: a clone runs no hooks (core.hooksPath is off), follows no
// submodule and no symlink, and keeps text only. Nothing from a plugin is executed here. Its code runs later, and only in the agent's sandbox.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TreeSource { kind: "git" | "local"; url?: string; path?: string; ref?: string; subdir?: string }
export interface TreeResult { files: Record<string, string>; revision: string; skipped: string[] }
export interface PluginsHostSeam { fetchTree(src: TreeSource): Promise<TreeResult> }

export const LIMITS = { files: 2000, fileBytes: 300_000, totalBytes: 6_000_000 } as const;
const SKIP_DIRS = new Set([".git", "node_modules", ".DS_Store"]);

/** Every text file under `dir` as a path relative to it. Symlinks, binary files and files over the limit are skipped and named; the walk stops at the size limits. */
export function readTree(dir: string, base = ""): TreeResult {
  const root = fs.realpathSync(dir);
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let total = 0;
  const walk = (rel: string): void => {
    for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
      const r = rel === "" ? name : `${rel}/${name}`;
      if (SKIP_DIRS.has(name)) continue;
      const abs = path.join(root, r);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) { skipped.push(`${r} (a link)`); continue; }
      if (st.isDirectory()) { walk(r); continue; }
      if (!st.isFile()) continue;
      if (Object.keys(files).length >= LIMITS.files) { skipped.push(`${r} (too many files)`); continue; }
      if (st.size > LIMITS.fileBytes) { skipped.push(`${r} (over ${LIMITS.fileBytes / 1000} KB)`); continue; }
      const bytes = fs.readFileSync(abs);
      if (bytes.includes(0)) { skipped.push(`${r} (binary)`); continue; }
      const text = bytes.toString("utf8");
      if (Buffer.byteLength(text, "utf8") !== bytes.length) { skipped.push(`${r} (not UTF-8)`); continue; }
      if (total + bytes.length > LIMITS.totalBytes) { skipped.push(`${r} (over the total size)`); continue; }
      total += bytes.length;
      files[base === "" ? r : `${base}/${r}`] = text;
    }
  };
  walk("");
  return { files, revision: "", skipped };
}

const run = (file: string, args: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((ok, bad) => {
    execFile(file, args, { cwd, timeout: timeoutMs, env, maxBuffer: 2_000_000 }, (err, stdout, stderr) => {
      if (err) bad(new Error(String(stderr || err.message).trim().split("\n").slice(-3).join(" ").slice(0, 300)));
      else ok(String(stdout));
    });
  });

export interface PluginsHostDeps {
  /** Null when the address may be fetched, else why not (the network guard). Without it only https addresses are checked for a literal private address. */
  refuse?: (url: string) => Promise<string | null>;
  /** The git program. Default: git. */
  git?: string;
  timeoutMs?: number;
}

const literalPrivate = (host: string): boolean => /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/i.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

export function createPluginsHost(d: PluginsHostDeps = {}): PluginsHostSeam {
  const git = d.git ?? "git";
  const timeout = d.timeoutMs ?? 90_000;
  return {
    async fetchTree(src) {
      const sub = src.subdir ? src.subdir.replace(/^\/+|\/+$/g, "") : "";
      if (sub.split("/").includes("..")) throw new Error("The folder inside the repository is not allowed.");
      if (src.kind === "local") {
        if (!src.path) throw new Error("Give the folder.");
        const dir = src.path.startsWith("~/") ? path.join(os.homedir(), src.path.slice(2)) : path.resolve(src.path);
        if (!fs.statSync(dir).isDirectory()) throw new Error("That is not a folder.");
        return readTree(sub === "" ? dir : path.join(dir, sub));
      }
      const url = src.url ?? "";
      let u: URL;
      try { u = new URL(url); } catch { throw new Error("That is not an address."); }
      if (u.protocol !== "https:") throw new Error("A marketplace is fetched over https.");
      if (u.username || u.password) throw new Error("Do not put a password in the address.");
      if (literalPrivate(u.hostname)) throw new Error("That address is on a private network.");
      const why = d.refuse ? await d.refuse(url) : null;
      if (why) throw new Error(why);
      if (src.ref && !/^[A-Za-z0-9._/-]{1,100}$/.test(src.ref)) throw new Error("That branch or tag name is not allowed.");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-plugin-"));
      const env: NodeJS.ProcessEnv = { PATH: process.env["PATH"] ?? "", HOME: tmp, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_ALLOW_PROTOCOL: "https" };
      try {
        const dest = path.join(tmp, "repo");
        await run(git, ["-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "clone", "--depth", "1", "--no-tags", "--single-branch", "--no-recurse-submodules", ...(src.ref ? ["--branch", src.ref] : []), "--", url, dest], tmp, timeout, env);
        const revision = (await run(git, ["rev-parse", "HEAD"], dest, 10_000, env)).trim();
        const tree = readTree(sub === "" ? dest : path.join(dest, sub));
        return { ...tree, revision };
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    },
  };
}
