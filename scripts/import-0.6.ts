// F12 mechanical import (ARCH 11, 12.2 F12): copies the KEEP and CLEAN rows of the section 11 reuse table from the 0.6.9
// tree into their v1 destinations with an origin header, one commit per lane directory. No cleaning, no ports.
// REWRITE, DROP and idea-only rows are logged, never copied. Existing destination files are never overwritten.
//   node scripts/import-0.6.ts --arch <ARCHITECTURE-V1.md> --src <0.6.9 tree> [--apply] [--commit] [--log file]
// Dry run is the default. Exit 1 when a copy row finds no source path.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type Verdict = "copy" | "rewrite" | "drop" | "idea";
export type Row = { source: string; verdict: Verdict; verdictText: string; dest: string; notes: string };
export type Planned = { row: Row; sources: string[]; dests: string[] };
export type LogLine = { kind: "imported" | "headerless" | "exists" | "missing" | "rewrite" | "drop" | "idea" | "nodest"; row: number; text: string };

const BACKTICK = /`([^`]+)`/g;
const HEADER_EXT: Record<string, string> = { ".js": "//", ".mjs": "//", ".cjs": "//", ".ts": "//", ".tsx": "//", ".jsx": "//", ".mts": "//", ".sh": "#", ".py": "#" };
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

export function classify(text: string): Verdict {
  const t = text.trim();
  if (/^DROP/i.test(t)) return "drop";
  if (/^REWRITE/i.test(t)) return "rewrite";
  if (/^KEEP idea/i.test(t) || /port selectively/i.test(t)) return "idea";
  if (/^(KEEP|CLEAN)/i.test(t)) return "copy";
  return "idea";
}

/** Splits a table line on pipes that sit outside backticks. */
export function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "", tick = false;
  for (const ch of line.replace(/^\|/, "").replace(/\|\s*$/, "")) {
    if (ch === "`") tick = !tick;
    if (ch === "|" && !tick) { cells.push(cur.trim()); cur = ""; } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** Rows of the markdown table under the "Reuse plan" heading. */
export function parseRows(md: string): Row[] {
  const start = md.search(/^##\s+\d+\.\s+Reuse plan/m);
  if (start < 0) throw new Error("no 'Reuse plan' section found");
  const rest = md.slice(start).split("\n").slice(1);
  const rows: Row[] = [];
  for (const line of rest) {
    if (/^##\s/.test(line)) break;
    if (!line.startsWith("|") || /^\|[\s|:-]+\|?$/.test(line) || /^\|\s*0\.6 path/.test(line)) continue;
    const cells = splitCells(line);
    if (cells.length < 4) continue;
    rows.push({ source: cells[0], verdictText: cells[1], verdict: classify(cells[1]), dest: cells[2], notes: cells.slice(3).join(" | ") });
  }
  return rows;
}

/** Source paths named in the first cell. Bare file names with an extension resolve against the previous path's directory. */
export function sourcePaths(cell: string): string[] {
  const out: string[] = [];
  let dir = "";
  for (const m of cell.matchAll(BACKTICK)) {
    const t = m[1].trim();
    if (!t || t.startsWith(".") || /[(){}\s]/.test(t)) continue;
    if (t.includes("/")) {
      out.push(t.replace(/\/+$/, ""));
      // Siblings named bare resolve against a file's directory; a directory already covers its own files.
      dir = /\.[a-z0-9]+$/i.test(t) ? path.posix.dirname(t) : "";
    } else if (/\.[a-z0-9]+$/i.test(t) && dir) out.push(path.posix.join(dir, t));
  }
  return [...new Set(out)];
}

/** Destination directories or files named in the third cell. `a/b|c|d` expands to siblings; trailing `/*` is dropped. */
export function destPaths(cell: string): string[] {
  const out: string[] = [];
  for (const m of cell.matchAll(BACKTICK)) {
    let t = m[1].trim().replace(/\/\*+$/, "").replace(/\/+$/, "");
    if (!t || /[(){}\s]/.test(t)) continue;
    if (!t.includes("/") && !/\.[a-z0-9]+$/i.test(t) && !/^[a-z-]+$/.test(t)) continue;
    if (t.includes("|")) {
      const slash = t.lastIndexOf("/", t.indexOf("|"));
      const base = slash >= 0 ? t.slice(0, slash + 1) : "";
      for (const part of t.slice(slash + 1).split("|")) out.push(base + part);
    } else out.push(t);
  }
  return [...new Set(out)];
}

export function plan(rows: Row[]): Planned[] {
  return rows.map((row) => ({ row, sources: sourcePaths(row.source), dests: destPaths(row.dest) }));
}

type Lane = { id: string; owns: string[] };
/** Lane whose longest owns prefix matches the destination; "unowned" when none does. */
export function laneOf(dest: string, lanes: Lane[]): string {
  let best = "unowned", len = -1;
  const d = dest.replace(/\/+$/, "") + "/";
  for (const l of lanes) for (const o of l.owns) if (d.startsWith(o.endsWith("/") ? o : o + "/") && o.length > len) { best = l.id; len = o.length; }
  return best;
}

export function headerFor(file: string, srcRel: string, sha: string): string | null {
  const lead = HEADER_EXT[path.extname(file)];
  return lead ? `${lead} from vyre 0.6.9 ${srcRel}@${sha}` : null;
}

function* walk(abs: string): Generator<string> {
  const st = fs.statSync(abs);
  if (st.isFile()) return void (yield abs);
  for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
    yield* walk(path.join(abs, e.name));
  }
}

export type RunOpts = { src: string; out: string; sha: string; apply: boolean; lanes: Lane[] };
export type RunResult = { log: LogLine[]; byLane: Map<string, string[]> };

/** Runs the plan. Copies only `copy` rows, to the first destination named. Returns the log and the files written per lane. */
export function run(planned: Planned[], o: RunOpts): RunResult {
  const log: LogLine[] = [];
  const byLane = new Map<string, string[]>();
  planned.forEach((p, i) => {
    const n = i + 1;
    const name = p.row.source.replace(/\s+/g, " ").slice(0, 70);
    if (p.row.verdict !== "copy") return void log.push({ kind: p.row.verdict as "rewrite" | "drop" | "idea", row: n, text: `${p.row.verdictText}: ${name}` });
    const dest = p.dests[0];
    if (!dest) return void log.push({ kind: "nodest", row: n, text: `no destination folder named: ${name}` });
    const lane = laneOf(dest, o.lanes);
    for (const s of p.sources) {
      const abs = path.join(o.src, s);
      if (!fs.existsSync(abs)) { log.push({ kind: "missing", row: n, text: `${s} not found in the source tree` }); continue; }
      const isFile = fs.statSync(abs).isFile();
      for (const f of walk(abs)) {
        const rel = path.relative(o.src, f).split(path.sep).join("/");
        const destRel = isFile ? (/\.[a-z0-9]+$/i.test(dest) ? dest : path.posix.join(dest, path.basename(f))) : path.posix.join(dest, path.relative(abs, f).split(path.sep).join("/"));
        const target = path.join(o.out, destRel);
        if (fs.existsSync(target)) { log.push({ kind: "exists", row: n, text: `${destRel} left alone` }); continue; }
        const head = headerFor(f, rel, o.sha);
        if (o.apply) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          if (head) {
            const body = fs.readFileSync(f, "utf8");
            const shebang = body.startsWith("#!") ? body.slice(0, body.indexOf("\n") + 1) : "";
            fs.writeFileSync(target, shebang + head + "\n" + body.slice(shebang.length));
          } else fs.copyFileSync(f, target);
          (byLane.get(lane) ?? byLane.set(lane, []).get(lane)!).push(destRel);
        }
        log.push({ kind: head ? "imported" : "headerless", row: n, text: `${rel} -> ${destRel} [${lane}]` });
      }
    }
  });
  return { log, byLane };
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** One commit per lane directory, so blame stays readable. */
export function commitPerLane(out: string, byLane: Map<string, string[]>): string[] {
  const made: string[] = [];
  for (const [lane, files] of [...byLane].sort()) {
    git(out, ["add", "--", ...files]);
    git(out, ["commit", "-q", "-m", `chore(import): ${lane} sources from vyre 0.6.9 (${files.length} files)`, "--", ...files]);
    made.push(lane);
  }
  return made;
}

export function formatLog(log: LogLine[]): string {
  return log.map((l) => `${l.kind.padEnd(10)} row ${String(l.row).padStart(3)}  ${l.text}`).join("\n");
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const has = (n: string) => process.argv.includes(n);
  const root = path.join(path.dirname(self), "..");
  const archFile = arg("--arch"), src = arg("--src");
  if (!archFile || !src) { console.error("usage: import-0.6.ts --arch <ARCHITECTURE-V1.md> --src <0.6.9 tree> [--apply] [--commit] [--log file]"); process.exit(2); }
  const lanes = JSON.parse(fs.readFileSync(path.join(root, "scripts", "lanes.json"), "utf8")).lanes as Lane[];
  const sha = git(src, ["rev-parse", "--short=9", "HEAD"]);
  const res = run(plan(parseRows(fs.readFileSync(archFile, "utf8"))), { src, out: root, sha, apply: has("--apply"), lanes });
  const text = formatLog(res.log);
  if (arg("--log")) fs.writeFileSync(arg("--log")!, text + "\n");
  console.log(text);
  if (has("--apply") && has("--commit")) console.log("committed lanes: " + commitPerLane(root, res.byLane).join(", "));
  const count = (k: string) => res.log.filter((l) => l.kind === k).length;
  console.log(`import-0.6: ${count("imported") + count("headerless")} files, ${count("rewrite")} rewrite, ${count("drop")} drop, ${count("idea")} idea, ${count("missing")} missing`);
  process.exit(count("missing") || count("nodest") ? 1 : 0);
}
