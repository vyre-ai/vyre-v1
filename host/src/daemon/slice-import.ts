// Imports a module and what it imports a piece at a time, with a turn of the event loop between the pieces (27 Nov 2026, the real-server guard). One `import "./daemon.ts"` links and evaluates a graph of
// about 2,000 files in one stretch: 1.9 s without the compile cache, 0.5 s with it. Here the same graph is loaded bottom up: each file's own imports first (down to `depth` levels), one at a time, then
// the file; the loader keeps every module it has evaluated, so the final import finds them all loaded and only links. Nothing is evaluated that the plain import would not have evaluated, in the same
// order within each file. It reads each file once to find its relative imports (a regular expression over the `import ... from "./x"` lines: a miss only means that piece is loaded with its parent).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const IMPORT =
  /^\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+["'](\.{1,2}\/[^"']+\.(?:ts|js|mjs))["']|^\s*import\s+["'](\.{1,2}\/[^"']+\.(?:ts|js|mjs))["']/gm;
/** VYRE_SLICE_TRACE=1 writes the files whose own piece took 40 ms or more (to say which piece of the graph is the long one). */
const TRACE = process.env["VYRE_SLICE_TRACE"] === "1";
const turn = (): Promise<void> => new Promise((r) => setImmediate(r));

/** The relative files `file` imports (not type-only imports), as absolute paths. */
function importsOf(file: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT)) {
    const rel = m[1] ?? m[2];
    if (rel) out.push(path.resolve(path.dirname(file), rel));
  }
  return out;
}

/** Load `entry` (a file URL) bottom up in pieces, `depth` levels of its imports first, one import per turn of the loop. */
/** The files already loaded (or asked for) by an earlier call: the loader asks for one module after another, and their graphs share most of their files. */
const done = new Set<string>();

export async function sliceImport(entry: URL, depth = 3): Promise<void> {
  const load = async (file: string, levels: number): Promise<void> => {
    if (done.has(file)) return;
    done.add(file);
    if (levels > 0) for (const dep of importsOf(file)) await load(dep, levels - 1);
    const t0 = performance.now();
    try {
      await import(pathToFileURL(file).href);
      if (TRACE && performance.now() - t0 >= 40)
        process.stderr.write(
          `slice-import: ${Math.round(performance.now() - t0)} ms ${path.relative(process.cwd(), file)}\n`,
        );
    } catch {
      /* a failure belongs to the plain import that follows, which reports it as it always did */
    }
    await turn();
  };
  await load(fileURLToPath(entry), depth);
}
