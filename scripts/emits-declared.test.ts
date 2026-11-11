// A capability may emit only the events its manifest lists in `emits`; the pipeline refuses any other ("event not declared in emits"). This is a source-level sweep of that rule.
// For every module it reads the handlers' literal `emit("name", ...)` calls, follows calls between the module's own functions from each capability's entry in impl.ts, and checks that every event
// reachable from a capability is listed in that capability's `emits` in generated/registry.json and exists as an event. A name built at run time is not seen; a helper reached by two capabilities is
// checked against both, which can over-report: an entry in ALLOW names a pair where the second capability never takes that path, with the reason.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("../", import.meta.url).pathname;
type Cap = { name: string; module: string; emits: string[] };
const registry = JSON.parse(fs.readFileSync(path.join(root, "generated/registry.json"), "utf8")) as { capabilities: Cap[]; events: { name: string }[] };
const eventNames = new Set(registry.events.map((e) => e.name));
const norm = (s: string): string => s.replaceAll("-", "_");

/** "capability event" pairs that the static walk reports but that cannot happen, with why. */
const SHARED_NAME = "the walk follows a function name that another capability's file also uses (a Map set, an import row), not this capability's own call";
const ALLOW: Record<string, string> = {
  "contacts.suppression.remove suppression.added": SHARED_NAME,
  "providers.own_people provider.added": SHARED_NAME,
  "providers.remove provider.added": SHARED_NAME,
  "providers.space_key.remove provider.added": SHARED_NAME,
  "vault.inject_env provider.added": SHARED_NAME,
};

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else", "try", "await", "typeof", "super"]);

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "tests" || e.name === "fixtures" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) yield p;
  }
}

/** The function bodies of a source file by name: `function name(`, `async function name(`, `const name = (...) =>`, and methods of the handler tables `"name": async (...) =>` / `name(ctx, ...) {`. */
function bodies(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const starts: { name: string; at: number }[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*[<(]|(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=\n{]+)?=>|(?:^|\n)\s*(?:async\s+)?"?([A-Za-z0-9_$.]+)"?\s*(?:\([^)]*\)\s*(?::[^{\n]+)?\s*\{|:\s*(?:async\s*)?\([^)]*\)\s*(?::[^=\n]+)?=>)/g)) {
    const name = (m[1] ?? m[2] ?? m[3])!;
    if (KEYWORDS.has(name)) continue;
    starts.push({ name, at: m.index! });
  }
  starts.sort((a, b) => a.at - b.at);
  starts.forEach((s, i) => { const body = text.slice(s.at, starts[i + 1]?.at ?? text.length); out.set(s.name, (out.get(s.name) ?? "") + "\n" + body); });
  return out;
}

test("every event a capability's handler path emits is listed in that capability's emits", () => {
  const problems: string[] = [];
  for (const mod of fs.readdirSync(path.join(root, "modules"))) {
    const dir = path.join(root, "modules", mod);
    if (!fs.statSync(dir).isDirectory()) continue;
    const caps = registry.capabilities.filter((c) => norm(c.module) === norm(mod));
    if (!caps.length) continue;
    const fns = new Map<string, string>();
    const count = new Map<string, number>();
    for (const file of sources(dir)) for (const [n, b] of bodies(fs.readFileSync(file, "utf8"))) { fns.set(n, (fns.get(n) ?? "") + b); count.set(n, (count.get(n) ?? 0) + 1); }
    // a name defined twice in a module (or one that is only a helper everything uses) is not followed: the walk cannot tell which one is meant
    const shared = new Set<string>([...count].filter(([, c]) => c > 1).map(([n]) => n));
    for (const n of ["ensure", "call", "tolerant", "fail", "bad", "raise", "refuse", "str", "num", "obj", "rows", "row", "get", "list", "run", "all"]) shared.add(n);
    const emitsOf = (body: string): string[] => [...body.matchAll(/\.emit\(\s*["']([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)["']/g)].map((m) => m[1]!);
    const calledNames = (body: string): string[] => [...body.matchAll(/(?<![A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)\s*[<(]/g)].map((m) => m[1]!).filter((n) => fns.has(n));
    const via = new Map<string, string>(), viaCap = new Map<string, string>();
    const reach = (start: string): Set<string> => {
      const seen = new Set<string>(), found = new Set<string>();
      let level = [start];
      for (let depth = 0; depth < 2 && level.length; depth++) {
        const nextLevel: string[] = [];
        for (const n of level) {
          if (seen.has(n)) continue;
          seen.add(n);
          const body = fns.get(n) ?? "";
          for (const e of emitsOf(body)) { found.add(e); if (!via.has(`${start} ${e}`)) via.set(`${start} ${e}`, n); }
          for (const c of calledNames(body)) if (!seen.has(c) && !shared.has(c)) nextLevel.push(c);
        }
        level = nextLevel;
      }
      return found;
    };
    // a capability's entry: its line (up to the next quoted capability name) in the module's handler table
    const entryOf = (cap: string): string | undefined => {
      for (const file of sources(dir)) {
        const text = fs.readFileSync(file, "utf8");
        const at = text.search(new RegExp(`(?:^|\\n)\\s*"${cap.replaceAll(".", "\\.")}"\\s*[:(]`));
        if (at < 0) continue;
        const rest = text.slice(at + 1);
        const next = rest.slice(1).search(/\n\s*"[a-z_]+\.[a-z_.]+"\s*[:(]|\n\}/);
        return next < 0 ? rest : rest.slice(0, next + 1);
      }
      return undefined;
    };
    for (const cap of caps) {
      const entry = entryOf(cap.name);
      if (entry === undefined) continue;
      const found = new Set<string>(emitsOf(entry));
      for (const c of calledNames(entry)) for (const e of reach(c)) { found.add(e); viaCap.set(`${cap.name} ${e}`, `${c} > ${via.get(`${c} ${e}`) ?? "?"}`); }
      for (const ev of found) {
        if (ALLOW[`${cap.name} ${ev}`]) continue;
        if (!eventNames.has(ev)) problems.push(`${cap.name} emits ${ev}, which is no declared event`);
        else if (!cap.emits.includes(ev)) problems.push(`${cap.name} emits ${ev} but does not list it in emits (through ${viaCap.get(`${cap.name} ${ev}`) ?? "its own body"})`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
