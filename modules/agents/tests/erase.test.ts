// Delete for good (F77): the rules of the job, on the real agents tables with a fake neighbour per module. Each test names the rule it pins.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, restoreAgentFiles } from "../impl.ts";
import { ERASE_STEPS, runErase, sweepExpired, retentionMs, TRASH_KEEP_MS } from "../handlers/erase.ts";
import { DANA, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
/** A harness whose neighbours answer the erase calls (each module's host call), as the daemon's do. */
const world = (): Harness => {
  const hn = harness();
  for (const m of ERASE_STEPS) hn.world.answer(`host.hook.call.${m}.erase_agent`, () => ({}));
  return hn;
};
const make = async (hn: Harness, name = "Desk"): Promise<any> =>
  (await h["agents.create"]!(hn.ctx, { name, idempotencyKey: `k${++n}` })).agent;
const stepsCalled = (hn: Harness): string[] =>
  hn.world.calls
    .filter((c) => c.cap.endsWith(".erase_agent") && (c.input as { input?: { dry?: boolean } }).input?.dry !== true)
    .map((c) => c.cap.replace("host.hook.call.", "").replace(".erase_agent", ""));

test("an agent that is not in Trash is refused in one plain sentence, and nothing starts", async () => {
  const hn = world();
  const a = await make(hn);
  assert.equal(
    await failure(() => h["agents.delete_for_good"]!(hn.ctx, { agentId: a.agentId })),
    "validation.precondition_failed",
  );
  assert.deepEqual(hn.named("agent.erasing"), []);
});

test("a person's Assistant is refused, in one plain sentence", async () => {
  const hn = world();
  const a = await make(hn, "Dana Assistant");
  hn.ctx.db.run("UPDATE agents_agent SET kind = 'assistant', deletedAt = 1 WHERE id = ?", a.agentId);
  await assert.rejects(h["agents.delete_for_good"]!(hn.ctx, { agentId: a.agentId }), (e: unknown) =>
    /Assistant stays with them/.test(String((e as Error).message)),
  );
});

test("delete for good records one job, pressing again changes nothing, and the job clears every store then the agent's own rows, leaving a tombstone", async () => {
  const hn = world();
  const a = await make(hn);
  await h["agents.delete"]!(hn.ctx, { agentId: a.agentId });
  assert.deepEqual(await h["agents.delete_for_good"]!(hn.ctx, { agentId: a.agentId }), { erasing: true });
  assert.deepEqual(
    await h["agents.delete_for_good"]!(hn.ctx, { agentId: a.agentId }),
    { erasing: true },
    "twice is the same job",
  );
  assert.equal(hn.named("agent.erasing").length, 1);
  const listed = await h["agents.trash.list"]!(hn.ctx, {});
  assert.equal(listed.agents[0].deleting, true, "the row says Deleting");
  assert.deepEqual(await runErase(hn.ctx as never), [a.agentId]);
  assert.deepEqual(stepsCalled(hn), [...ERASE_STEPS], "every module is asked, in order");
  assert.equal(
    hn.ctx.db.all("SELECT id FROM agents_agent WHERE id = ?", a.agentId).length,
    0,
    "the row and profile are gone",
  );
  assert.equal(
    (hn.ctx.db.all("SELECT state FROM agents_erase WHERE agentId = ?", a.agentId)[0] as Record<string, unknown>)[
      "state"
    ],
    "erased",
    "the tombstone stays",
  );
  assert.deepEqual(await runErase(hn.ctx as never), [], "run again: nothing to do, no error");
  assert.deepEqual(
    await h["agents.delete_for_good"]!(hn.ctx, { agentId: a.agentId }),
    { erasing: false },
    "pressing on an erased agent is not an error",
  );
  assert.equal(hn.named("agent.erased").length, 1);
});

test("a store that fails keeps the job where it is; the next pass resumes at that store and never skips it", async () => {
  const hn = world();
  const a = await make(hn);
  await h["agents.delete"]!(hn.ctx, { agentId: a.agentId });
  await h["agents.delete_for_good"]!(hn.ctx, { agentId: a.agentId });
  let down = true;
  hn.world.answer("host.hook.call.memory.erase_agent", () => {
    if (down) throw new Error("memory is down");
    return {};
  });
  assert.deepEqual(await runErase(hn.ctx as never), []);
  assert.equal(
    hn.ctx.db.all("SELECT id FROM agents_agent WHERE id = ?", a.agentId).length,
    1,
    "the agent's own row waits for every store",
  );
  down = false;
  assert.deepEqual(await runErase(hn.ctx as never), [a.agentId]);
  assert.equal(stepsCalled(hn).filter((s) => s === "engine").length, 1, "a step that was done is not asked again");
});

test("an agent being deleted for good cannot be restored", async () => {
  const hn = world();
  const a = await make(hn);
  await h["agents.delete"]!(hn.ctx, { agentId: a.agentId });
  await h["agents.delete_for_good"]!(hn.ctx, { agentId: a.agentId });
  assert.equal(
    await failure(() => h["agents.restore"]!(hn.ctx, { agentId: a.agentId })),
    "validation.precondition_failed",
  );
});

test("Trash's keep time runs out: the agent is started on the Space's own trash clock, and not before", async () => {
  const hn = world();
  const a = await make(hn);
  await h["agents.delete"]!(hn.ctx, { agentId: a.agentId });
  hn.world.answer("governance.retention.get", () => ({ kinds: [{ key: "trash", value: "7d" }] }));
  hn.advance(6 * 86_400_000);
  assert.deepEqual(await sweepExpired(hn.ctx as never), []);
  hn.advance(2 * 86_400_000);
  assert.deepEqual(await sweepExpired(hn.ctx as never), [a.agentId]);
  assert.equal(TRASH_KEEP_MS, retentionMs("30d"));
  void DANA;
});

test("an agent deleted for good is never adopted again from the access list, and its id is never reused", async () => {
  const hn = world();
  const a = await make(hn);
  await h["agents.delete"]!(hn.ctx, { agentId: a.agentId });
  await h["agents.delete_for_good"]!(hn.ctx, { agentId: a.agentId });
  await runErase(hn.ctx as never);
  hn.world.answer("access.principals.list", () => ({
    principals: [{ id: a.agentId, kind: "agent", name: "Desk", owner: "usr_dana", status: "active" }],
  }));
  await restoreAgentFiles(hn.ctx as never);
  assert.equal(
    hn.ctx.db.all("SELECT id FROM agents_agent WHERE id = ?", a.agentId).length,
    0,
    "no ghost record comes back",
  );
});

test("an agent, an agent acting for a person and a service are refused in one plain sentence: only a person deletes for good", async () => {
  const hn = world();
  const a = await make(hn);
  await h["agents.delete"]!(hn.ctx, { agentId: a.agentId });
  for (const who of [
    { principal: { kind: "agent", id: a.agentId } },
    { principal: { kind: "agent", id: "agt_other" }, actingFor: DANA },
    { principal: { kind: "service", id: "svc_aut" } },
  ]) {
    const ctx = { ...hn.ctx, ...who } as Harness["ctx"];
    await assert.rejects(h["agents.delete_for_good"]!(ctx, { agentId: a.agentId }), (e: unknown) =>
      /Only a person can delete an agent for good\./.test(String((e as Error).message)),
    );
  }
  assert.deepEqual(hn.named("agent.erasing"), []);
});

test("the Trash clock never guesses: a failed retention read, or a value it cannot read, erases nothing; only a missing setting means 30 days", async () => {
  const hn = world();
  const a = await make(hn);
  await h["agents.delete"]!(hn.ctx, { agentId: a.agentId });
  hn.advance(31 * 86_400_000);
  hn.world.answer("governance.retention.get", () => ({ kinds: [{ key: "trash", value: "forever" }] }));
  assert.deepEqual(await sweepExpired(hn.ctx as never), [], "forever keeps it");
  hn.world.answer("governance.retention.get", () => {
    throw new Error("governance is starting");
  });
  assert.deepEqual(await sweepExpired(hn.ctx as never), [], "a failed read at boot keeps it");
  hn.world.answer("governance.retention.get", () => ({ kinds: [{ key: "trash", value: "soon" }] }));
  assert.deepEqual(await sweepExpired(hn.ctx as never), [], "a value it cannot read keeps it");
  hn.world.answer("governance.retention.get", () => {
    throw Object.assign(new Error("no such capability"), { error: { code: "validation.unknown_capability" } });
  });
  assert.deepEqual(await sweepExpired(hn.ctx as never), [a.agentId], "no retention setting at all: the 30 day default");
});

test("a teammate is not pressed for good by a person (it goes with its project or chat)", async () => {
  const hn = world();
  const a = await make(hn, "Helper");
  hn.ctx.db.run("UPDATE agents_agent SET kind = 'teammate', deletedAt = 1 WHERE id = ?", a.agentId);
  await assert.rejects(h["agents.delete_for_good"]!(hn.ctx, { agentId: a.agentId }), (e: unknown) =>
    /goes with its project or chat/.test(String((e as Error).message)),
  );
});
