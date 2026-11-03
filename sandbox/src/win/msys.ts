// Git Bash for an engine at Low integrity (option E). Git for Windows' bash is MSYS2, whose runtime keeps its shared state in a kernel object folder named after where it is installed
// (\BaseNamedObjects\msys-2.0S5-<key>). When the person has any of Git's MSYS programs running (a Git Bash window, a hook, ssh), that folder belongs to a normal-integrity process and a Low engine
// cannot open it: its Bash tool dies with "NtCreateDirectoryObject ... 0xC0000022" (the windows-latest proof, run 41559002979). A private copy of the runtime has its own key, so the engine's MSYS
// never meets the person's. The copy is MSYS's own programs (usr\bin) and its settings (etc); git itself stays the person's (mingw64), found on PATH as before.
import fs from "node:fs";
import path from "node:path";

/** Where Git for Windows is: from git.exe on PATH (<root>\cmd or <root>\mingw64\bin), else the usual folder. Null when there is no MSYS runtime. */
export function gitRoot(env: Readonly<Record<string, string | undefined>> = process.env, exists: (p: string) => boolean = fs.existsSync): string | null {
  const roots: string[] = [];
  for (const dir of (env["PATH"] ?? env["Path"] ?? "").split(";")) {
    if (dir === "" || !exists(path.win32.join(dir, "git.exe"))) continue;
    const d = dir.replace(/[\\/]+$/, "");
    const base = path.win32.basename(d).toLowerCase();
    if (base === "cmd") roots.push(path.win32.dirname(d));
    else if (base === "bin" && path.win32.basename(path.win32.dirname(d)).toLowerCase() === "mingw64") roots.push(path.win32.dirname(path.win32.dirname(d)));
  }
  roots.push(path.win32.join(env["ProgramFiles"] ?? "C:\\Program Files", "Git"));
  return roots.find((r) => exists(path.win32.join(r, "usr", "bin", "msys-2.0.dll")) && exists(path.win32.join(r, "usr", "bin", "bash.exe"))) ?? null;
}

/**
 * The engine's own copy of Git's MSYS runtime, made once per Git version (its msys-2.0.dll size and time) under `dest`. Answers the copy's bash.exe, or null when the computer has no Git Bash
 * (then Claude Code uses its PowerShell tool).
 */
export async function privateBash(dest: string, env: Readonly<Record<string, string | undefined>> = process.env): Promise<string | null> {
  const root = gitRoot(env);
  if (root === null) return null;
  const dll = fs.statSync(path.win32.join(root, "usr", "bin", "msys-2.0.dll"));
  const copy = path.win32.join(dest, `msys-${dll.size.toString(16)}-${Math.floor(dll.mtimeMs).toString(16)}`);
  const bash = path.win32.join(copy, "usr", "bin", "bash.exe");
  if (fs.existsSync(path.win32.join(copy, ".done"))) return bash;
  const part = `${copy}.part`;
  await fs.promises.rm(part, { recursive: true, force: true });
  await fs.promises.cp(path.win32.join(root, "usr", "bin"), path.win32.join(part, "usr", "bin"), { recursive: true });
  await fs.promises.cp(path.win32.join(root, "etc"), path.win32.join(part, "etc"), { recursive: true });
  for (const d of ["tmp", "dev"]) await fs.promises.mkdir(path.win32.join(part, d), { recursive: true });
  await fs.promises.writeFile(path.win32.join(part, ".done"), root);
  await fs.promises.rm(copy, { recursive: true, force: true });
  await fs.promises.rename(part, copy);
  return bash;
}
