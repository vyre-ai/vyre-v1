// @heavy docker
// Typing into an agent's terminal, on a booted daemon with a real workspace container (15 Nov, rc.29): a person takes the keyboard, types `echo one` in two batches with the FIRST batch SENT TWICE (the app retries a
// call whose answer was lost), and the terminal shows it once; a second person watching sees who is typing and cannot type; while the person types the agent's commands are refused; the person gives the keyboard
// back and the agent types again; every call is on the audit log as the person's. Needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./support/agentpc-world.ts";
import { as, join } from "./support/people.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON
  ? false
  : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (the workspace is a real container)";

test(
  "take over, type echo one in two batches with the first sent twice: it runs once; a watcher sees who types and cannot type; the agent waits, then types again after the give back; all audited as the person",
  { skip, timeout: 900_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    const ada = w.owner;
    const wes = await join(w.d, ada.call, "Admin", "wes", "Wes Wu");
    const watcher = as(w.d, wes.token);
    // the agent starts its own terminal first (its workspace is made here)
    const warm = await w.turn(ada, "once-warm", [{ cmd: "echo warm" }]);
    assert.equal(warm[0]!.text, "warm");
    const opened = await ada.call("terminal.open", {
      host: "agent_computer",
      agentId: w.agent,
      idempotencyKey: "once-open",
    });
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    const id = opened.data.terminal.terminalId as string;

    const took = await ada.call("terminal.take_over", { terminalId: id });
    assert.equal(took.status, 200, JSON.stringify(took.data));
    const { lease, nextSeq } = took.data as { lease: string; nextSeq: number };
    assert.equal(nextSeq, 1);
    const send = (who: typeof ada, seq: number, key: string, ks: unknown[], l = lease) =>
      who.call("terminal.keys", { terminalId: id, lease: l, seq, idempotencyKey: key, keys: ks, capture: true });

    // batch 1 SENT TWICE: the same key and number; the second is a repeat
    const first = await send(ada, 1, "once-a", [{ text: "echo o" }]);
    const again = await send(ada, 1, "once-a", [{ text: "echo o" }]);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.deepEqual(again.data, { ok: true }, "the repeat gets the first answer, without the screen");
    // a gap is refused and types nothing
    const gap = await send(ada, 5, "once-gap", [{ text: "XX" }]);
    assert.notEqual(gap.status, 200, "the gap is refused");
    assert.match(String(gap.data.error?.message ?? gap.data), /Some keys before these did not arrive/);
    // batch 2 finishes the line and presses Return
    const second = await send(ada, 2, "once-b", [{ text: "ne" }, { key: "Enter" }]);
    assert.equal(second.status, 200, JSON.stringify(second.data));
    await new Promise((r) => setTimeout(r, 800));
    const shot = await ada.call("terminal.capture", { terminalId: id });
    const text = String(shot.data.text);
    const lines = text.split("\n").map((l: string) => l.replace(/\s+$/, ""));
    console.log("SCREEN", JSON.stringify(lines.filter((l: string) => l !== "").slice(-6)));
    assert.equal(lines.filter((l: string) => /\becho one$/.test(l)).length, 1, "the command line is there once");
    assert.ok(!text.includes("echo oecho"), "the first batch was typed once");
    assert.equal(lines.filter((l: string) => l === "one").length, 1, "and it ran once");
    assert.ok(!text.includes("XX"), "the refused batch typed nothing");

    // a second person who works in a place of their own is told that the terminal is there and nothing of what it holds (rc.30, F30: a person's own terminal is theirs alone): not its name, not its folder, not
    // who has the keyboard (an earlier version of this walk expected heldBy here); and cannot type
    const listed = await watcher("terminal.list", { host: "agent_computer" });
    const row = (
      listed.data.terminals as Array<{
        terminalId: string;
        heldBy?: string;
        elsewhere?: boolean;
        name?: string;
        cwd?: string;
      }>
    ).find((x) => x.terminalId === id);
    assert.equal(row?.elsewhere, true, "the watcher is told it is someone else's");
    assert.equal(row?.heldBy, undefined, "and not who has the keyboard");
    assert.equal(row?.name, "Someone else's terminal");
    assert.equal(row?.cwd, "");
    const hijack = await watcher("terminal.keys", {
      terminalId: id,
      lease,
      seq: 3,
      idempotencyKey: "wes-1",
      keys: [{ text: "echo hijack" }],
    });
    assert.notEqual(hijack.status, 200, JSON.stringify(hijack.data));
    // the agent's own commands are refused while a person types
    const refused = await w.turn(ada, "once-agent-held", [{ cmd: "echo agent-held" }]);
    assert.equal(refused[0]!.ok, false);
    assert.match(refused[0]!.error ?? "", /typing in this computer's terminal/);

    // give back: the old lease types nothing, the late repeat of an applied batch types nothing, and the agent types again
    const back = await ada.call("terminal.give_back", { terminalId: id });
    assert.equal(back.status, 200, JSON.stringify(back.data));
    const late = await send(ada, 3, "once-late", [{ text: "echo late" }, { key: "Enter" }]);
    assert.notEqual(late.status, 200, "a batch after the give back is refused");
    assert.match(String(late.data.error?.message ?? late.data), /do not have the keyboard/);
    const lateRepeat = await send(ada, 1, "once-a", [{ text: "echo o" }]);
    assert.deepEqual(
      lateRepeat.data,
      { ok: true },
      "a late repeat is answered from the host's record (ok only, no screen) and types nothing",
    );
    const agent = await w.turn(ada, "once-agent-back", [{ cmd: "echo agent-types" }]);
    assert.equal(agent[0]!.text, "agent-types");
    const after = String((await ada.call("terminal.capture", { terminalId: id })).data.text);
    assert.ok(!after.includes("echo late"), "nothing typed after the give back reached the terminal");
    assert.equal(
      after.split("\n").filter((l) => l.replace(/\s+$/, "") === "one").length,
      1,
      "the repeat did not type it again",
    );

    // the audit log has the person's takes, keys and give back, as theirs
    const rows = (await ada.call("audit.list", { action: "terminal.keys" })).data.rows as Array<{
      principal?: unknown;
      actor?: unknown;
    }>;
    assert.ok(rows.length >= 2, `terminal.keys is on the audit log (${rows.length})`);
    for (const cap of ["terminal.take_over", "terminal.give_back"]) {
      const r = (await ada.call("audit.list", { action: cap })).data.rows as unknown[];
      assert.ok(r.length >= 1 && JSON.stringify(r).includes(w.owner.id), `${cap} is on the audit log as the person`);
    }
    assert.ok(JSON.stringify(rows).includes(w.owner.id), "as the person who typed");
    assert.ok(!JSON.stringify(rows).includes(w.agent), "never as the agent");
    assert.ok(
      rows.length >= 1 && !JSON.stringify(rows).includes("echo"),
      "a row exists and the typed text is not in it",
    );
  },
);

test(
  "a manager who uses the owner's agent from a place of their own is shown its terminal only as there and refused every door into it (F30, owner decision 27 Nov), and nothing is said in the chat; nobody else can type into, read or take the owner's own tab; a suspended holder gives the keyboard back (unit: keys.once.test.ts)",
  { skip, timeout: 900_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    const ada = w.owner;
    const wes = await join(w.d, ada.call, "Admin", "wes", "Wes Wu");
    const manager = as(w.d, wes.token);
    const warm = await w.turn(ada, "own-warm", [{ cmd: "echo warm" }]);
    assert.equal(warm[0]!.text, "warm");
    const chat = await ada.call("chat.start", { kind: "chat", agentIds: [w.agent], title: "Desk work" });
    assert.equal(chat.status, 200, JSON.stringify(chat.data));
    const threadId = chat.data.thread.threadId as string;
    // a manager (an Admin who uses the agent and so has a place of their own) is told that the agent's terminal is there and nothing of what it holds, and is refused every door into it: the agent's own terminals are
    // not theirs to look into whatever they manage (owner decision 27 Nov 2026, the wall of 15 Nov, F30; asker.test.ts pins the same). An admin who needs to step in stops or restarts the computer from the Console.
    const listed = (await manager("terminal.list", { host: "agent_computer" })).data.terminals as Array<{
      terminalId: string;
      agentId?: string;
      name: string;
      elsewhere?: boolean;
      by?: unknown;
    }>;
    const agentTerm = listed.find((x) => x.agentId === w.agent)!;
    assert.ok(agentTerm, JSON.stringify(listed));
    assert.equal(agentTerm.elsewhere, true, "told only that it is there");
    assert.equal(agentTerm.name, "Someone else's terminal");
    assert.equal(agentTerm.by, undefined, "not who opened it");
    for (const [cap, input] of [
      ["terminal.take_over", {}],
      ["terminal.keys", { lease: "lse_x", seq: 1, idempotencyKey: "mgr-keys", keys: [{ text: "echo no" }] }],
      ["terminal.input", { data: "echo no\n" }],
      ["terminal.capture", {}],
      ["terminal.stream", {}],
      ["terminal.attach", {}],
    ] as const) {
      const r = await manager(cap, { terminalId: agentTerm.terminalId, ...input });
      assert.notEqual(r.status, 200, `${cap}: ${JSON.stringify(r.data).slice(0, 200)}`);
      assert.equal(
        (r.data as { error?: { details?: { reason?: string } } }).error?.details?.reason,
        "not_yours",
        `${cap} is refused as not theirs`,
      );
    }
    await w.d.hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 500));
    await w.d.hooks?.pump?.();
    const lines = async (who: typeof ada.call): Promise<string[]> => {
      const r = await who("chat.messages.list", { threadId });
      return r.status === 200 ? (r.data.messages as Array<{ body?: string }>).map((m) => String(m.body ?? "")) : [];
    };
    assert.deepEqual(
      (await lines(ada.call)).filter((b) => /keyboard/.test(b)),
      [],
      "nothing was taken, nothing is said",
    );
    assert.deepEqual(
      (await lines(w.ben.call)).filter((b) => /keyboard/.test(b)),
      [],
      "nobody else reads any",
    );

    // item 6 probe: a person's own terminal, by its id
    const ownTab = (
      await ada.call("terminal.open", { host: "agent_computer", agentId: w.agent, idempotencyKey: "probe-own" })
    ).data.terminal.terminalId as string;
    for (const [who, call] of [
      ["a manager", manager],
      ["a member", w.ben.call],
    ] as const)
      for (const [cap, input] of [
        ["terminal.take_over", {}],
        ["terminal.keys", { lease: "lse_x", seq: 1, idempotencyKey: `p-${who}`, keys: [{ text: "echo hijack" }] }],
        ["terminal.capture", {}],
        ["terminal.input", { data: "echo hijack\n" }],
      ] as const) {
        const r = await call(cap, { terminalId: ownTab, ...input });
        assert.notEqual(
          r.status,
          200,
          `${who}: ${cap} on another person's own terminal: ${JSON.stringify(r.data).slice(0, 200)}`,
        );
      }
    const shot = String((await ada.call("terminal.capture", { terminalId: ownTab })).data.text);
    assert.ok(!shot.includes("hijack"), "nothing was typed into it");

    const agent = await w.turn(ada, "own-agent-after", [{ cmd: "echo agent-after" }]);
    assert.equal(agent[0]!.text, "agent-after");
  },
);
