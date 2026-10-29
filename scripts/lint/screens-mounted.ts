// screens-mounted: every screen of the registry resolves to a mounted component, every probe screen exists, every `rt.open({ screen })` target reaches one, and no tested component is
// mounted nowhere (P-CI_70). A screen that is in the contract but drawn by no place, and a component that has tests but no caller, are how the app ends up with pieces nobody can reach.
//   node scripts/lint/screens-mounted.ts [--enforce] [--json]      REPORT MODE by default: prints every gap and exits 0. --enforce (or ENFORCE below) exits 1 on a gap that is not allowlisted.
// The allowlist (mounted-allowlist.json) holds the gaps accepted today; it only shrinks as the place packets land, and a stale entry (a gap that no longer exists) is reported too.
//
// What "mounted" means here, kept deliberately simple so it can be read at a glance:
//   screen     its id appears as a string literal in product code under apps/app/src (a place component, a provider; not a test, sample or fixture). A `rt.open({ screen: "x" })` call site does not
//              count: that is a caller reaching for the screen, not the screen being drawn.
//   open       every `screen:` literal passed to `open(` names a registry screen, whose place is one of the shell's places (or `shell`), and is mounted.
//   component  a directory under ui/src or apps/app/src/places/<place>/ that has a test file and whose code is imported by no non-test file outside the directory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Flip to true once P-L9_25 and the place packets have merged and the allowlist is empty. */
export const ENFORCE = false;

export interface MountedInput {
  /** registry screens: id to place */
  screens: Record<string, string>;
  probeScreens: readonly string[];
  /** repo-relative path to source, every .ts and .tsx under ui/src and apps/app/src */
  files: Readonly<Record<string, string>>;
  /** the `screens` field of every shell place (apps/app/src/shell/places.ts), plus "shell" */
  shellPlaces: readonly string[];
}

export interface Gaps {
  unmountedScreens: string[];
  badProbeScreens: string[];
  unmountedOpenTargets: string[];
  unmountedComponents: string[];
}

export interface Allowlist { screens: string[]; probeScreens: string[]; openTargets: string[]; components: string[] }

const isTest = (f: string): boolean => /\.test\.(?:tsx?|mjs)$/.test(f) || /(?:^|\/)tests?(?:-runtime)?\//.test(f) || /(?:^|\/)__\w+__\//.test(f) || /\.perf\.test\./.test(f);
const isSample = (f: string): boolean => /(?:^|\/)(?:sample|fixtures?|mocks?)(?:\.|\/)/.test(f) || /(?:^|\/)sample[\w-]*\.tsx?$/.test(f);
/** Product code: what ships, not what proves it or stands in for data. */
export const isProduct = (f: string): boolean => /\.(?:ts|tsx)$/.test(f) && !isTest(f) && !isSample(f);

const OPEN_CALL = /\bopen\(\s*\{\s*screen:\s*(["'`])([\w.-]+)\1/g;

/** Screen ids that product code under apps/app/src draws (see the header), by id to the first file that does. */
export function mountedScreens(files: Readonly<Record<string, string>>, ids: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  const want = new Set(ids);
  for (const [file, source] of Object.entries(files)) {
    if (!file.startsWith("apps/app/src/") || !isProduct(file)) continue;
    const text = source.replace(OPEN_CALL, "open({ screen: ");
    for (const m of text.matchAll(/(["'`])([a-z][\w-]*\.[\w.-]+)\1/g)) {
      const id = m[2] as string;
      if (want.has(id) && !found.has(id)) found.set(id, file);
    }
  }
  return found;
}

export function openTargets(files: Readonly<Record<string, string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [file, source] of Object.entries(files)) {
    if (!file.startsWith("apps/app/src/") || !isProduct(file)) continue;
    for (const m of source.matchAll(OPEN_CALL)) if (!out.has(m[2] as string)) out.set(m[2] as string, file);
  }
  return out;
}

/** The component directories: ui/src/<Name> and apps/app/src/places/<place>/<name>, each with at least one test file. */
export function componentDirs(files: Readonly<Record<string, string>>): string[] {
  const dirs = new Set<string>();
  for (const file of Object.keys(files)) {
    if (!/\.test\.(?:tsx?|mjs)$/.test(file)) continue;
    const ui = /^(ui\/src\/(?!kit\/|blocks\/|theme\/|tokens\/|stream\/)[A-Za-z][\w-]*)\//.exec(file);
    const place = /^(apps\/app\/src\/places\/[\w-]+\/[\w-]+)\//.exec(file);
    const dir = ui?.[1] ?? place?.[1];
    if (dir) dirs.add(dir);
  }
  // a directory that only holds a test is not a component
  return [...dirs].filter((d) => Object.keys(files).some((f) => f.startsWith(`${d}/`) && isProduct(f))).sort();
}

function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
}

export function unmountedComponents(files: Readonly<Record<string, string>>): string[] {
  const dirs = componentDirs(files);
  const imported = new Set<string>();
  for (const [file, source] of Object.entries(files)) {
    if (!isProduct(file)) continue;
    for (const m of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) {
      const target = resolveSpec(file, m[1] as string);
      if (!target) continue;
      for (const d of dirs) if (target === d || target.startsWith(`${d}/`)) { if (!file.startsWith(`${d}/`)) imported.add(d); }
    }
  }
  return dirs.filter((d) => !imported.has(d));
}

export function checkMounted(input: MountedInput): Gaps {
  const ids = Object.keys(input.screens);
  const drawn = mountedScreens(input.files, ids);
  const opens = openTargets(input.files);
  const places = new Set(input.shellPlaces);
  const exists = new Set(ids);
  return {
    unmountedScreens: ids.filter((id) => !drawn.has(id)).sort(),
    badProbeScreens: [...new Set(input.probeScreens)].filter((id) => !exists.has(id)).sort(),
    unmountedOpenTargets: [...opens.keys()].filter((id) => !exists.has(id) || !places.has(input.screens[id] as string) || !drawn.has(id)).sort(),
    unmountedComponents: unmountedComponents(input.files),
  };
}

const KEYS = { unmountedScreens: "screens", badProbeScreens: "probeScreens", unmountedOpenTargets: "openTargets", unmountedComponents: "components" } as const;

/** Gaps the allowlist does not accept, and allowlist entries that no longer name a gap. */
export function judge(gaps: Gaps, allow: Allowlist): { fresh: string[]; stale: string[] } {
  const fresh: string[] = [], stale: string[] = [];
  for (const [gapKey, listKey] of Object.entries(KEYS) as Array<[keyof Gaps, keyof Allowlist]>) {
    const accepted = new Set(allow[listKey]);
    for (const g of gaps[gapKey]) if (!accepted.has(g)) fresh.push(`${listKey}: ${g}`);
    for (const a of allow[listKey]) if (!gaps[gapKey].includes(a)) stale.push(`${listKey}: ${a}`);
  }
  return { fresh, stale };
}

// ---- reading the repo

function walk(root: string, rel: string, out: Record<string, string>): void {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  for (const name of fs.readdirSync(abs)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const r = `${rel}/${name}`;
    const stat = fs.statSync(path.join(root, r));
    if (stat.isDirectory()) walk(root, r, out);
    else if (/\.(?:ts|tsx|mjs)$/.test(name)) out[r] = fs.readFileSync(path.join(root, r), "utf8");
  }
}

export async function readRepo(root: string): Promise<MountedInput> {
  const files: Record<string, string> = {};
  walk(root, "ui/src", files);
  walk(root, "apps/app/src", files);
  const { screens } = (await import(pathToFileURL(path.join(root, "generated/screens.ts")).href)) as { screens: Array<{ id: string; place: string }> };
  const probes = JSON.parse(fs.readFileSync(path.join(root, "generated/probes.json"), "utf8")) as { probes: Array<{ screen?: string }> };
  const placesSrc = files["apps/app/src/shell/places.ts"] ?? "";
  const shellPlaces = ["shell", ...[...placesSrc.matchAll(/screens:\s*"([\w-]+)"/g)].map((m) => m[1] as string)];
  return {
    screens: Object.fromEntries(screens.map((s) => [s.id, s.place])),
    probeScreens: probes.probes.map((p) => p.screen).filter((s): s is string => typeof s === "string"),
    files, shellPlaces,
  };
}

export function readAllowlist(root: string): Allowlist {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "scripts/lint/mounted-allowlist.json"), "utf8")) as Partial<Allowlist>;
  return { screens: raw.screens ?? [], probeScreens: raw.probeScreens ?? [], openTargets: raw.openTargets ?? [], components: raw.components ?? [] };
}

/** The report, one line per gap, for the CI log and the lead's list. */
export function report(gaps: Gaps, allow: Allowlist): string[] {
  const { fresh, stale } = judge(gaps, allow);
  const lines = [`screens-mounted: ${gaps.unmountedScreens.length} unmounted screens, ${gaps.badProbeScreens.length} probe screens missing, ${gaps.unmountedOpenTargets.length} open targets unreached, ${gaps.unmountedComponents.length} unmounted components`];
  for (const [gapKey, listKey] of Object.entries(KEYS) as Array<[keyof Gaps, keyof Allowlist]>) for (const g of gaps[gapKey]) lines.push(`GAP ${listKey}: ${g}${allow[listKey].includes(g) ? " (allowlisted)" : ""}`);
  for (const s of stale) lines.push(`STALE ${s}`);
  lines.push(`screens-mounted: ${fresh.length} not allowlisted, ${stale.length} stale`);
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const gaps = checkMounted(await readRepo(repo));
  const allow = readAllowlist(repo);
  if (process.argv.includes("--json")) console.log(JSON.stringify(gaps, null, 2));
  else for (const l of report(gaps, allow)) console.log(l);
  const { fresh } = judge(gaps, allow);
  if ((ENFORCE || process.argv.includes("--enforce")) && fresh.length > 0) process.exit(1);
}
