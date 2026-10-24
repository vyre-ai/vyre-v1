// node golden/harness/cli.ts   runs every flow on the registry's module statuses; pending flows are listed, never red.
import { evaluate, exitCode, fileSteps, loadFlows, loadRegistryModules, summary } from "./index.ts";

const modules = loadRegistryModules();
const results = [];
for (const f of await loadFlows()) results.push(await evaluate(f, modules, fileSteps()));
for (const r of results) console.log(r.line);
console.log(summary(results));
process.exit(exitCode(results));
