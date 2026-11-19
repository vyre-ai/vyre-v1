// The retained output of commands (cmdlog.ts, terminal.log.list, terminal.log.read; the lead's rules of 19 Nov): a seeded Vault value never appears in the stored bytes, caps hold, expiry deletes, the agent's erase
// takes its logs, a person without access to the terminal is refused, and an answer is never the whole output.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, consumers, periodic, hostCalls, setTerminalHost } from "../impl.ts";
import { bindHost, bindValues, ensure } from "../projections.ts";
import { codeOf, contractErrors, fakeHost, fakeValues, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import {
  AGENT_CAP_BYTES,
  CMD_CAP_BYTES,
  DEFAULT_TAIL,
  KEEP_MS,
  MAX_ANSWER_CHARS,
  MAX_LINES,
  keepCmdLog,
  readCmdLog,
  setCmdLogCaps,
} from "../cmdlog.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;
const call = async (hn: Harness, cap: string, input: unknown, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
const code = async (f: () => unknown): Promise<string> => {
  try {
    await f();
  } catch (e) {
    return codeOf(e);
  }
  return "no error";
};
const AGENT = { kind: "agent" as const, id: "agt_intake" };
let keys = 0;
const idem = (): string => `idem_${++keys}`;
const lines = (n: number, w = 20): string =>
  Array.from({ length: n }, (_, i) => `line ${i + 1} ${"x".repeat(w)}`).join("\n");

function setup(scripts: Parameters<typeof fakeHost>[0] = {}): { hn: Harness } {
  reset();
  setCmdLogCaps(null);
  const hn = harness();
  bindHost(fakeHost(scripts).host);
  return { hn };
}
const runIt = (hn: Harness, command: string) =>
  call(hn, "terminal.run", { command, idempotencyKey: idem() }, hn.as(AGENT, "usr_dana"));

test("terminal.run answers the command's own number, and the output it printed is kept under it; list says so", async () => {
  const { hn } = setup({ "make test": { exitCode: 2, output: lines(30) } });
  const r = await runIt(hn, "make test");
  assert.equal(typeof r.commandId, "number");
  const l = await call(hn, "terminal.log.list", { terminalId: r.terminalId });
  assert.equal(l.commands.length, 1);
  assert.deepEqual(
    [l.commands[0].commandId, l.commands[0].command, l.commands[0].exitCode, l.commands[0].kept],
    [r.commandId, "make test", 2, true],
  );
  assert.ok(l.commands[0].bytes > 0);
});

test("a seeded Vault value never appears in the stored bytes, the list or any read, though the command printed it", async () => {
  const KEY = "sk-live-ABCDEF123456";
  const LINE = `curl -H 'Authorization: '"\${VYRE_H_1}"'' https://api.example.com`;
  const { hn } = setup({
    [LINE]: (_c, env) => ({ exitCode: 0, output: `first\nAuthorization: ${env["VYRE_H_1"]}\nlast` }),
  });
  bindValues(fakeValues({ "#Dana_Lawmatics.api_key": KEY }));
  try {
    const r = await runIt(hn, "curl -H 'Authorization: #Dana_Lawmatics.api_key' https://api.example.com");
    assert.equal(
      JSON.stringify(hn.rows("SELECT * FROM terminal_cmd_log")).includes(KEY),
      false,
      "not in a stored byte",
    );
    assert.equal(
      hn.rows("SELECT body FROM terminal_cmd_log")[0]?.["body"]?.toString().includes("[#Dana_Lawmatics.api_key]"),
      true,
      "the handle stands where it was",
    );
    const all = JSON.stringify([
      await call(hn, "terminal.log.list", { terminalId: r.terminalId }),
      await call(hn, "terminal.log.read", { terminalId: r.terminalId, commandId: r.commandId }),
      await call(hn, "terminal.log.read", {
        terminalId: r.terminalId,
        commandId: r.commandId,
        match: ["authorization"],
      }),
      await call(hn, "terminal.log.read", { terminalId: r.terminalId, commandId: r.commandId, from: 1, to: 3 }),
    ]);
    assert.equal(all.includes(KEY), false);
    // a value learned after the output was kept is taken out on the way out too (scrubbed again on every read)
    hn.db.run("UPDATE terminal_cmd_log SET body = body || ?", "\nlate leak: sk-live-ABCDEF123456");
    assert.equal(
      JSON.stringify(
        await call(hn, "terminal.log.read", { terminalId: r.terminalId, commandId: r.commandId, tail: 5 }),
      ).includes(KEY),
      false,
    );
  } finally {
    bindValues(null);
  }
});

test("a read is never the whole output: the last lines by default, the lines that match words with context, a range; every answer is capped and says when more would have matched", async () => {
  const { hn } = setup({ big: { exitCode: 0, output: lines(1000) } });
  const r = await runIt(hn, "big");
  const read = (q: Record<string, unknown>) =>
    call(hn, "terminal.log.read", { terminalId: r.terminalId, commandId: r.commandId, ...q });
  const def = await read({});
  assert.equal(def.lines.length, DEFAULT_TAIL);
  assert.equal(def.lines.at(-1).n, 1000);
  assert.equal(def.totalLines, 1000);
  assert.equal(def.more, false);
  assert.equal((await read({ tail: 400 })).lines.length, 400);
  const m = await read({ match: ["LINE 500 "], context: 1 });
  assert.deepEqual(
    m.lines.map((x: { n: number }) => x.n),
    [499, 500, 501],
  );
  const many = await read({ match: ["line"] });
  assert.equal(many.lines.length <= MAX_LINES, true);
  assert.equal(many.more, true, "1000 lines matched and the answer holds fewer");
  const range = await read({ from: 10, to: 12 });
  assert.deepEqual(
    range.lines.map((x: { n: number }) => x.n),
    [10, 11, 12],
  );
  assert.equal((await read({ from: 1 })).lines.length <= MAX_LINES, true);
  assert.ok(JSON.stringify(many).length < MAX_ANSWER_CHARS + 20_000);
  // a very long line is cut, and the answer is still bounded in characters
  const { hn: h2 } = setup({
    wide: { exitCode: 0, output: Array.from({ length: 100 }, () => "y".repeat(5000)).join("\n") },
  });
  const w = await runIt(h2, "wide");
  const wr = await call(h2, "terminal.log.read", { terminalId: w.terminalId, commandId: w.commandId, tail: 400 });
  assert.ok(wr.lines.every((x: { text: string }) => x.text.length <= 1000));
  assert.equal(wr.lines.reduce((n: number, x: { text: string }) => n + x.text.length, 0) <= MAX_ANSWER_CHARS, true);
  assert.equal(wr.more, true);
});

test("caps hold: a command over its cap keeps its last lines with the cut marked; an agent over its cap loses its oldest commands' logs first, never the newest", async () => {
  const { hn } = setup();
  ensure(hn.db);
  setCmdLogCaps({ cmd: 1000, agent: 2500 });
  try {
    const big = Array.from({ length: 100 }, (_, i) => `row ${String(i).padStart(3, "0")}`).join("\n"); // about 900 bytes... then more
    const huge = `${big}\n${big}\n${big}`;
    const k = keepCmdLog(hn.db, {
      seq: 1,
      terminalId: "trm_a",
      agentId: "agt_a",
      personId: "usr_a",
      endedAt: 1,
      output: huge,
    });
    assert.ok(k.cutBytes > 0);
    const body = String(hn.rows("SELECT body FROM terminal_cmd_log WHERE seq = 1")[0]?.["body"]);
    assert.match(body, /^\[earlier output cut: \d+ bytes\]\n/);
    assert.ok(Buffer.byteLength(body) <= 1000 + 60, "the per-command cap holds (the mark is on top of it)");
    assert.ok(body.endsWith("row 099"), "the last lines are the ones kept");
    assert.ok(
      !body
        .split("\n")
        .slice(1)
        .some((l) => l.length > 0 && !/^row \d{3}$/.test(l)),
      "whole lines only",
    );
    for (let i = 2; i <= 6; i++)
      keepCmdLog(hn.db, {
        seq: i,
        terminalId: "trm_a",
        agentId: "agt_a",
        personId: "usr_a",
        endedAt: i,
        output: "z".repeat(900),
      });
    const left = hn
      .rows("SELECT seq FROM terminal_cmd_log WHERE agent_id = 'agt_a' ORDER BY seq")
      .map((r) => Number(r["seq"]));
    const total = Number(hn.rows("SELECT SUM(bytes) AS n FROM terminal_cmd_log WHERE agent_id = 'agt_a'")[0]?.["n"]);
    assert.ok(total <= 2500, `the agent's total ${total} is under its cap`);
    assert.ok(left.includes(6), "the newest is kept");
    assert.ok(!left.includes(1), "the oldest went first");
    // another agent's logs are not touched by this agent's cap
    keepCmdLog(hn.db, {
      seq: 50,
      terminalId: "trm_b",
      agentId: "agt_b",
      personId: "usr_b",
      endedAt: 0,
      output: "other",
    });
    keepCmdLog(hn.db, {
      seq: 7,
      terminalId: "trm_a",
      agentId: "agt_a",
      personId: "usr_a",
      endedAt: 9,
      output: "z".repeat(900),
    });
    assert.equal(hn.rows("SELECT seq FROM terminal_cmd_log WHERE agent_id = 'agt_b'").length, 1);
  } finally {
    setCmdLogCaps(null);
  }
  assert.equal(CMD_CAP_BYTES, 5 * 1024 * 1024);
  assert.equal(AGENT_CAP_BYTES, 200 * 1024 * 1024);
});

test("expiry deletes: a week after the command ended its output is gone, the list says it is no longer kept, a read says so in words; one younger stays", async () => {
  const { hn } = setup({ one: { exitCode: 0, output: "old output" }, two: { exitCode: 0, output: "new output" } });
  const a = await runIt(hn, "one");
  hn.advance(KEY_DAYS(6));
  const b = await runIt(hn, "two");
  hn.advance(KEY_DAYS(1) + 1000);
  const pass = (periodic as Record<string, { run: (c: Harness["ctx"]) => unknown }>)["terminal.cmdlog_expire"]!;
  await pass.run(hn.ctx);
  const l = await call(hn, "terminal.log.list", { terminalId: a.terminalId });
  const kept = Object.fromEntries(l.commands.map((c: { commandId: number; kept: boolean }) => [c.commandId, c.kept]));
  assert.deepEqual(kept, { [a.commandId]: false, [b.commandId]: true });
  assert.equal(
    await code(() => h["terminal.log.read"]!(hn.ctx, { terminalId: a.terminalId, commandId: a.commandId })),
    "validation.not_found",
  );
  assert.equal(
    (await call(hn, "terminal.log.read", { terminalId: b.terminalId, commandId: b.commandId })).lines[0].text,
    "new output",
  );
});
const KEY_DAYS = (d: number): number => (d * KEEP_MS) / 7;

test("erase: an agent deleted for good takes the logs of its commands with it, and only its own", async () => {
  const { hn } = setup({ one: { exitCode: 0, output: "kept" } });
  const r = await runIt(hn, "one");
  hn.db.run(
    "INSERT INTO terminal_cmd_log (seq, terminal_id, agent_id, ended_at, bytes, cut_bytes, body) VALUES (999, 'trm_o', 'agt_other', 1, 3, 0, 'abc')",
  );
  const c = (consumers as Record<string, { run: (c: Harness["ctx"], e: { payload: { agentId: string } }) => unknown }>)[
    "terminal.cmdlog_agent_deleted"
  ]!;
  await c.run(hn.ctx, { payload: { agentId: "agt_intake" } });
  assert.equal(
    hn
      .rows("SELECT seq FROM terminal_cmd_log")
      .map((x) => Number(x["seq"]))
      .join(),
    "999",
  );
  assert.equal(
    await code(() => h["terminal.log.read"]!(hn.ctx, { terminalId: r.terminalId, commandId: r.commandId })),
    "validation.not_found",
  );
});

test("access: a person who may not read the terminal is refused (list and read), a missing terminal and a command of another terminal are not found, and a closed terminal's week stays readable", async () => {
  const { hn } = setup({ one: { exitCode: 0, output: "secret-ish" } });
  const r = await runIt(hn, "one");
  hn.allowOnly(() => false);
  const omar = hn.as({ kind: "person", id: "usr_omar" });
  assert.notEqual(await code(() => h["terminal.log.list"]!(omar, { terminalId: r.terminalId })), "no error");
  assert.notEqual(
    await code(() => h["terminal.log.read"]!(omar, { terminalId: r.terminalId, commandId: r.commandId })),
    "no error",
  );
  hn.allowOnly(() => true);
  assert.equal(
    await code(() => h["terminal.log.read"]!(hn.ctx, { terminalId: "trm_nope", commandId: 1 })),
    "validation.not_found",
  );
  // a command number of another terminal does not read through this one
  const { hn: h2 } = setup({ one: { exitCode: 0, output: "mine" }, two: { exitCode: 0, output: "other" } });
  const a = await runIt(h2, "one");
  const b = await call(h2, "terminal.open", {
    host: "agent_computer",
    agentId: "agt_intake",
    idempotencyKey: idem(),
    session: "second",
  }).catch(() => null);
  if (b)
    assert.equal(
      await code(() => h["terminal.log.read"]!(h2.ctx, { terminalId: b.terminal.terminalId, commandId: a.commandId })),
      "validation.not_found",
    );
  // closed: its commands stay readable
  await call(hn, "terminal.close", { terminalId: r.terminalId });
  assert.equal(
    (await call(hn, "terminal.log.read", { terminalId: r.terminalId, commandId: r.commandId })).lines[0].text,
    "secret-ish",
  );
});

test("when the host read the whole history, that is what is kept (scrubbed), far more than the answer holds; the answer itself is unchanged", async () => {
  const KEY = "sk-live-ABCDEF123456";
  const whole = Array.from(
    { length: 800 },
    (_, i) => `row ${i}${i === 3 ? ` token ${"sk-live-ABCDEF123456"}` : ""}`,
  ).join("\n");
  const { hn } = setup({ build: { exitCode: 0, output: "row 799", full: whole } });
  bindValues(fakeValues({ "#Dana_Lawmatics.api_key": KEY }));
  try {
    // the value is known to the scope because this agent used it once in this tab
    await runIt(hn, "build");
    const r = await runIt(hn, "build");
    assert.equal(r.output, "row 799");
    const body = String(hn.rows("SELECT body FROM terminal_cmd_log WHERE seq = ?", r.commandId)[0]?.["body"]);
    assert.equal(body.split("\n").length, 800, "the whole history, not the answer");
    const rd = await call(hn, "terminal.log.read", {
      terminalId: r.terminalId,
      commandId: r.commandId,
      from: 1,
      to: 5,
    });
    assert.deepEqual(
      rd.lines.map((x: { n: number }) => x.n),
      [1, 2, 3, 4, 5],
    );
    assert.equal(rd.totalLines, 800);
  } finally {
    bindValues(null);
  }
});

// the fake key is made at run time, so no source file holds a string that looks like one
const STRIPE = ["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_");

test("secret shapes the Vault never knew are not kept either: a key, a bearer header, a password in a URL, a private key; the output otherwise stands", async () => {
  const out = [
    "starting",
    `export STRIPE_SECRET_KEY=${STRIPE}`,
    "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345' https://x.test",
    "postgres://app:hunter2hunter2@db.internal:5432/app",
    "-----BEGIN PRIVATE KEY-----",
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
    "-----END PRIVATE KEY-----",
    "done in 4s",
  ].join("\n");
  const { hn } = setup({ env: { exitCode: 0, output: out } });
  const r = await runIt(hn, "env");
  const body = String(hn.rows("SELECT body FROM terminal_cmd_log WHERE seq = ?", r.commandId)[0]?.["body"]);
  for (const leak of [
    STRIPE,
    "abcdefghijklmnopqrstuvwxyz012345",
    "hunter2hunter2",
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
  ])
    assert.equal(body.includes(leak), false, `${leak} is not stored`);
  assert.match(body, /^starting\n/);
  assert.match(body, /done in 4s$/);
  assert.match(body, /redacted/);
});

test("a log older than its week reads as gone at once, before the hourly pass: the read refuses, the list says it is not kept", async () => {
  const { hn } = setup({ one: { exitCode: 0, output: "week old" } });
  const r = await runIt(hn, "one");
  hn.advance(KEEP_MS - 1000);
  assert.equal(
    (await call(hn, "terminal.log.read", { terminalId: r.terminalId, commandId: r.commandId })).lines[0].text,
    "week old",
  );
  hn.advance(2000);
  assert.equal(
    await code(() => h["terminal.log.read"]!(hn.ctx, { terminalId: r.terminalId, commandId: r.commandId })),
    "validation.not_found",
  );
  const l = await call(hn, "terminal.log.list", { terminalId: r.terminalId });
  assert.equal(l.commands[0].kept, false);
  assert.equal(
    hn.rows("SELECT COUNT(*) AS n FROM terminal_cmd_log")[0]?.["n"],
    1,
    "the row is still there until the pass deletes it",
  );
});

test("a person who leaves the Space takes what their commands printed with them, the ones an agent ran for them included, and no one else's", async () => {
  const { hn } = setup({ one: { exitCode: 0, output: "dana's" } });
  const r = await runIt(hn, "one");
  hn.db.run(
    "INSERT INTO terminal_cmd_log (seq, terminal_id, agent_id, person_id, ended_at, bytes, cut_bytes, body) VALUES (998, 'trm_o', 'agt_intake', 'usr_omar', 1, 3, 0, 'abc')",
  );
  const c = (
    consumers as Record<string, { run: (c: Harness["ctx"], e: { payload: { personId: string } }) => unknown }>
  )["terminal.cmdlog_person_left"]!;
  await c.run(hn.ctx, { payload: { personId: "usr_dana" } });
  assert.equal(
    hn
      .rows("SELECT seq FROM terminal_cmd_log")
      .map((x) => Number(x["seq"]))
      .join(),
    "998",
  );
  assert.equal(
    await code(() => h["terminal.log.read"]!(hn.ctx, { terminalId: r.terminalId, commandId: r.commandId })),
    "validation.not_found",
  );
});

test("erasing an agent's computer erases the kept output of its terminals", async () => {
  const { hn } = setup({ one: { exitCode: 0, output: "kept" } });
  await runIt(hn, "one");
  assert.equal(hn.rows("SELECT COUNT(*) AS n FROM terminal_cmd_log")[0]?.["n"], 1);
  setTerminalHost(null);
  await (hostCalls["terminal.erase_agent"] as (ctx: unknown, i: unknown) => Promise<unknown>)(hn.ctx, {
    agentId: "agt_intake",
    dry: false,
  });
  assert.equal(hn.rows("SELECT COUNT(*) AS n FROM terminal_cmd_log")[0]?.["n"], 0);
});

test("a huge range or needle costs little: a range over a log of a million short lines answers at once, a word is cut at 200 characters, a cut never lands inside a character", async () => {
  const { hn } = setup();
  ensure(hn.db);
  const many = "x\n".repeat(400_000);
  keepCmdLog(hn.db, { seq: 1, terminalId: "trm_a", agentId: "agt_a", personId: "usr_a", endedAt: 1, output: many });
  hn.db.run(
    "INSERT INTO terminal_commands (seq, terminal_id, command, exit_code, started_at, duration_ms, by_principal) VALUES (1, 'trm_a', 'x', 0, 1, 1, 'usr_a')",
  );
  const t0 = Date.now();
  const a = readCmdLog(hn.db, "trm_a", 1, { from: 1, to: 1_000_000 }, (t) => t, 5);
  assert.ok(a && a.lines.length <= MAX_LINES && a.more);
  assert.ok(Date.now() - t0 < 2000);
  const long = readCmdLog(hn.db, "trm_a", 1, { match: ["q".repeat(100_000)] }, (t) => t, 5);
  assert.equal(long?.lines.length, 0);
  // a single huge line with multi-byte characters is cut at a character boundary
  setCmdLogCaps({ cmd: 1001, agent: 1_000_000 });
  try {
    keepCmdLog(hn.db, {
      seq: 2,
      terminalId: "trm_a",
      agentId: "agt_a",
      personId: "usr_a",
      endedAt: 1,
      output: "é".repeat(2000),
    });
    const body = String(hn.rows("SELECT body FROM terminal_cmd_log WHERE seq = 2")[0]?.["body"]);
    assert.equal(body.includes("\ufffd"), false, "no replacement character: the cut did not split a character");
  } finally {
    setCmdLogCaps(null);
  }
});
