import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

test("a startup breach fails the process while allowing remaining evidence to run", () => {
  const moduleUrl = new URL("./startup.mjs", import.meta.url).href;
  const run = (ms: number | null) => spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { enforceStartupBudget } from ${JSON.stringify(moduleUrl)};
    enforceStartupBudget([{ size: "phone", kind: "cold", ms: ${JSON.stringify(ms)}, budget: 1500 }]);
    console.log("remaining probes ran");
  `], { encoding: "utf8" });
  for (const ms of [1501, null]) {
    const result = run(ms);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /remaining probes ran/);
  }
  assert.equal(run(1500).status, 0);
});

test("the shots entry enforces startup and preserves failure for its startup-only target", () => {
  const source = fs.readFileSync(new URL("./shots.mjs", import.meta.url), "utf8");
  assert.match(source, /await main\([^;]*["']--enforce["']/);
  const startupOnly = source.slice(source.indexOf('if (want === "P-UI_14")'), source.indexOf("// A packet id"));
  assert.doesNotMatch(startupOnly, /process\.exit\(0\)/);
  const noTargets = source.slice(source.indexOf('if (!targets.length && want.startsWith("P-"))'), source.indexOf('if (!targets.length) {'));
  assert.doesNotMatch(noTargets, /process\.exit\(0\)/, "a packet without screenshot targets must retain the earlier startup failure");
});
