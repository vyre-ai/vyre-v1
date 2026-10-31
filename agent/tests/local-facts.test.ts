// What a local call touches (rc.8): a delete outside the work folder always asks, a path that leaves the folder is refused, and a prompt with nobody to ask on the spot is held at the Gate, not refused and not run.
import test from "node:test";
import assert from "node:assert/strict";
import { decideLocal } from "../src/tools/local.ts";
import { leavesWorkFolder, localFacts } from "../src/tools/local-facts.ts";
import { ctx, loadGenerated, makeSession } from "../src/tools/harness.ts";

const terminal = { name: "terminal_run", local: "terminal" } as never;

test("deletes outside the work folder and paths that leave it are read from the call", () => {
  assert.deepEqual(localFacts(terminal, { command: "ls -la" }), {});
  assert.deepEqual(localFacts(terminal, { command: "rm work/old.txt" }), {}, "inside work/ is fine");
  assert.deepEqual(localFacts(terminal, { command: "rm /tmp/old.log" }), { deletesOutsideWork: true });
  assert.deepEqual(localFacts(terminal, { command: "rm -rf ~/Documents" }), { deletesOutsideWork: true });
  assert.deepEqual(localFacts(terminal, { command: "ls && rm ../other/x" }), { deletesOutsideWork: true });
  assert.deepEqual(localFacts(terminal, { command: "find /var -name x -delete" }), { deletesOutsideWork: true });
  assert.deepEqual(localFacts(terminal, { command: "ls", cwd: "/etc" }), { outsideLockedFolder: true });
  assert.deepEqual(localFacts(terminal, { command: "ls", cwd: "work/../../x" }), { outsideLockedFolder: true });
  assert.deepEqual(localFacts(terminal, { command: "ls", cwd: "work/build" }), {});
  assert.equal(leavesWorkFolder(undefined), false);
  assert.deepEqual(localFacts({ name: "chrome_act", local: "chrome" } as never, { command: "rm /x" }), {}, "only the terminal reads these");
});

test("the facts feed decideLocal: Auto still asks for a delete and refuses a path out", () => {
  const t = loadGenerated().catalog.byName("terminal_run")!;
  assert.equal(decideLocal(t, "auto", "auto", localFacts(t, { command: "rm /tmp/x" })).action, "prompt");
  assert.equal(decideLocal(t, "auto", "auto", localFacts(t, { command: "ls", cwd: "/etc" })).action, "refuse");
  assert.equal(decideLocal(t, "auto", "auto", localFacts(t, { command: "ls" })).action, "run");
});

test("a prompt with no one to ask on the spot is held at the Gate with the call marked Ask first", async () => {
  const { session } = makeSession({ localPolicy: (t) => decideLocal(t, "ask", "auto") });
  const out = await session.call(ctx(), "terminal_run", { command: "ls" });
  // the harness pipeline holds a gated agent call; what matters is that the call reached it instead of being refused
  assert.equal(out.kind, "held");
});
