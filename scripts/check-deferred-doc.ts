// docs/deferred.md must match the deferred set the host registers (host/src/routes/deferred.ts). The doc names a capability, or "all N <module>.* capabilities" for a module that is deferred whole.
//   node scripts/check-deferred-doc.ts
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFERRED_CAPS } from "../host/src/routes/deferred.ts";

const CAP = /\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\b/g;

/** The problems between the doc text and a deferred set; empty when they match. */
export function docMismatches(doc: string, set: ReadonlySet<string>): string[] {
  const named = new Set<string>();
  const whole = new Map<string, number>();
  let inTable = false;
  for (const line of doc.split("\n")) {
    if (!line.startsWith("|")) { inTable = false; continue; }
    if (/^\|\s*Module\s*\|\s*Capability\s*\|/.test(line)) { inTable = true; continue; }
    if (!inTable) continue;   // the other tables of the doc (Space administration gaps) are not capability lists
    const all = /all (\d+) ([a-z][a-z0-9_]*)\.\* capabilities/.exec(line);
    if (all) { whole.set(all[2]!, Number(all[1])); continue; }
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4 || /^-+$/.test(cells[1] ?? "")) continue;
    for (const m of (cells[2] ?? "").matchAll(CAP)) named.add(m[0]);
  }
  const out: string[] = [];
  for (const c of [...set].sort()) {
    const module = c.slice(0, c.indexOf("."));
    if (!named.has(c) && !whole.has(module)) out.push(`${c} is deferred in the host but not in docs/deferred.md`);
  }
  for (const c of [...named].sort()) if (!set.has(c)) out.push(`${c} is in docs/deferred.md but not deferred in the host`);
  for (const [module, n] of whole) {
    const have = [...set].filter((c) => c.startsWith(`${module}.`)).length;
    if (have !== n) out.push(`docs/deferred.md says all ${n} ${module}.* capabilities are deferred; the host defers ${have}`);
  }
  return out;
}

export async function loadDeferredSet(): Promise<ReadonlySet<string>> {
  // importing a module's impl registers its deferred capabilities
  await Promise.all(["sites", "reports-client", "vault"].map((m) => import(`../modules/${m}/impl.ts`)));
  return DEFERRED_CAPS;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const doc = fs.readFileSync(new URL("../docs/deferred.md", import.meta.url), "utf8");
  const problems = docMismatches(doc, await loadDeferredSet());
  for (const p of problems) console.log(`deferred-doc: ${p}`);
  console.log(`deferred-doc: ${problems.length} problems`);
  if (problems.length) process.exit(1);
}
