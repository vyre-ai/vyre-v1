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
    assert.deepEqual(again.data, first.data, "the repeat gets the first answer");
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

    // a second person watching sees who is typing, and cannot type
    const listed = await watcher("terminal.list", { host: "agent_computer" });
    const row = (listed.data.terminals as Array<{ terminalId: string; heldBy?: string }>).find(
      (x) => x.terminalId === id,
    );
    assert.equal(row?.heldBy, w.owner.id, "the watcher sees who has the keyboard");
    const hijack = await watcher("terminal.keys", {
      terminalId: id,
      lease,
      seq: 3,
      idempotencyKey: "wes-1",
      keys: [{ text: "echo hijack" }],
    });
    assert.equal(hijack.status, 422, JSON.stringify(hijack.data));
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
    assert.equal(lateRepeat.status, 200, "a repeat of an applied batch is answered");
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
  },
);
