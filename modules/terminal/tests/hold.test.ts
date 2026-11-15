// The keyboard of a terminal (13 Nov, AGENT-COMPUTER-2026-11-13.md B2 and B3, section 11 rules 1 and 4): a person takes it with one call and hands it back; while held the agent's commands and everyone
// else's keys are refused with one plain sentence; a hold nobody uses for 15 minutes ends by itself; only the owner of the terminal or an admin takes it from another person.
import test from "node:test";

// take-over is ON by default (15 Nov, rc.29); VYRE_TERMINAL_TAKEOVER=0 turns it off (see the last tests of this file)
delete process.env["VYRE_TERMINAL_TAKEOVER"];
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { bindHost, hideRunLine, rememberSecrets, scopeOfId } from "../projections.ts";
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
// the agent's own terminal (a person's own tab is theirs alone: see the last tests)
const open = async (hn: Harness): Promise<string> =>
  (
    await call(
      hn,
      "terminal.open",
      { host: "agent_computer", agentId: "agt_intake", idempotencyKey: `k${++keys}` },
      hn.as(AGENT, "usr_dana"),
    )
  ).terminal.terminalId;

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
  assert.match(
    said,
    /A person is typing in this computer's terminal\. Your commands are refused until they hand it back/,
  );
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

/** A person's seat at the keyboard: takes it over, then types batch after batch with the lease, the next number and a key of their own, as the app does. */
interface Seat {
  lease: string;
  next: number;
  ctx: Harness["ctx"];
}
async function sit(hn: Harness, id: string, ctx: Harness["ctx"] = hn.ctx): Promise<Seat> {
  const r = await call(hn, "terminal.take_over", { terminalId: id }, ctx);
  return { lease: r.lease, next: r.nextSeq, ctx };
}
async function press(
  hn: Harness,
  id: string,
  seat: Seat,
  ks: Array<Record<string, string>>,
  extra: Record<string, unknown> = {},
): Promise<any> {
  const r = await call(
    hn,
    "terminal.keys",
    { terminalId: id, lease: seat.lease, seq: seat.next, idempotencyKey: `b${++keys}`, keys: ks, ...extra },
    seat.ctx,
  );
  seat.next += 1;
  return r;
}

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

test("keys reach the terminal raw for the person who took it; while another person holds it, everyone else is refused, and the holder's go through", async () => {
  const { hn, sent } = keyed();
  const id = await open(hn);
  const dana = await sit(hn, id);
  await press(hn, id, dana, [{ text: "gh auth login" }, { key: "Enter" }, { paste: "4F2A-91CD" }]);
  assert.deepEqual(sent, [[{ text: "gh auth login" }, { key: "Enter" }, { paste: "4F2A-91CD" }]]);
  // Sara takes it from Dana: Dana owns the terminal, Sara may not take it from its owner, so she is refused; Dana hands it back and Sara takes it
  await call(hn, "terminal.give_back", { terminalId: id });
  const sara = await sit(hn, id, hn.as(SARA));
  for (const who of [hn.ctx, hn.as(AGENT)])
    assert.equal(
      await rejects(() =>
        h["terminal.keys"]!(who, {
          terminalId: id,
          lease: dana.lease,
          seq: 3,
          idempotencyKey: "x1",
          keys: [{ key: "Enter" }],
        }),
      ),
      "validation.precondition_failed",
    );
  assert.equal(sent.length, 1, "nothing reached the terminal while Sara held it");
  assert.equal((await press(hn, id, sara, [{ key: "Up" }])).ok, true);
  assert.equal(sent.length, 2);
});

test("a key entry is exactly one of text, key or paste; keys are never in the audit trail or the log", async () => {
  const { hn, sent } = keyed();
  const id = await open(hn);
  const dana = await sit(hn, id);
  const at = (ks: unknown[], n: number) => ({
    terminalId: id,
    lease: dana.lease,
    seq: dana.next,
    idempotencyKey: `bad${n}`,
    keys: ks,
  });
  assert.equal(
    await rejects(() => h["terminal.keys"]!(hn.ctx, at([{ text: "a", key: "Enter" }], 1))),
    "validation.bad_input",
  );
  assert.equal(await rejects(() => h["terminal.keys"]!(hn.ctx, at([{}], 2))), "validation.bad_input");
  await press(hn, id, dana, [{ text: "hunter2-correct-horse" }]);
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
  const dana = await sit(hn, id);
  assert.equal(
    await rejects(() =>
      h["terminal.keys"]!(hn.ctx, {
        terminalId: id,
        lease: dana.lease,
        seq: dana.next,
        idempotencyKey: "nk",
        keys: [{ key: "Enter" }],
      }),
    ),
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

test("only the holder's keys renew a hold: reads, captures and attaches never do, so a sheet left open gives the keyboard back after 15 quiet minutes", async () => {
  const { hn } = setup();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  // a sheet left open: a capture and a read every few seconds for 16 minutes, no key
  for (let i = 0; i < 16; i++) {
    hn.advance(60_000);
    await call(hn, "terminal.read", { terminalId: id });
    await call(hn, "terminal.attach", { terminalId: id });
  }
  assert.equal(
    (await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy,
    undefined,
    "16 quiet minutes: back to the agent",
  );
  // keys do renew it
  await call(hn, "terminal.take_over", { terminalId: id });
  for (let i = 0; i < 3; i++) {
    hn.advance(10 * 60_000);
    await call(hn, "terminal.input", { terminalId: id, data: "x" });
  }
  assert.equal(
    (await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy,
    "usr_dana",
    "30 minutes in, kept by keys",
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

test("capture scrubs a Vault value filled into a command, as every other reading does", async () => {
  const { hn } = setup();
  reset();
  const hn2 = harness();
  bindHost({
    ...fakeHost({}).host,
    async capture() {
      return {
        text: "token is sk-live-1234567890abcdef ok",
        cols: 80,
        rows: 24,
        cursor: null,
        history: 0,
        hidden: false,
      };
    },
  });
  void hn;
  const id = await open(hn2);
  rememberSecrets(scopeOfId(hn2.db, id), [
    { handle: "#Key.token", itemId: "itm_1", value: "sk-live-1234567890abcdef" },
  ]);
  const r = await call(hn2, "terminal.capture", { terminalId: id });
  assert.ok(!r.text.includes("sk-live-1234567890abcdef"), "the value is not in the screen");
  assert.match(r.text, /token is .* ok/);
});

test("keys with capture answer with the screen a moment after, scrubbed, in the same call", async () => {
  const { hn, sent } = keyed();
  const id = await open(hn);
  const dana = await sit(hn, id);
  const r = await press(hn, id, dana, [{ text: "ls" }, { key: "Enter" }], { capture: true });
  assert.equal(r.ok, true);
  assert.equal(r.screen.hidden, true, "the screen of the stand-in host");
  assert.equal(sent.length, 1);
  const plain = await press(hn, id, dana, [{ key: "Up" }]);
  assert.equal(plain.screen, undefined, "no screen unless asked");
});

test("the agent's own terminal is there before anyone asks: opened once per person, the one its commands land in, and a person's call only", async () => {
  const { hn } = setup();
  const a = await call(hn, "terminal.open", {
    host: "agent_computer",
    agentId: "agt_intake",
    own: true,
    idempotencyKey: "own1",
  });
  assert.equal(a.terminal.name, "agent");
  assert.deepEqual(a.terminal.by, { kind: "agent" });
  const again = await call(hn, "terminal.open", {
    host: "agent_computer",
    agentId: "agt_intake",
    own: true,
    idempotencyKey: "own2",
  });
  assert.equal(again.terminal.terminalId, a.terminal.terminalId, "asked again it is the same one");
  // the agent's command, acting for Dana, lands in it and opens no second tab
  const before = hn.rows("SELECT terminal_id FROM terminal_sessions").length;
  await h["terminal.run"]!(hn.as(AGENT, "usr_dana"), { command: "echo hi" });
  assert.equal(
    hn.rows("SELECT terminal_id FROM terminal_sessions").length,
    before,
    "its commands go to the terminal that was already there",
  );
  assert.equal(
    await rejects(() =>
      h["terminal.open"]!(hn.as(AGENT), { host: "agent_computer", agentId: "agt_intake", own: true }),
    ),
    "permission.no_grant",
  );
});

test("a terminal row says which chat it was opened from, and status gives the last command run in it", async () => {
  const { hn } = setup();
  const ctx = { ...hn.ctx, thread: "thr_launch" };
  const id = (
    await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: "th1" }, ctx)
  ).terminal.terminalId;
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.threadId, "thr_launch");
  const listed = (await call(hn, "terminal.list", {})).terminals.find(
    (x: { terminalId: string }) => x.terminalId === id,
  );
  assert.equal(listed.threadId, "thr_launch");
  const none = await open(hn);
  assert.equal(
    (await call(hn, "terminal.get", { terminalId: none })).terminal.threadId,
    undefined,
    "a terminal that belongs to no chat has none",
  );
  await h["terminal.run"]!(ctx, { command: "npm test", terminalId: id });
  const st = await call(hn, "terminal.status", { terminalIds: [id] });
  assert.equal(st.rows[0].lastCommand, "npm test");
});

test("a member who may only View the workspace is refused terminal.keys, terminal.input and terminal.interrupt, and sees no change in the terminal", async () => {
  const { hn } = setup();
  const id = await open(hn); // owner usr_dana
  hn.allowOnly((a) => a.level === "view");
  const sara = hn.as(SARA);
  for (const [cap, input] of [
    ["terminal.keys", { terminalId: id, lease: "lse_x", seq: 1, idempotencyKey: "v1", keys: [{ text: "x" }] }],
    ["terminal.input", { terminalId: id, data: "x" }],
    ["terminal.interrupt", { terminalId: id }],
  ] as const) {
    const code = await rejects(() => h[cap]!(sara, input));
    assert.ok(code.startsWith("permission."), `${cap} refused for a viewer, got ${code}`);
  }
  hn.allowOnly(() => true);
  assert.equal(
    (await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy,
    undefined,
    "nothing was taken or typed",
  );
});

test("after the terminal has ended its screen is not drawn again: a capture of it is an error, never an empty or different screen", async () => {
  const { hn } = keyed();
  const id = await open(hn);
  const before = await call(hn, "terminal.capture", { terminalId: id });
  assert.equal(typeof before.text, "string");
  await call(hn, "terminal.close", { terminalId: id });
  assert.equal(await rejects(() => h["terminal.capture"]!(hn.ctx, { terminalId: id })), "validation.not_found");
});

test("a terminal the person ended with exit reads as exited in status and gives the keyboard back; its last screen is still readable until it is closed", async () => {
  reset();
  const hn = harness();
  const base = fakeHost({}).host;
  let gone = false;
  bindHost({
    ...base,
    async status(ids: string[]) {
      return ids.map((terminalId) => ({
        terminalId,
        state: gone ? ("exited" as const) : ("idle" as const),
        exitCode: null,
      }));
    },
  });
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, "usr_dana");
  gone = true;
  const st = await call(hn, "terminal.status", { terminalIds: [id] });
  assert.equal(st.rows[0].state, "exited");
  assert.equal(
    (await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy,
    undefined,
    "an ended terminal holds nobody",
  );
});

test("a person watching sees the command an agent ran, never the line that types it: no marker, session id or exit-code store on any surface", async () => {
  reset();
  const hn = harness();
  const base = fakeHost({}).host;
  const typed =
    "root@host:~# printf '%s\\n' '__VYRE_BEG_ab12cd__'; { echo running tests; sleep 25\n}; __vyre_rc=$?; 'tmux' set-option -q -t 'vyre-trm_01a1dbc4358945eea07c60dbb198b89d' @vyre_rc_ab12cd \"$__vyre_rc\" 2>/dev/null; printf '\\n%s:%d\\n' '__VYRE_END_ab12cd__' \"$__vyre_rc\"; unset __vyre_rc";
  // the screen wraps the typed line at 40 columns
  const wrapped = typed
    .replace(/\n/g, "")
    .match(/.{1,40}/g)!
    .join("\n");
  const screen = `${wrapped}\n__VYRE_BEG_ab12cd__\nrunning tests\nroot@host:~# `;
  bindHost({
    ...base,
    async capture() {
      return { text: screen, cols: 40, rows: 10, cursor: { x: 13, y: 8 }, history: 0, hidden: false };
    },
    async read() {
      return { text: screen, next: 0 };
    },
  });
  const id = await open(hn);
  const seen = [
    (await call(hn, "terminal.capture", { terminalId: id })).text,
    (await call(hn, "terminal.read", { terminalId: id })).text,
    (await call(hn, "terminal.attach", { terminalId: id })).replay ?? "",
  ];
  for (const t of seen) {
    assert.ok(!/vyre-trm_|@vyre_rc_|__VYRE_|__vyre_rc|printf '%s/.test(t), `no internal text in: ${t}`);
    assert.ok(
      t.includes("root@host:~# echo running tests; sleep 25") && t.includes("running tests"),
      "the command and its output are there",
    );
  }
  // a person's own printf is left alone
  const own = "$ printf '%s' hello";
  assert.equal(hideRunLine(own), own);
});

test("take-over OFF (VYRE_TERMINAL_TAKEOVER=0): EVERY kind of caller is refused terminal.take_over, terminal.keys and terminal.give_back with one plain sentence, and nothing happens: no host call, no hold row, no event", async () => {
  const { hn, sent } = keyed();
  const id = await open(hn);
  const was = process.env["VYRE_TERMINAL_TAKEOVER"];
  process.env["VYRE_TERMINAL_TAKEOVER"] = "0";
  const rows = (): number => hn.rows("SELECT * FROM terminal_hold").length;
  const events = (): number => hn.named("terminal.taken").length + hn.named("terminal.given_back").length;
  const callers: Array<[string, Harness["ctx"]]> = [
    ["person", hn.ctx],
    ["agent", hn.as(AGENT)],
    ["agent acting for a person", hn.as(AGENT, "usr_dana")],
    ["actor", hn.as({ kind: "actor" as never, id: "act_x" })],
    ["service", hn.as({ kind: "service" as never, id: "svc_x" })],
    ["a kind added later", hn.as({ kind: "something_new" as never, id: "x_1" })],
  ];
  try {
    const before = [sent.length, rows(), events()];
    for (const [who, ctx] of callers)
      for (const [cap, input] of [
        ["terminal.take_over", { terminalId: id }],
        ["terminal.keys", { terminalId: id, keys: [{ text: "x" }] }],
        ["terminal.give_back", { terminalId: id }],
      ] as const) {
        let msg = "";
        const code = await rejects(async () => {
          try {
            await h[cap]!(ctx, input);
          } catch (e) {
            msg = String((e as { error?: { message?: string } }).error?.message ?? e);
            throw e;
          }
        });
        assert.equal(code, "permission.no_grant", `${who}: ${cap}`);
        assert.equal(msg, "Typing here is not available yet.", `${who}: ${cap}`);
      }
    assert.deepEqual([sent.length, rows(), events()], before, "no host call, no hold row, no event");
    assert.equal((await call(hn, "terminal.workspace", { agentId: "agt_intake" })).takeOver, false, "the app is told");
    process.env["VYRE_TERMINAL_TAKEOVER"] = "1";
    assert.equal((await call(hn, "terminal.workspace", { agentId: "agt_intake" })).takeOver, true, "on with 1 too");
  } finally {
    if (was === undefined) delete process.env["VYRE_TERMINAL_TAKEOVER"];
    else process.env["VYRE_TERMINAL_TAKEOVER"] = was;
  }
});

test("a hold stored before the switch went off blocks no one: nothing reads as held and the agent's command runs", async () => {
  const { hn } = setup();
  const id = await open(hn);
  await call(hn, "terminal.take_over", { terminalId: id });
  assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, "usr_dana");
  const was = process.env["VYRE_TERMINAL_TAKEOVER"];
  process.env["VYRE_TERMINAL_TAKEOVER"] = "0";
  try {
    assert.equal((await call(hn, "terminal.get", { terminalId: id })).terminal.heldBy, undefined, "not shown as held");
    const r = await h["terminal.run"]!(hn.as(AGENT, "usr_dana"), {
      command: "echo hi",
      terminalId: id,
      idempotencyKey: "off-run",
    });
    assert.ok(r, "the agent's command is not refused");
  } finally {
    if (was === undefined) delete process.env["VYRE_TERMINAL_TAKEOVER"];
    else process.env["VYRE_TERMINAL_TAKEOVER"] = was;
  }
});
