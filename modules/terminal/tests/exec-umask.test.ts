// Every process Vyre starts in an agent's workspace runs under umask 077 (round three of the wall review): one helper, UMASK_WRAP, used by the one function that makes a Docker exec. This fails when a second way to
// start a process in the container is added without it, or the one that exists loses the wrapper.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UMASK_WRAP } from "../workspace.ts";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the umask wrapper is the only way a process is started in a workspace, and it sets 077", () => {
  assert.deepEqual([...UMASK_WRAP], ["sh", "-c", 'umask 077; exec "$@"', "sh"]);
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [f, fs.readFileSync(path.join(DIR, f), "utf8")] as const);
  const starts = files.flatMap(([f, src]) =>
    [...src.matchAll(/\b(?:api|docker|dk)\.exec\(|\bexecStart\(|\/exec"|\/exec`/g)].map((m) => `${f}:${m[0]}`),
  );
  assert.deepEqual(starts, ["workspace.ts:api.exec("], "one place makes an exec");
  const src = fs.readFileSync(path.join(DIR, "workspace.ts"), "utf8");
  const at = src.indexOf("api.exec(workspaceName(agentId)");
  assert.ok(at > 0);
  assert.match(
    src.slice(at, at + 200),
    /cmd: \[\.\.\.UMASK_WRAP, \.\.\.argv\]/,
    "with the wrapper in front of the command",
  );
});
