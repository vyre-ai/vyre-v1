// The Files tools of an agent computer (modules/computers/handlers/tools/files.ts): list, read, write, move and delete in the agent's Files folder, which is bound at ~/Vyre. One copy: what is
// written here is what the Files module shows. Paths are checked again here, at the folder: relative, no "..", and nothing that resolves outside the folder through a link.
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile, appendFile, lstat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { badInput, notFound } from "./errors.ts";

const MAX_READ = 5_000_000;

export interface FileTools { run(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> }

export function fileTools(root: string): FileTools {
  const rootReal = realpath(root);

  /** The absolute path for a relative one, with every existing part resolved: a link cannot lead out of the folder. */
  const inside = async (rel: unknown, o: { allowRoot?: boolean } = {}): Promise<string> => {
    if (typeof rel !== "string") throw badInput("Give a path in the Files folder.");
    if (rel.includes("\0") || rel.includes("\\") || rel.startsWith("/") || rel.startsWith("~")) throw badInput("That is not a path in the Files folder.");
    const parts = rel.split("/").filter((p) => p !== "" && p !== ".");
    if (parts.includes("..")) throw badInput("A path cannot leave the Files folder.");
    if (parts.length === 0 && o.allowRoot !== true) throw badInput("Name a file or a folder, not the whole Files folder.");
    const base = await rootReal;
    const full = resolve(base, ...parts);
    // Resolve the deepest part that exists and make sure it is still inside.
    let probe = full;
    for (;;) {
      try { const real = await realpath(probe); if (real !== base && !real.startsWith(base + sep)) throw badInput("That path leads out of the Files folder."); break; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") { const up = dirname(probe); if (up === probe) break; probe = up; continue; } throw e; }
    }
    return full;
  };

  return {
    async run(name, args) {
      switch (name) {
        case "computer_files_list": {
          const dir = await inside(args["path"] ?? "", { allowRoot: true });
          let names: string[];
          try { names = await readdir(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") throw notFound("There is no such folder."); throw e; }
          const entries = [];
          for (const n of names.sort().slice(0, 2000)) {
            const st = await lstat(join(dir, n)).catch(() => null);
            if (!st) continue;
            entries.push({ name: n, kind: st.isDirectory() ? "folder" : "file", ...(st.isFile() ? { size: st.size } : {}), modifiedAt: Math.round(st.mtimeMs) });
          }
          return { entries };
        }
        case "computer_files_read": {
          const file = await inside(args["path"]);
          const max = Math.min(typeof args["maxBytes"] === "number" ? args["maxBytes"] : 1_000_000, MAX_READ);
          const st = await stat(file).catch(() => null);
          if (!st || !st.isFile()) throw notFound("There is no such file.");
          const bytes = await readFile(file);
          const part = bytes.subarray(0, max);
          try { return { content: new TextDecoder("utf-8", { fatal: true }).decode(part), encoding: "utf8", truncated: bytes.length > max }; }
          catch { return { content: part.toString("base64"), encoding: "base64", truncated: bytes.length > max }; }
        }
        case "computer_files_write": {
          const file = await inside(args["path"]);
          const mode = String(args["mode"] ?? "overwrite");
          const data = args["encoding"] === "base64" ? Buffer.from(String(args["content"] ?? ""), "base64") : Buffer.from(String(args["content"] ?? ""), "utf8");
          const exists = await stat(file).then(() => true, () => false);
          if (mode === "create" && exists) throw badInput("That file already exists.");
          if (mode !== "create" && mode !== "overwrite" && mode !== "append") throw badInput(`I cannot write in ${mode} mode.`);
          await mkdir(dirname(file), { recursive: true });
          if (mode === "append") await appendFile(file, data); else await writeFile(file, data);
          return { ok: true };
        }
        case "computer_files_move": {
          const from = await inside(args["from"]);
          const to = await inside(args["to"]);
          if (!(await stat(from).then(() => true, () => false))) throw notFound("There is nothing to move there.");
          if (await stat(to).then(() => true, () => false)) throw badInput("Something is already at the new path.");
          await mkdir(dirname(to), { recursive: true });
          await rename(from, to);
          return { ok: true };
        }
        case "computer_files_delete": {
          const file = await inside(args["path"]);
          if (!(await lstat(file).then(() => true, () => false))) throw notFound("There is nothing to delete there.");
          await rm(file, { recursive: true, force: false });
          return { ok: true };
        }
        default:
          throw badInput(`${name} is not a files tool.`);
      }
    },
  };
}
