// agents: a call to another module's keyed capability carries its key in the input. The pipeline reads the key of a capability that declares idempotency "key" from the call's input (host/src/invoke.ts),
// so a key the caller gave only as an option would be refused there: the wrapper every agents handler calls through puts it in the input too.
import test from "node:test";
import assert from "node:assert/strict";
import { call } from "../projections.ts";
import type { AgentsCtx } from "../projections.ts";

const seen: { cap: string; input: unknown; opts: unknown }[] = [];
const ctx = { call: async (cap: string, input: unknown, opts?: unknown) => { seen.push({ cap, input, opts }); return {}; }, log: { warn() {}, info() {}, error() {}, debug() {} } } as unknown as AgentsCtx;

test("a key given as an option goes into the input; a key already in the input stays; an input without an option is left alone", async () => {
  seen.length = 0;
  await call(ctx, "files.folder.create", { parentId: "fld_1", name: "x" }, { idempotencyKey: "k1" });
  await call(ctx, "files.folder.create", { parentId: "fld_1", name: "y", idempotencyKey: "own" }, { idempotencyKey: "k2" });
  await call(ctx, "files.get", { fileId: "fil_1" });
  assert.deepEqual(seen.map((c) => c.input), [{ parentId: "fld_1", name: "x", idempotencyKey: "k1" }, { parentId: "fld_1", name: "y", idempotencyKey: "own" }, { fileId: "fil_1" }]);
  assert.deepEqual(seen[0]!.opts, { idempotencyKey: "k1" });
});
