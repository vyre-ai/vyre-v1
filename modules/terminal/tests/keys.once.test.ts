// Typing into an agent's terminal is applied AT MOST ONCE and IN ORDER (15 Nov, rc.29). A batch of keys carries the take-over's lease, its number and the sender's key: a repeat (the app retries a call whose
// answer was lost; a reconnect replays) types nothing and gets the first answer; a gap or an old take-over is refused in plain words. rc.28 shipped with take-over off because a re-sent batch ran twice.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { codeOf, contractErrors, fakeHost, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;
const call = async (hn: Harness, cap: string, input: unknown, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
const failure = async (f: () => unknown): Promise<{ code: string; message: string; reason?: unknown }> => {
  try {
    await f();
  } catch (e) {
    const err = (e as { error?: { message?: string; details?: { reason?: unknown } } }).error;
    return { code: codeOf(e), message: String(err?.message ?? ""), reason: err?.details?.reason };
  }
  return { code: "no error", message: "" };
};
const SARA = { kind: "person" as const, id: "usr_sara" };
const AGENT = { kind: "agent" as const, id: "agt_intake" };
let n = 0;

function world(opts: { failAfterApplying?: boolean; slowMs?: number } = {}) {
  reset();
  const hn = harness();
  const base = fakeHost({}).host;
  const sent: unknown[][] = [];
  const order: string[] = [];
  bindHost({
    ...base,
    async capture() {
      return { text: "$ ", cols: 100, rows: 30, cursor: { x: 2, y: 0 }, history: 0, hidden: false };
    },
    async keys(_id, ks) {
      if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));
      sent.push([...ks]);
      order.push(JSON.stringify(ks));
      // the host applies the keys and THEN fails (a connection lost after tmux took them): the case that ran a command twice
      if (opts.failAfterApplying) throw new Error("connection lost after the keys were applied");
    },
  });
  return { hn, sent, order };
}
const open = async (hn: Harness): Promise<string> =>
  (await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: `o${++n}` }))
    .terminal.terminalId;
const batch = (id: string, lease: string, seq: number, key: string, text: string, extra: object = {}) => ({
  terminalId: id,
  lease,
  seq,
  idempotencyKey: key,
  keys: [{ text }],
  ...extra,
});

test("a batch sent twice with the same key types once and the second answer is the first (with its screen)", async () => {
  const { hn, sent } = world();
  const id = await open(hn);
  const t = await call(hn, "terminal.take_over", { terminalId: id });
  assert.equal(t.nextSeq, 1);
  const first = await call(hn, "terminal.keys", batch(id, t.lease, 1, "k-one", "echo one", { capture: true }));
  const again = await call(hn, "terminal.keys", batch(id, t.lease, 1, "k-one", "echo one", { capture: true }));
  assert.deepEqual(again, first, "a repeat gets the first answer");
  assert.equal(sent.length, 1, "and types nothing");
  // the next number goes on from there
  await call(hn, "terminal.keys", batch(id, t.lease, 2, "k-two", "\n"));
  assert.equal(sent.length, 2);
});

test("a batch the host applied and then failed on is answered with that failure on every repeat and never sent again", async () => {
  const { hn, sent } = world({ failAfterApplying: true });
  const id = await open(hn);
  const t = await call(hn, "terminal.take_over", { terminalId: id });
  const a = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, t.lease, 1, "k-x", "rm -rf build")));
  assert.equal(a.code, "internal.unexpected");
  for (let i = 0; i < 3; i++) {
    const b = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, t.lease, 1, "k-x", "rm -rf build")));
    assert.equal(b.code, "internal.unexpected", "the same answer");
  }
  assert.equal(sent.length, 1, "four calls, one delivery");
  // the number was spent: the next batch is number 2, and a take_over says so
  assert.equal((await call(hn, "terminal.take_over", { terminalId: id })).nextSeq, 2);
});

test("a gap is refused in plain words and types nothing; the right number then goes through", async () => {
  const { hn, sent } = world();
  const id = await open(hn);
  const t = await call(hn, "terminal.take_over", { terminalId: id });
  const gap = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, t.lease, 2, "k-gap", "echo two")));
  assert.equal(gap.code, "validation.precondition_failed");
  assert.equal(gap.reason, "seq_gap");
  assert.match(gap.message, /Some keys before these did not arrive/);
  assert.equal(sent.length, 0);
  await call(hn, "terminal.keys", batch(id, t.lease, 1, "k-1", "echo one"));
  // a number already used with a different key is refused too
  const used = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, t.lease, 1, "k-other", "echo again")));
  assert.equal(used.reason, "seq_used");
  assert.equal(sent.length, 1);
});

test("an old take-over is refused: after a give back and a new take, the old lease types nothing; a repeat of an applied batch after the give back still answers and types nothing", async () => {
  const { hn, sent } = world();
  const id = await open(hn);
  const old = await call(hn, "terminal.take_over", { terminalId: id });
  const first = await call(hn, "terminal.keys", batch(id, old.lease, 1, "k-a", "echo one"));
  await call(hn, "terminal.give_back", { terminalId: id });
  // late repeat of the applied batch: the first answer, no second delivery, and nothing lands in what the agent runs now
  assert.deepEqual(await call(hn, "terminal.keys", batch(id, old.lease, 1, "k-a", "echo one")), first);
  assert.equal(sent.length, 1);
  // a NEW batch of the old take-over after the give back: nobody holds, refused
  const late = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, old.lease, 2, "k-b", "echo two")));
  assert.equal(late.reason, "not_holder");
  assert.match(late.message, /do not have the keyboard/);
  // taken again: a new lease; the old lease is refused though the person holds again
  const fresh = await call(hn, "terminal.take_over", { terminalId: id });
  assert.notEqual(fresh.lease, old.lease);
  assert.equal(fresh.nextSeq, 1);
  const stale = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, old.lease, 2, "k-c", "echo three")));
  assert.equal(stale.reason, "lease_old");
  assert.match(stale.message, /take-over of this terminal is over/);
  assert.equal(sent.length, 1, "none of the refused batches reached the terminal");
});

test("two senders: only the holder types; another person cannot type with the holder's lease or reuse the holder's key; the agent cannot either", async () => {
  const { hn, sent } = world();
  const id = await open(hn);
  const t = await call(hn, "terminal.take_over", { terminalId: id });
  await call(hn, "terminal.keys", batch(id, t.lease, 1, "k-dana", "echo one"));
  for (const [who, ctx] of [
    ["Sara", hn.as(SARA)],
    ["the agent", hn.as(AGENT)],
    ["the agent acting for Dana", hn.as(AGENT, "usr_dana")],
  ] as const) {
    const fresh = await failure(() => h["terminal.keys"]!(ctx, batch(id, t.lease, 2, `k-${who}`, "echo hijack")));
    assert.equal(fresh.code, "validation.precondition_failed", `${who}, a new batch`);
    const reuse = await failure(() => h["terminal.keys"]!(ctx, batch(id, t.lease, 1, "k-dana", "echo one")));
    assert.equal(reuse.code, "validation.precondition_failed", `${who}, the holder's key`);
  }
  assert.equal(sent.length, 1, "only Dana's one batch reached the terminal");
  assert.equal(sent.length, 1);
});

test("a batch repeated while the first is still being sent is told to wait and is not typed; two numbers fired together reach the terminal in order", async () => {
  const { hn, sent, order } = world({ slowMs: 40 });
  const id = await open(hn);
  const t = await call(hn, "terminal.take_over", { terminalId: id });
  const one = h["terminal.keys"]!(hn.ctx, batch(id, t.lease, 1, "k-1", "echo one"));
  const two = h["terminal.keys"]!(hn.ctx, batch(id, t.lease, 2, "k-2", "echo two"));
  const repeat = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, t.lease, 1, "k-1", "echo one")));
  assert.equal(repeat.reason, "in_flight");
  await Promise.all([one, two]);
  assert.deepEqual(order, [JSON.stringify([{ text: "echo one" }]), JSON.stringify([{ text: "echo two" }])]);
  assert.equal(sent.length, 2);
});

test("a take-over made again by its holder keeps its lease and its place; a new holder gets a new lease", async () => {
  const { hn } = world();
  const id = await open(hn);
  const a = await call(hn, "terminal.take_over", { terminalId: id });
  await call(hn, "terminal.keys", batch(id, a.lease, 1, "k-1", "x"));
  const again = await call(hn, "terminal.take_over", { terminalId: id });
  assert.equal(again.lease, a.lease);
  assert.equal(again.nextSeq, 2);
  await call(hn, "terminal.give_back", { terminalId: id });
  const b = await call(hn, "terminal.take_over", { terminalId: id }, hn.as(SARA));
  assert.notEqual(b.lease, a.lease);
});

test("who may take the keyboard: the owner of the agent and the Space's managers; a person who only has Use on the agent, and a guest, are refused with one sentence", async () => {
  const { hn, sent } = world();
  const id = await open(hn);
  hn.allowOnly((a) => a.level !== "manage");
  const asking = (id0: string): Harness["ctx"] => ({
    ...hn.as({ kind: "person", id: id0 }),
    call: async (cap: string) => (cap === "agents.get" ? { agent: { ownerId: "usr_dana", kind: "agent" } } : {}),
  });
  for (const who of ["usr_sara", "usr_guest"]) {
    const r = await failure(() => h["terminal.take_over"]!(asking(who), { terminalId: id }));
    assert.equal(r.code, "permission.role_lacks_permission", who);
    assert.match(r.message, /not yours to open/);
    const k = await failure(() => h["terminal.keys"]!(asking(who), batch(id, "lse_x", 1, "g1", "x")));
    assert.ok(k.code.startsWith("permission."), `${who} types nothing: ${k.code}`);
  }
  assert.equal(sent.length, 0);
  // the owner may; so may a manager (the kernel's manage level on the agent)
  const ownerCtx: Harness["ctx"] = { ...hn.ctx, call: asking("usr_dana").call! };
  assert.equal((await call(hn, "terminal.take_over", { terminalId: id }, ownerCtx)).terminal.heldBy, "usr_dana");
  await call(hn, "terminal.give_back", { terminalId: id }, ownerCtx);
  hn.allowOnly(() => true);
  assert.equal((await call(hn, "terminal.take_over", { terminalId: id }, hn.as(SARA))).terminal.heldBy, "usr_sara");
});

test("the three calls are audited as the person's own: audit always on take_over, keys and give_back", async () => {
  const { registry } = await import("../../../generated/registry.ts");
  const caps = (registry as { capabilities: Array<{ name: string; audit?: string; idempotency?: string }> })
    .capabilities;
  for (const name of ["terminal.take_over", "terminal.keys", "terminal.give_back"])
    assert.equal(caps.find((c) => c.name === name)?.audit, "always", name);
  assert.equal(caps.find((c) => c.name === "terminal.keys")?.idempotency, "key");
});
