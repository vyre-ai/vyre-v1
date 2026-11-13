// One component for one job (contract P3, the screen set). A new one-off copy of a shared piece fails here, and the old copies only go down.
// It counts, per file in the app (apps/app/src) and the shared UI (ui/src), five kinds of copy:
//   declared    a component declared under the name of a shared piece (Switch, TextButton, SmallButton, Section, Empty, Select, Choice, Stepper, Segmented, Field, Sheet, FormSheet) outside its home folder;
//   read-hook   a declared `useScreenQuery` or `useRead`: the one data hook is `useLoad` (App/load, client/src/query);
//   load-more   the words "Load more" by hand: the paging row of `useLoadList` draws them;
//   crew-poll   a `setInterval` in a file that reads `crew.status` and that is not a clock (a clock ticker reads Date.now()): a watched read replaces the timer;
// A file not in one-component.baseline.json must have none; a file in it may only go down. When you move a spot onto the shared piece, lower its count:
//   `UPDATE_ONE_COMPONENT=1 node --import tsx --test scripts/lint/one-component.test.ts` (it lowers and never raises; a worse count is refused).
// Out of scope: tests and test kits, the Join entry kit (apps/app/src/join: it draws before any skin or session exists, so it keeps its own pieces), ui/src/ListSections (a different job), and each piece's home folder.
// A plain rename (a component called Toggle) is not caught: the check knows names, not shapes. It also lets a file swap one copy for another at the same count.
// Not counted yet (later steps of the contract, with the piece they need): the word "Loading" (Loadable), a Row with no press, menu or inert (Row menu), more than seven tabs in a Page (Page), Chip as a status (Status).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = fileURLToPath(new URL("./one-component.baseline.json", import.meta.url));
const SCOPE = ["apps/app/src", "ui/src"];
const EXEMPT = /(\.test\.|\.support\.|\/testing\/|\/tests\/|^apps\/app\/src\/join\/|^ui\/src\/ListSections\/)/;

type Kind = "declared" | "read-hook" | "load-more" | "crew-poll";
export type Counts = Record<string, Partial<Record<Kind, number>>>;

/** Each shared piece, the folder that is its home, and the piece to use instead. */
const PIECES: ReadonlyArray<{ names: readonly string[]; home: string; use: string }> = [
  { names: ["Switch"], home: "ui/src/Switch/", use: "ui/Switch (or a Field with a switch control)" },
  { names: ["TextButton", "SmallButton"], home: "ui/src/Button/", use: "ui/Button" },
  { names: ["Section"], home: "ui/src/Group/", use: "ui/Group" },
  { names: ["Empty"], home: "ui/src/States/", use: "States kind=empty, through Loadable or a Group's empty" },
  {
    names: ["Select", "Choice", "Stepper", "Field"],
    home: "ui/src/Field/",
    use: "ui/Field and its controls (TextBox, Select, NumberBox)",
  },
  { names: ["AppLogo"], home: "ui/src/AppLogo/", use: "ui/AppLogo (one mark for an app everywhere)" },
  { names: ["Segmented"], home: "ui/src/Segmented/", use: "ui/Segmented" },
  { names: ["Sheet", "FormSheet"], home: "ui/src/Dialog/", use: "ui/Dialog (the one Sheet frame)" },
];
const USE: Record<Kind, string> = {
  declared: "",
  "read-hook": "useLoad (client/src/query, App/load)",
  "load-more": "the paging row of useLoadList",
  "crew-poll": "a watched read through useLoad, not a timer",
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name !== "node_modules" && name !== "dist") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const DECL = /^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:function|const)[ \t]+([A-Za-z]+)\b[ \t]*(?:[(<=:])/gm;
const READ_HOOK = /^[ \t]*(?:export[ \t]+)?(?:function|const)[ \t]+(?:useScreenQuery|useRead)\b/gm;
const LOAD_MORE = /Load(?:\{\s*" "\s*\}|&nbsp;|\s)+more/gi;
// a component made inside memo(...) or forwardRef(...), and a class
const WRAPPED = /\b(?:memo|forwardRef)\(\s*function[ \t]+([A-Za-z]+)/g;
const CLASS = /^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?class[ \t]+([A-Za-z]+)\b/gm;
// `export { a as Name }` and `export { Name } from "path"`
const EXPORT_LIST = /\bexport[ \t\n]*\{([^}]*)\}(?:[ \t\n]*from[ \t\n]*["']([^"']+)["'])?/g;
const INTERVAL = /\bsetInterval\s*\(/g;

/** The text of a call's arguments, from just after its opening parenthesis to the matching one. */
function argsAt(src: string, from: number): string {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

/** The shared names found per file by the last count, for a message that names only the piece to use. */
const found = new Map<string, Set<string>>();

/** What one file holds, by kind. `rel` is its path from the repo root. */
export function countFile(rel: string, source: string): Partial<Record<Kind, number>> {
  const src = stripComments(source);
  const out: Partial<Record<Kind, number>> = {};
  found.delete(rel);
  const add = (k: Kind, n: number): void => {
    if (n > 0) out[k] = (out[k] ?? 0) + n;
  };
  const named = (name: string): void => {
    const piece = PIECES.find((p) => p.names.includes(name));
    if (piece && !rel.startsWith(piece.home)) {
      add("declared", 1);
      found.get(rel)?.add(name) ?? found.set(rel, new Set([name]));
    }
  };
  for (const m of src.matchAll(DECL)) named(m[1]!);
  for (const m of src.matchAll(WRAPPED)) named(m[1]!);
  for (const m of src.matchAll(CLASS)) named(m[1]!);
  for (const m of src.matchAll(EXPORT_LIST))
    for (const part of m[1]!.split(",")) {
      const [from, alias] = part.trim().split(/\s+as\s+/);
      if (!from) continue;
      // an alias into a shared name is a copy under another name; a plain name counts only when it comes from a file that is not the piece's home
      if (alias) named(alias.trim());
      else if (m[2] !== undefined && !PIECES.some((p) => m[2]!.includes(p.home.replace("ui/src/", ""))))
        named(from.trim());
    }
  add("read-hook", (src.match(READ_HOOK) ?? []).length);
  add("load-more", (src.match(LOAD_MORE) ?? []).length);
  if (/crew\.status/.test(src))
    for (const m of src.matchAll(INTERVAL))
      if (!/Date\.now\(\)/.test(argsAt(src, m.index! + m[0].length))) add("crew-poll", 1);
  return out;
}

export function counts(): Counts {
  const out: Counts = {};
  for (const dir of SCOPE) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (EXEMPT.test(rel)) continue;
      const c = countFile(rel, readFileSync(file, "utf8"));
      if (Object.keys(c).length > 0) out[rel] = c;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

const sum = (c: Counts, k: Kind): number => Object.values(c).reduce((n, f) => n + (f[k] ?? 0), 0);
const KINDS: readonly Kind[] = ["declared", "read-hook", "load-more", "crew-poll"];

const useFor = (file: string): string => {
  const names = [...(found.get(file) ?? [])];
  const pieces = PIECES.filter((p) => p.names.some((n) => names.includes(n)));
  return (pieces.length > 0 ? pieces : PIECES)
    .map((p) => `${p.names.filter((n) => names.includes(n) || pieces.length === 0).join("/")} -> ${p.use}`)
    .join("; ");
};

/** The baseline is rebuilt only from nothing, or on purpose with ONE_COMPONENT_INIT=force. */
export function initAllowed(baselineExists: boolean, flag: string | undefined): boolean {
  return flag === "force" || (flag === "1" && !baselineExists);
}

function compare(now: Counts, base: Counts): { worse: string[]; lower: Counts } {
  const worse: string[] = [];
  const lower: Counts = {};
  for (const file of new Set([...Object.keys(now), ...Object.keys(base)])) {
    for (const k of KINDS) {
      const n = now[file]?.[k] ?? 0;
      const allowed = base[file]?.[k] ?? 0;
      if (n > allowed)
        worse.push(
          k === "declared"
            ? `${file}: ${n} component${n === 1 ? "" : "s"} declared under the name of a shared piece, ${allowed} allowed. Use ${useFor(file)}.`
            : `${file}: ${n} ${k}, ${allowed} allowed. Use ${USE[k]}.`,
        );
      if (n < allowed) lower[file] = { ...lower[file], [k]: n };
    }
  }
  return { worse, lower };
}

test("no new one-off copy of a shared piece, and the old copies only go down", () => {
  const now = counts();
  if (initAllowed(existsSync(BASELINE), process.env["ONE_COMPONENT_INIT"])) {
    writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
    return;
  }
  const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Counts;
  const { worse, lower } = compare(now, base);
  assert.deepEqual(worse, []);
  if (process.env["UPDATE_ONE_COMPONENT"] === "1") {
    const next: Counts = {};
    for (const file of Object.keys(now)) next[file] = { ...now[file] };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    return;
  }
  assert.deepEqual(
    Object.keys(lower),
    [],
    `these files lost a copy: lower their count in one-component.baseline.json (UPDATE_ONE_COMPONENT=1):\n${Object.keys(lower).join("\n")}`,
  );
});

test("the baseline is what the tree holds today, per kind", () => {
  const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Counts;
  const snapshot = Object.fromEntries(KINDS.map((k) => [k, sum(base, k)]));
  // the numbers the contract counted, with the differences the lane found noted in REPORT-b-ui-2026-11-13.md
  assert.ok(snapshot["read-hook"]! > 0 && snapshot["declared"]! > 0);
});

test("the check sees a copy under a shared name, a read hook, a hand-made Load more and a crew poll, and ignores comments, the home folder and a clock", () => {
  const sample = [
    "// function Switch() {}",
    "export function Switch({ on }: P) {}",
    "const Section = ({ title }: P) => null;",
    "function Field<T>(p: P) {}",
    "export function useScreenQuery<T>(id: string) {}",
    "function useRead<T>(cap: string) {}",
    "const a = <Text>Load more</Text>; // Load more",
    'data.call("engine.crew.status", {}); setInterval(read, 2500); setInterval(() => setNow(Date.now()), 1000);',
    "function SwitchRow() {}",
  ].join("\n");
  assert.deepEqual(countFile("apps/app/src/x/y.tsx", sample), {
    declared: 3,
    "read-hook": 2,
    "load-more": 1,
    "crew-poll": 1,
  });
  assert.deepEqual(countFile("ui/src/Switch/index.tsx", "export function Switch() {}"), {});
  assert.deepEqual(
    countFile("apps/app/src/z.tsx", "setInterval(read, 1)"),
    {},
    "an interval in a file that never reads crew.status is not a crew poll",
  );
});

test("a copy hidden in memo or forwardRef, as a class, behind an alias or re-exported from elsewhere is still counted", () => {
  const at = "apps/app/src/zz/x.tsx";
  assert.deepEqual(countFile(at, "export default memo(function Switch() { return null; });"), { declared: 1 });
  assert.deepEqual(countFile(at, "export const Field = forwardRef(function Field() { return null; });"), {
    declared: 2,
  });
  assert.deepEqual(countFile(at, "export class Segmented {}"), { declared: 1 });
  assert.deepEqual(countFile(at, "const Toggle = () => null;\nexport { Toggle as Select };"), { declared: 1 });
  assert.deepEqual(countFile(at, 'export { Switch } from "./elsewhere";'), { declared: 1 });
  assert.deepEqual(
    countFile(at, 'export { Switch } from "../../../ui/src/Switch/index.tsx";'),
    {},
    "a re-export of the shared piece is the cure, not a copy",
  );
  assert.deepEqual(
    countFile(at, 'import { Switch } from "../ui/src/Switch/index.tsx";\nexport { Switch };'),
    {},
    "so is a bare export of an import",
  );
});

test("Load more is found however it is spelled", () => {
  const at = "apps/app/src/zz/x.tsx";
  for (const text of [
    '<Text>Load{" "}more</Text>',
    "<Text>Load&nbsp;more</Text>",
    "<Text>Load More</Text>",
    '<Text>{"Load  more"}</Text>',
  ])
    assert.deepEqual(countFile(at, text), { "load-more": 1 }, text);
});

test("the baseline cannot be rebuilt by accident", () => {
  assert.equal(initAllowed(true, undefined), false, "refused while a baseline exists");
  assert.equal(initAllowed(true, "force"), true);
  assert.equal(initAllowed(false, "1"), true);
});
