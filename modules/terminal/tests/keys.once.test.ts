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
  (
    await call(
      hn,
      "terminal.open",
      { host: "agent_computer", agentId: "agt_intake", idempotencyKey: `o${++n}` },
      hn.as(AGENT, "usr_dana"),
    )
  ).terminal.terminalId;
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
  assert.deepEqual(
    again,
    { ok: true },
    "a repeat gets the first answer without the screen (the app reads the screen again)",
  );
  assert.equal(first.ok, true);
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
  await call(hn, "terminal.keys", batch(id, old.lease, 1, "k-a", "echo one"));
  await call(hn, "terminal.give_back", { terminalId: id });
  // late repeat of the applied batch after the give back: nothing of the lease is kept, so it is refused and types nothing
  const repeat = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, old.lease, 1, "k-a", "echo one")));
  assert.equal(repeat.reason, "not_holder");
  assert.equal(sent.length, 1);
  assert.equal(hn.rows("SELECT * FROM terminal_key_batch").length, 0, "the batches went with the lease");
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
    // a person with Use enters the agent's computer in a place of their own, and the agent's own terminal is not theirs: told in one plain sentence
    assert.match(r.message, /someone else's/);
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

test("a screen that shows a secret is never kept: neither the batch record nor the idempotency copy holds it, and the typed text is not hashed into the stored input", async () => {
  reset();
  const hn = harness();
  const base = fakeHost({}).host;
  bindHost({
    ...base,
    async capture() {
      return { text: "TOKEN=sk-live-SECRET-0123456789", cols: 100, rows: 30, cursor: null, history: 0, hidden: false };
    },
    async keys() {},
  });
  const id = await open(hn);
  const t = await call(hn, "terminal.take_over", { terminalId: id });
  const r = await call(hn, "terminal.keys", batch(id, t.lease, 1, "k-s", "cat .env", { capture: true }));
  assert.ok(JSON.stringify(r).includes("SECRET"), "the person gets the screen");
  assert.ok(
    !JSON.stringify(hn.rows("SELECT * FROM terminal_key_batch")).includes("SECRET"),
    "the batch record has no screen",
  );
  // what the host's idempotency table keeps of the call
  const { withoutScreen, withoutTypedKeys } = await import("../../../host/src/invoke.ts");
  const kept = JSON.stringify(withoutScreen({ status: "ok", output: r, traceId: "t" }));
  assert.ok(!kept.includes("SECRET") && kept.includes('"ok":true'), "the stored copy is {ok} only");
  const hashed = JSON.stringify(withoutTypedKeys(batch(id, t.lease, 1, "k-s", "cat .env")));
  assert.ok(!hashed.includes("cat .env"), "the typed text is not in the stored input");
});

test("a batch that is too big is refused in plain words before its number is spent", async () => {
  const { hn, sent } = world();
  const id = await open(hn);
  const t = await call(hn, "terminal.take_over", { terminalId: id });
  const big = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, t.lease, 1, "k-big", "x".repeat(2_000_000))));
  assert.equal(big.code, "validation.bad_input");
  assert.match(big.message, /too much to type at once/);
  assert.equal(sent.length, 0);
  assert.equal((await call(hn, "terminal.take_over", { terminalId: id })).nextSeq, 1, "the number was not spent");
});

test("a person's own terminal is theirs alone: another person, a manager and the agent cannot take it, type, read its screen, interrupt or close it", async () => {
  const { hn, sent } = world();
  // Dana's own tab in the agent's computer (opened by her, not the agent's)
  const own = (
    await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: "own-1" })
  ).terminal.terminalId as string;
  const sara = hn.as(SARA); // allowed everything by the harness: a manager
  for (const [cap, input] of [
    ["terminal.take_over", { terminalId: own }],
    ["terminal.keys", batch(own, "lse_x", 1, "own-k", "echo hijack")],
    ["terminal.capture", { terminalId: own }],
    ["terminal.read", { terminalId: own }],
    ["terminal.input", { terminalId: own, data: "x" }],
    ["terminal.interrupt", { terminalId: own }],
    ["terminal.rename", { terminalId: own, name: "mine" }],
    ["terminal.close", { terminalId: own }],
  ] as const)
    for (const [who, ctx] of [
      ["a manager", sara],
      ["an agent acting for someone else", hn.as(AGENT, "usr_sara")],
    ] as const) {
      const r = await failure(() => h[cap]!(ctx, input));
      assert.ok(r.code.startsWith("permission."), `${cap} by ${who}: ${r.code}`);
    }
  assert.equal(sent.length, 0);
  assert.equal(
    (await call(hn, "terminal.take_over", { terminalId: own })).terminal.heldBy,
    "usr_dana",
    "its owner may",
  );
});

test("a holder who is suspended, removed or signed out gives the keyboard back at once", async () => {
  const { hn } = world();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, "usr_dana");
  const { consumers } = await import("../impl.ts");
  const gone = consumers["terminal.holder_gone"];
  assert.deepEqual(gone.on, ["principal.suspended", "member.removed", "session.revoked"]);
  assert.deepEqual(await gone.run(hn.ctx, { payload: { principalId: "usr_dana" } }), [id]);
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, undefined);
  const r = await h["terminal.run"]!(hn.as(AGENT, "usr_dana"), {
    command: "echo hi",
    terminalId: id,
    idempotencyKey: "after-gone",
  });
  assert.ok(r, "the agent's next command runs");
  assert.equal(hn.rows("SELECT * FROM terminal_lease").length, 0);
});

test("when a manager takes the keyboard the event names the agent and its owner; the owner taking their own names nobody", async () => {
  const { hn } = world();
  const id = await open(hn);
  const asked = (who: string, ownerId: string): Harness["ctx"] => ({
    ...hn.as({ kind: "person", id: who }),
    call: async (cap: string) => (cap === "agents.get" ? { agent: { ownerId, kind: "agent", name: "Desk" } } : {}),
  });
  await call(hn, "terminal.take_over", { terminalId: id }, asked("usr_wes", "usr_dana"));
  const p = hn.named("terminal.taken")[0]!.payload;
  assert.deepEqual(
    [p["by"], p["agentId"], p["agentName"], p["agentOwner"]],
    ["usr_wes", "agt_intake", "Desk", "usr_dana"],
  );
  await call(hn, "terminal.give_back", { terminalId: id }, asked("usr_wes", "usr_dana"));
  assert.equal(hn.named("terminal.given_back")[0]!.payload["agentOwner"], "usr_dana");
  await call(hn, "terminal.take_over", { terminalId: id }, asked("usr_dana", "usr_dana"));
  assert.equal(hn.named("terminal.taken")[1]!.payload["agentOwner"], undefined, "the owner is not told of their own");
});

// ---- the second review: every door of a person's own terminal, old rows, orphans, a different text under one number

test("terminal.run into a person's own terminal by its id, and terminal.status of it, tell another person or a manager nothing and type nothing", async () => {
  const { hn, sent } = world();
  const own = (
    await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: "own-run" })
  ).terminal.terminalId as string;
  const manager = hn.as(SARA);
  const r = await failure(() =>
    h["terminal.run"]!(manager, { command: "echo RUNINTO", terminalId: own, idempotencyKey: "run-into" }),
  );
  assert.equal(r.code, "permission.role_lacks_permission");
  const agent = await failure(() =>
    h["terminal.run"]!(hn.as(AGENT, "usr_sara"), {
      command: "echo RUNINTO",
      terminalId: own,
      idempotencyKey: "run-into-2",
    }),
  );
  assert.ok(agent.code.startsWith("permission."), agent.code);
  assert.equal(sent.length, 0);
  // status: the row is there with its state, with no last line or last command
  bindHost({
    ...fakeHost({}).host,
    async status(ids: string[]) {
      return ids.map((terminalId) => ({
        terminalId,
        state: "running" as const,
        lastLine: "SECRETLINE",
        exitCode: null,
      }));
    },
  });
  assert.equal(
    (await h["terminal.status"]!(hn.ctx, { terminalIds: [own] })).rows[0].lastLine,
    "SECRETLINE",
    "its owner reads it",
  );
  const theirs = await h["terminal.status"]!(manager, { terminalIds: [own] });
  assert.equal(theirs.rows.length, 1);
  assert.equal(theirs.rows[0].lastLine, undefined);
  assert.equal(theirs.rows[0].lastCommand, undefined);
});

test("a member cannot rename the agent's terminal: rename needs entry to the computer, like every other door", async () => {
  const { hn } = world();
  const id = await open(hn);
  hn.allowOnly((a) => a.level !== "manage");
  const member: Harness["ctx"] = {
    ...hn.as({ kind: "person", id: "usr_ben" }),
    call: async (cap: string) => (cap === "agents.get" ? { agent: { ownerId: "usr_dana", kind: "agent" } } : {}),
  };
  const r = await failure(() => h["terminal.rename"]!(member, { terminalId: id, name: "mine now" }));
  assert.equal(r.code, "permission.role_lacks_permission");
  hn.allowOnly(() => true);
  assert.notEqual((await call(hn, "terminal.get", { terminalId: id })).terminal.name, "mine now");
});

test("a terminal with no recorded opener is refused to every person; an old row owned by an agent id is still the agent's", async () => {
  const { hn } = world();
  const own = (
    await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: "old-1" })
  ).terminal.terminalId as string;
  hn.raw.run?.("UPDATE terminal_sessions SET owner = '' WHERE terminal_id = ?", own);
  for (const who of [hn.ctx, hn.as(SARA)]) {
    for (const cap of [
      "terminal.take_over",
      "terminal.capture",
      "terminal.read",
      "terminal.interrupt",
      "terminal.close",
    ]) {
      const r = await failure(() => h[cap]!(who, { terminalId: own }));
      assert.equal(r.code, "permission.role_lacks_permission", `${cap} with no opener`);
    }
  }
  // an old row made by the agent before tab records: owner is the agent id, a named session: the agent's, entered as before
  const old = (
    await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: "old-2" })
  ).terminal.terminalId as string;
  hn.raw.run?.("UPDATE terminal_sessions SET owner = 'agt_intake', name = 'build' WHERE terminal_id = ?", old);
  hn.raw.run?.("DELETE FROM terminal_tabs WHERE terminal_id = ?", old);
  assert.equal((await call(hn, "terminal.capture", { terminalId: old }, hn.as(SARA))).hidden !== undefined, true);
});

test("a manager closes a terminal whose opener is no longer an active member, and only closes it; a removed or suspended person's own terminals are closed with them", async () => {
  const { hn } = world();
  const own = (
    await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: "orph-1" })
  ).terminal.terminalId as string;
  const asking = (status: string): Harness["ctx"] => ({
    ...hn.as({ kind: "person", id: "usr_wes" }),
    call: async (cap: string) =>
      cap === "access.principals.get" ? { principal: { status } } : { agent: { ownerId: "usr_x", kind: "agent" } },
  });
  // an active opener: a manager may not close it
  const no = await failure(() => h["terminal.close"]!(asking("active"), { terminalId: own }));
  assert.equal(no.code, "permission.role_lacks_permission");
  // never read or type, even then
  const read = await failure(() => h["terminal.capture"]!(asking("suspended"), { terminalId: own }));
  assert.equal(read.code, "permission.role_lacks_permission");
  assert.deepEqual(await h["terminal.close"]!(asking("suspended"), { terminalId: own }), { closed: true });
  // removal closes the person's own terminals through the consumer, and not the agent's
  const mine = (
    await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: "orph-2" })
  ).terminal.terminalId as string;
  const agents = await open(hn);
  const { consumers } = await import("../impl.ts");
  const closed = await consumers["terminal.holder_gone"].run(hn.ctx, {
    name: "member.removed",
    payload: { personId: "usr_dana" },
  });
  assert.ok(closed.includes(mine) && !closed.includes(agents), JSON.stringify([closed, mine, agents]));
  assert.equal((await call(hn, "terminal.get", { terminalId: mine })).terminal.state, "exited");
  // signing out of one device closes nothing
  const still = await open(hn);
  const out = await consumers["terminal.holder_gone"].run(hn.ctx, {
    name: "session.revoked",
    payload: { person: "usr_dana" },
  });
  assert.ok(!out.includes(still));
});

test("the same key and number with other text is refused in plain words, not answered as the first", async () => {
  const { hn, sent } = world();
  const id = await open(hn);
  const t = await call(hn, "terminal.take_over", { terminalId: id });
  await call(hn, "terminal.keys", batch(id, t.lease, 1, "k-1", "echo one"));
  const same = await call(hn, "terminal.keys", batch(id, t.lease, 1, "k-1", "echo one"));
  assert.deepEqual(same, { ok: true });
  const other = await failure(() => h["terminal.keys"]!(hn.ctx, batch(id, t.lease, 1, "k-1", "rm -rf build")));
  assert.equal(other.reason, "keys_differ");
  assert.match(other.message, /already used for other keys/);
  assert.equal(sent.length, 1);
});
