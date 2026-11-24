// The same read twice in one turn, unchanged, is one line the second time (r42-runtime-tokens). Same agent, same turn, byte-identical answer, and only for the reads of one thing by its own tool;
// a changed answer, another turn, another agent, a small answer and a call with no turn id all come back whole.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import { ctx, fakeInvoke, loadGenerated } from "../src/tools/harness.ts";
import type { CallDeps } from "../src/tools/call.ts";
import { REPEAT_MIN_BYTES } from "../src/tools/repeat-read.ts";
import { invalidateReads } from "../src/tools/reads-epoch.ts";

const page = (rev: number, n = 6_000): { fileId: string; version: number; text: string } => ({
  fileId: "fil_1",
  version: rev,
  text: `price sheet revision ${rev}. `.repeat(Math.ceil(n / 28)).slice(0, n),
});

function setup(answer: () => unknown) {
  const loaded = loadGenerated();
  const base = fakeInvoke(loaded.caps).invoke;
  let calls = 0;
  const invoke: CallDeps["invoke"] = async (cap, input, seed) => {
    if (cap === "files.read") {
      calls++;
      return { status: "ok", output: answer(), traceId: "t" };
    }
    return base(cap, input, seed);
  };
  const session = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    invoke,
    levelFor: () => null,
    canEngineer: () => false,
    traceId: () => "t",
  });
  const tool = loaded.catalog.all.find((x) => x.cap === "files.read")!.name;
  session.preload("T1", [tool]);
  const read = async (c = ctx({ turnId: "trn_1", repeatSafe: true })): Promise<{ data: Record<string, unknown> }> => {
    const r = await session.call(c, tool, { fileId: "fil_1" });
    assert.equal(r.kind, "result");
    return (r.kind === "result" ? r.result.content : {}) as { data: Record<string, unknown> };
  };
  return { read, calls: () => calls };
}

test("the same file read again in one turn, unchanged, is one short line; the server is still asked", async () => {
  const s = setup(() => page(3));
  const a = await s.read();
  assert.equal(a.data["version"], 3, "the first read is whole");
  const b = await s.read();
  assert.equal(b.data["unchanged"], true);
  assert.match(String(b.data["message"]), /same .* answer you already have/);
  assert.ok(JSON.stringify(b).length < 400, "a line, not the page");
  assert.equal(s.calls(), 2, "the call itself still reaches the server and its access check");
});

test("a changed answer, another turn, another agent, no turn id and a small answer come back whole", async () => {
  let rev = 3;
  const s = setup(() => page(rev));
  await s.read();
  rev = 4;
  assert.equal((await s.read()).data["version"], 4, "it changed: whole");
  assert.equal(
    (await s.read(ctx({ turnId: "trn_2", repeatSafe: true }))).data["version"],
    4,
    "another turn reads it whole",
  );
  assert.equal(
    (await s.read(ctx({ turnId: "trn_1", agentId: "agt_drafter", repeatSafe: true }))).data["version"],
    4,
    "another agent",
  );
  assert.equal((await s.read(ctx())).data["version"], 4, "no turn id: whole");
  assert.equal((await s.read(ctx())).data["version"], 4, "and again, still whole");
  const small = setup(() => page(1, REPEAT_MIN_BYTES - 400));
  await small.read();
  assert.equal((await small.read()).data["version"], 1, "a small answer is sent again as it is");
});

test("a compaction or a resumed turn forgets the turn's reads, and a path that is not the API driver never gets the line", async () => {
  const s = setup(() => page(3));
  const api = ctx({ turnId: "trn_c", repeatSafe: true });
  await s.read(api);
  assert.equal((await s.read(api)).data["unchanged"], true);
  invalidateReads("trn_c"); // the driver compacted, or the turn was resumed
  assert.equal((await s.read(api)).data["version"], 3, "after the invalidation the read is whole again");
  assert.equal((await s.read(api)).data["unchanged"], true, "and is remembered afresh from there");
  invalidateReads("trn_c");
  invalidateReads("trn_c");
  assert.equal((await s.read(api)).data["version"], 3);
  // a CLI engine's call (MCP) has a turn id but is not repeatSafe: its own session can compact unseen
  const cli = ctx({ turnId: "trn_cli" });
  await s.read(cli);
  assert.equal((await s.read(cli)).data["version"], 3, "never shortened on the CLI path");
  assert.equal((await s.read(cli)).data["version"], 3);
});

test("a turn whose counter was evicted never gets its old reads trusted again", async () => {
  const { readsEpoch } = await import("../src/tools/reads-epoch.ts");
  const s = setup(() => page(3));
  const c = ctx({ turnId: "trn_evict", repeatSafe: true });
  await s.read(c);
  assert.equal((await s.read(c)).data["unchanged"], true);
  for (let i = 0; i < 2_100; i++) invalidateReads(`trn_other_${i}`);
  assert.equal(readsEpoch("trn_evict") > 0, true, "a counter that is gone reads as above every evicted count");
  assert.equal((await s.read(c)).data["version"], 3, "so the earlier read is not pointed at");
});
