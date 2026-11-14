// The key of a call on the API engines (13 Nov 2026, review of the minimal branch): some providers number their calls again at every model step (Google's `gcall_0`, OpenAI's `call_0` when it sends no id), so the
// provider's call id alone is not unique inside a turn. The key is the turn, the call's position in the turn and the provider's id; a long id is hashed to a fixed length.
import test from "node:test";
import assert from "node:assert/strict";
import { createApiTools } from "../src/drivers/open/index.ts";
import { createToolSession } from "../src/tools/index.ts";
import { loadGenerated, validatingInvoke } from "../src/tools/harness.ts";

function rig() {
  const loaded = loadGenerated();
  const { invoke, sent } = validatingInvoke(loaded.caps);
  const session = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    invoke,
    levelFor: () => "manage",
    canEngineer: () => false,
  });
  session.preload("thr_1", ["artifact_publish"]);
  const tools = createApiTools({ session, space: "spc_1", system: async () => [] });
  const run = (turnId: string, id: string, input: unknown) =>
    tools.runner(
      { id, name: "artifact_publish", input } as never,
      { threadId: "thr_1", agentId: "agt_dex", asker: "usr_dana", turnId } as never,
    );
  const keys = () => sent.map((x) => (x.input as { idempotencyKey: string }).idempotencyKey);
  return { run, keys, sent };
}
const page = (t: string) => ({ title: t, html: `<h1>${t}</h1>` });

test("two steps of one turn that both call 'gcall_0' make two keys and run twice, with the same input or a different one", async () => {
  const r = rig();
  await r.run("trn_1", "gcall_0", page("Weekly report"));
  await r.run("trn_1", "gcall_0", page("Weekly report"));
  await r.run("trn_1", "gcall_0", page("Another"));
  assert.equal(r.sent.length, 3, "three handler runs");
  const k = r.keys();
  assert.match(k[0] ?? "", /^ag:trn_1:[0-9a-f]{8}\.0:gcall_0$/);
  assert.match(k[1] ?? "", /^ag:trn_1:[0-9a-f]{8}\.1:gcall_0$/);
  assert.match(k[2] ?? "", /^ag:trn_1:[0-9a-f]{8}\.2:gcall_0$/);
  assert.equal(new Set(k).size, 3);
});

test("another turn counts from its own start, and a call with no id gets a random key", async () => {
  const r = rig();
  await r.run("trn_1", "call_0", page("A"));
  await r.run("trn_2", "call_0", page("A"));
  await r.run("trn_3", "", page("A"));
  const k = r.keys();
  assert.match(k[0] ?? "", /^ag:trn_1:[0-9a-f]{8}\.0:call_0$/);
  assert.match(k[1] ?? "", /^ag:trn_2:[0-9a-f]{8}\.0:call_0$/);
  assert.match(k[2] ?? "", /^ag:r:/);
});

test("a very long call id is hashed to a fixed length, and the same long id gives the same part", async () => {
  const r = rig();
  const long = "toolu_".padEnd(500, "x");
  await r.run("trn_1", long, page("A"));
  await r.run("trn_2", long, page("A"));
  const [a, b] = r.keys();
  assert.ok((a ?? "").length < 80, a);
  assert.equal((a ?? "").split(":").at(-1), (b ?? "").split(":").at(-1));
});

test("a turn run again after a restart (a new process) never meets the keys of the run before it", async () => {
  const before = rig();
  const after = rig();
  await before.run("trn_1", "gcall_0", page("Weekly report"));
  await after.run("trn_1", "gcall_0", page("Weekly report"));
  assert.notEqual(before.keys()[0], after.keys()[0]);
});
