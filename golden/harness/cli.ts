// node golden/harness/cli.ts   runs every flow on the registry's module statuses; pending flows are listed, never red.
import { evaluate, exitCode, fileSteps, loadFlows, loadRegistryModules, summary } from "./index.ts";

const modules = loadRegistryModules();
const results = [];
for (const f of await loadFlows()) {
  const t0 = Date.now();
  if (process.env["GOLDEN_TIMES"]) console.error(`golden flow ${f.n}: start`);
  results.push(await evaluate(f, modules, fileSteps()));
  if (process.env["GOLDEN_TIMES"]) console.error(`golden flow ${f.n}: ${Date.now() - t0} ms`);
}
for (const r of results) console.log(r.line);
console.log(summary(results));
process.exit(exitCode(results));
