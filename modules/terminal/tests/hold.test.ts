// The keyboard of a terminal (13 Nov, AGENT-COMPUTER-2026-11-13.md B2 and B3, section 11 rules 1 and 4): a person takes it with one call and hands it back; while held the agent's commands and everyone
// else's keys are refused with one plain sentence; a hold nobody uses for 15 minutes ends by itself; only the owner of the terminal or an admin takes it from another person.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { registry } from "../../../generated/registry.ts";
import { assertEventsConform, codeOf, contractErrors, fakeHost, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;
const call = async (hn: Harness, cap: string, input: unknown, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
const rejects = async (f: () => unknown): Promise<string> => {
  try {
    await f();
  } catch (e) {
    return codeOf(e);
  }
  return "no error";
};
let keys = 0;
const SARA = { kind: "person" as const, id: "usr_sara" };
const AGENT = { kind: "agent" as const, id: "agt_intake" };
const OMAR = { kind: "person" as const, id: "usr_omar" };
/** Omar owns the agent (so he may enter its workspace) but, in these tests, manages nothing and owns no terminal: only the take and give-back rules can refuse him. */
const omarCtx = (hn: Harness): Harness["ctx"] => ({
  ...hn.as(OMAR),
  call: async (cap: string) => (cap === "agents.get" ? { agent: { ownerId: "usr_omar", kind: "agent" } } : {}),
});

function setup(): { hn: Harness; id: string } {
  reset();
  const hn = harness();
  bindHost(fakeHost({}).host);
  return { hn, id: "" };
}
const open = async (hn: Harness): Promise<string> =>
  (await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: `k${++keys}` }))
    .terminal.terminalId;

test("take over: the row says who has the keyboard, and the take is announced", async () => {
  const { hn } = setup();
  const id = await open(hn);
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, undefined);
  const out = await call(hn, "terminal.take_over", { terminalId: id });
  assert.equal(out.terminal.heldBy, "usr_dana");
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, "usr_dana");
  const listed = (await call(hn, "terminal.list", {})).terminals.find(
    (x: { terminalId: string }) => x.terminalId === id,
  );
  assert.equal(listed.heldBy, "usr_dana");
  assert.deepEqual(hn.named("terminal.taken")[0]?.payload, { terminalId: id, by: "usr_dana" });
  assert.deepEqual(assertEventsConform(hn), []);
});

test("while a person holds it, the agent's commands and another person's keys are refused with one sentence; the holder's keys go through", async () => {
  const { hn } = setup();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  const agent = hn.as(AGENT);
  assert.equal(
    await rejects(() => h["terminal.run"]!(agent, { command: "ls", terminalId: id })),
    "validation.precondition_failed",
  );
  assert.equal(
    await rejects(() => h["terminal.input"]!(hn.as(SARA), { terminalId: id, data: "x" })),
    "validation.precondition_failed",
  );
  assert.equal(
    await rejects(() => h["terminal.interrupt"]!(hn.as(SARA), { terminalId: id })),
    "validation.precondition_failed",
  );
  const said = await (async () => {
    try {
      await h["terminal.input"]!(hn.as(SARA), { terminalId: id, data: "x" });
    } catch (e) {
      return JSON.stringify(e);
    }
    return "";
  })();
  assert.match(said, /has the keyboard/);
  assert.equal((await call(hn, "terminal.input", { terminalId: id, data: "pwd\r" })).ok, true, "the holder types");
});

test("give back: the agent and others can type again, and the hand-back is announced", async () => {
  const { hn } = setup();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  const out = await call(hn, "terminal.give_back", { terminalId: id });
  assert.equal(out.terminal.heldBy, undefined);
  assert.equal(await rejects(() => h["terminal.input"]!(hn.ctx, { terminalId: id, data: "ls\r" })), "no error");
  assert.deepEqual(hn.named("terminal.given_back")[0]?.payload, { terminalId: id, by: "usr_dana" });
  // giving back what nobody holds is quiet
  assert.equal((await call(hn, "terminal.give_back", { terminalId: id })).terminal.heldBy, undefined);
  assert.equal(hn.named("terminal.given_back").length, 1);
});

test("a hold nobody uses for 15 minutes ends by itself; typing keeps it in use", async () => {
  const { hn } = setup();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  hn.advance(14 * 60_000);
  await call(hn, "terminal.input", { terminalId: id, data: "x" });
  hn.advance(14 * 60_000);
  assert.equal(
    (await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy,
    "usr_dana",
    "28 minutes in, but used 14 minutes ago",
  );
  hn.advance(2 * 60_000);
  assert.equal(
    (await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy,
    undefined,
    "15 quiet minutes: back to the agent",
  );
  assert.equal(hn.named("terminal.given_back").length, 0, "a read never emits: the hold simply reads as over");
});

/** Every event a call raised is one its manifest entry declares (the host refuses any other: host/src/invoke.ts). */
async function checked(hn: Harness, cap: string, input: unknown, ctx: Harness["ctx"] = hn.ctx): Promise<any> {
  const before = hn.emitted.length;
  const out = await h[cap]!(ctx, input);
  const declared = new Set(registry.capabilities.find((c) => c.name === cap)!.emits as readonly string[]);
  for (const e of hn.emitted.slice(before))
    assert.ok(declared.has(e.name), `${cap} emitted ${e.name}, which it does not declare`);
  return out;
}

test("a hold that went stale writes and emits nothing from any call, and the calls that read or act work as before", async () => {
  const { hn } = setup();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  hn.advance(16 * 60_000);
  const rows = hn.rows("SELECT * FROM terminal_hold");
  await checked(hn, "terminal.get", { terminalId: id });
  await checked(hn, "terminal.list", {});
  await checked(hn, "terminal.input", { terminalId: id, data: "x" });
  await checked(hn, "terminal.interrupt", { terminalId: id });
  await checked(hn, "terminal.run", { command: "ls", terminalId: id }, hn.ctx).catch(() => undefined);
  assert.equal(hn.emitted.filter((e) => e.name === "terminal.given_back").length, 0);
  assert.deepEqual(
    hn.rows("SELECT * FROM terminal_hold"),
    rows.map((r) => ({ ...r })),
    "reads left the row alone",
  );
  // the next take replaces the stale row
  await checked(hn, "terminal.take_over", { terminalId: id }, hn.as(SARA));
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, "usr_sara");
});

test("taking the keyboard from another person: the owner of the terminal or an admin only; anyone else is refused and nothing changes", async () => {
  const { hn } = setup();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id }, hn.as(SARA));
  // a person who neither owns the terminal nor manages the agent
  hn.allowOnly((a) => a.level !== "manage");
  assert.equal(
    await rejects(() => h["terminal.take_over"]!(hn.as({ kind: "person", id: "usr_omar" }), { terminalId: id })),
    "permission.role_lacks_permission",
  );
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, "usr_sara");
  // an admin (manage on the agent) takes it, and the other person is told
  hn.allowOnly(() => true);
  const out = await call(hn, "terminal.take_over", { terminalId: id });
  assert.equal(out.terminal.heldBy, "usr_dana");
  assert.deepEqual(hn.named("terminal.taken").at(-1)?.payload, { terminalId: id, by: "usr_dana", from: "usr_sara" });
});

test("an agent cannot take the keyboard", async () => {
  const { hn } = setup();
  const id = await open(hn);
  assert.equal(await rejects(() => h["terminal.take_over"]!(hn.as(AGENT), { terminalId: id })), "permission.no_grant");
});

// ---- the screen and the keys (lead ruling 14 Nov): tmux's own capture with colours, and raw keys for the person who holds the keyboard

function keyed(): { hn: Harness; sent: unknown[] } {
  reset();
  const hn = harness();
  const base = fakeHost({}).host;
  const sent: unknown[] = [];
  bindHost({
    ...base,
    async capture() {
      return { text: "\u001b[31mred\u001b[0m", cols: 100, rows: 30, cursor: { x: 3, y: 1 }, history: 0, hidden: true };
    },
    async keys(_id, ks) {
      sent.push(ks);
    },
  });
  return { hn, sent };
}

test("capture answers the screen with its colours, the cursor and whether a prompt is hidden", async () => {
  const { hn } = keyed();
  const id = await open(hn);
  const r = await call(hn, "terminal.capture", { terminalId: id });
  assert.deepEqual(r, {
    text: "\u001b[31mred\u001b[0m",
    cols: 100,
    rows: 30,
    cursor: { x: 3, y: 1 },
    history: 0,
    hidden: true,
  });
});

test("keys reach the terminal raw; while another person holds it they are refused, and the holder's go through", async () => {
  const { hn, sent } = keyed();
  const id = await open(hn);
  await call(hn, "terminal.keys", {
    terminalId: id,
    keys: [{ text: "gh auth login" }, { key: "Enter" }, { paste: "4F2A-91CD" }],
  });
  assert.deepEqual(sent, [[{ text: "gh auth login" }, { key: "Enter" }, { paste: "4F2A-91CD" }]]);
  await call(hn, "terminal.take_over", { terminalId: id }, hn.as(SARA));
  assert.equal(
    await rejects(() => h["terminal.keys"]!(hn.ctx, { terminalId: id, keys: [{ key: "Enter" }] })),
    "validation.precondition_failed",
  );
  assert.equal(
    await rejects(() => h["terminal.keys"]!(hn.as(AGENT), { terminalId: id, keys: [{ key: "Enter" }] })),
    "validation.precondition_failed",
  );
  assert.equal(sent.length, 1, "nothing reached the terminal while Sara held it");
  assert.equal((await call(hn, "terminal.keys", { terminalId: id, keys: [{ key: "Up" }] }, hn.as(SARA))).ok, true);
  assert.equal(sent.length, 2);
});

test("a key entry is exactly one of text, key or paste; keys are never in the audit trail or the log", async () => {
  const { hn, sent } = keyed();
  const id = await open(hn);
  assert.equal(
    await rejects(() => h["terminal.keys"]!(hn.ctx, { terminalId: id, keys: [{ text: "a", key: "Enter" }] })),
    "validation.bad_input",
  );
  assert.equal(
    await rejects(() => h["terminal.keys"]!(hn.ctx, { terminalId: id, keys: [{}] })),
    "validation.bad_input",
  );
  await call(hn, "terminal.keys", { terminalId: id, keys: [{ text: "hunter2-correct-horse" }] });
  assert.equal(sent.length, 1);
  const seen = JSON.stringify([hn.emitted, hn.logged]);
  assert.ok(!seen.includes("hunter2"), "what was typed is in no event and no log line");
});

test("a terminal whose host has no screen or keys says so in one sentence", async () => {
  reset();
  const hn = harness();
  bindHost(fakeHost({}).host);
  const id = await open(hn);
  assert.equal(
    await rejects(() => h["terminal.capture"]!(hn.ctx, { terminalId: id })),
    "validation.precondition_failed",
  );
  assert.equal(
    await rejects(() => h["terminal.keys"]!(hn.ctx, { terminalId: id, keys: [{ key: "Enter" }] })),
    "validation.precondition_failed",
  );
});

// ---- mutation guards (r-pc, 14 Nov): each check below is killed by a test

test("an agent acting for the holder is still the agent: refused while the person holds", async () => {
  const { hn } = setup();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  const agentForHolder = hn.as(AGENT, "usr_dana");
  assert.equal(
    await rejects(() => h["terminal.input"]!(agentForHolder, { terminalId: id, data: "x" })),
    "validation.precondition_failed",
  );
  assert.equal(
    await rejects(() => h["terminal.run"]!(agentForHolder, { command: "ls", terminalId: id })),
    "validation.precondition_failed",
  );
});

test("give back: only the holder, the terminal's owner or an admin; someone else who may enter the workspace is refused and nothing changes", async () => {
  const { hn } = setup();
  const id = await open(hn); // owned by usr_dana
  await call(hn, "terminal.take_over", { terminalId: id }, hn.as(SARA));
  hn.allowOnly((a) => a.level !== "manage");
  assert.equal(
    await rejects(() => h["terminal.give_back"]!(omarCtx(hn), { terminalId: id })),
    "permission.role_lacks_permission",
  );
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, "usr_sara");
  // the owner of the terminal may
  hn.allowOnly(() => true);
  assert.equal((await call(hn, "terminal.give_back", { terminalId: id })).terminal.heldBy, undefined);
});

test("taking from another person: someone who may enter the workspace but neither owns the terminal nor manages the agent is refused by the take rule itself", async () => {
  const { hn } = setup();
  const id = await open(hn); // owner usr_dana
  await call(hn, "terminal.take_over", { terminalId: id }, hn.as(SARA));
  hn.allowOnly((a) => a.level !== "manage");
  // omar passes the workspace check (use level is allowed) and fails only the take rule
  assert.equal(
    await rejects(() => h["terminal.take_over"]!(omarCtx(hn), { terminalId: id })),
    "permission.role_lacks_permission",
  );
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, "usr_sara");
});

test("the holder looking renews the hold: reading and attaching keep it past 15 minutes; someone else looking does not", async () => {
  const { hn } = setup();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  for (let i = 0; i < 3; i++) {
    hn.advance(10 * 60_000);
    await call(hn, "terminal.read", { terminalId: id });
  }
  assert.equal(
    (await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy,
    "usr_dana",
    "30 minutes in, kept by reads",
  );
  hn.advance(10 * 60_000);
  await call(hn, "terminal.read", { terminalId: id }, hn.as(SARA));
  hn.advance(6 * 60_000);
  assert.equal(
    (await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy,
    undefined,
    "another person's read keeps nothing",
  );
});

test("while a person holds a terminal the agent's other doors wait too: close, resize, rename, its commands in every tab and a new tab", async () => {
  const { hn } = setup();
  const held = await open(hn);
  const other = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: held });
  const agent = hn.as(AGENT);
  const pf = "validation.precondition_failed";
  assert.equal(await rejects(() => h["terminal.close"]!(agent, { terminalId: held })), pf);
  assert.equal(await rejects(() => h["terminal.resize"]!(agent, { terminalId: held, cols: 80, rows: 24 })), pf);
  assert.equal(await rejects(() => h["terminal.rename"]!(agent, { terminalId: held, name: "x" })), pf);
  assert.equal(
    await rejects(() => h["terminal.input"]!(agent, { terminalId: other, data: "x" })),
    pf,
    "another tab of the same workspace",
  );
  assert.equal(
    await rejects(() => h["terminal.run"]!(agent, { command: "ls", host: "agent_computer", agentId: "agt_intake" })),
    pf,
    "no new tab to get around it",
  );
  // the holder may close it; the hold row goes with it
  assert.equal((await call(hn, "terminal.close", { terminalId: held })).closed, true);
  assert.equal(
    await rejects(() => h["terminal.input"]!(agent, { terminalId: other, data: "x" })),
    "no error",
    "the workspace is free again",
  );
});
