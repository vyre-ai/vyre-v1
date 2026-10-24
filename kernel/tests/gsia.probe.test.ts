import test from "node:test";
import { spawnSync } from "node:child_process";
test("probe", () => {
  for (const c of ["which tsc; which npx; which npm; ls /usr/lib/node_modules /usr/local/lib/node_modules ~/.npm 2>&1 | head -20; ls node_modules 2>&1 | head -3; npm config get registry; timeout 20 npm view typescript version 2>&1 | tail -2"]) {
    const r = spawnSync("bash", ["-c", c], { encoding: "utf8" });
    console.log("PROBE>", r.stdout, r.stderr);
  }
});
