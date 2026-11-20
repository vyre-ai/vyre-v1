// Memory learning for a member whose chats run on their own computer through a CLI subscription (#875), on two real daemons: a Team Space server and Olivia's computer, linked over the private link,
// with the fake claude on it answering the one-shot. Proved: the learning one-shot starts on her computer and not on the server, it does not wait for a turn that is being placed, the pass
// with her computer stopped is skipped and nothing runs on the server, and her next turn is not delayed by a pass.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bootDevice,
  bootSpace,
  hostLog,
  hostSpawns,
  makeAgent,
  MAC,
  replyAfter,
  send,
  startChat,
  waitFor,
} from "./support/runson.ts";

test(
  "the learning pass for a member on a CLI subscription runs on her computer, never waits for or delays a turn, and once the computer is gone the server takes the pass as it takes her turns",
  { timeout: 120_000 },
  async () => {
    const s = await bootSpace();
    const SLOW_MS = 6000; // the slow turn's own time on her computer: long enough that a pass which does not wait returns well inside it, even on a loaded runner
    const mac = await bootDevice({ slowMs: SLOW_MS });
    try {
      const agentId = await makeAgent(s.d, "Learner");
      await mac.link(s);
      const threadId = await startChat(s, agentId, "ml-1");
      const accounts = (await s.as(MAC, "engine.accounts.list", {})).data.accounts as Array<{
        ref: string;
        driver: string;
        kind: string;
      }>;
      const acct = accounts.find((a) => a.driver === "claude_code");
      assert.ok(acct, JSON.stringify(accounts));
      const account = { ref: acct.ref, driver: acct.driver, kind: acct.kind, payer: "usr_olivia" };
      const learn = (key: string) =>
        s.as(MAC, "memory.capture", { threadId, reason: "turn", agentId, account, idempotencyKey: key });

      // 1. a turn, then the pass the turn starts by itself: its one-shot starts on her computer (the turn's engine and the pass's make two processes there), the server starts nothing
      // (the time a plain turn takes here is measured: the later bounds scale with it, so a loaded runner moves them and a real slow-down does not)
      const plainStart = Date.now();
      assert.equal(
        await replyAfter(s, threadId, await send(s, threadId, agentId, "I prefer short replies.\nwhereami", "ml-t1")),
        "ran-on=device handover=no",
        hostLog(s.d),
      );
      const plainMs = Date.now() - plainStart;
      const slack = Math.max(4000, 6 * plainMs);
      await waitFor(
        async () => (mac.spawns.length >= 2 ? true : null),
        15_000,
        () => hostLog(s.d),
      );
      assert.equal(await hostSpawns(s), 0, "the server started no engine process, for the turn or for the pass");

      // 2. a slow turn is mid-flight on her computer: a pass started now does not wait for it, and the turn is not slowed by it
      const base = Date.now();
      const turnAt = await send(s, threadId, agentId, "I prefer plain text.\nslowwhere", "ml-t2");
      let turnDoneAt: number | undefined;
      const turnReply = replyAfter(s, threadId, turnAt).then((r) => {
        turnDoneAt = Date.now();
        return r;
      });
      await new Promise<void>((r) => setTimeout(r, 300));
      const t0 = Date.now();
      const pass = learn("ml-l2");
      const passed = await pass;
      assert.equal(
        (passed.data as { via?: string }).via,
        "model",
        `a pass started while the slow turn was running ran its model request on her computer: ${JSON.stringify(passed.data)}`,
      );
      // it did not wait for the turn: the pass came back while the slow turn was still running (an order, not a clock: a loaded runner slows both)
      assert.equal(
        turnDoneAt,
        undefined,
        `the pass returned only after the slow turn had finished (the pass took ${Date.now() - t0} ms, the turn's own time is ${SLOW_MS} ms)`,
      );
      const reply = await turnReply;
      const turnMs = Date.now() - base;
      assert.match(reply, /ran-on=device handover=no$/);
      assert.ok(
        turnMs < SLOW_MS + slack,
        `the slow turn (${SLOW_MS} ms of its own) finished in ${turnMs} ms with a pass running beside it (allowed ${SLOW_MS + slack})`,
      );
      assert.ok(Date.now() - t0 < 25_000);
      // her next turn, right after: as fast as a turn is
      const t1 = Date.now();
      assert.equal(
        await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "ml-t3")),
        "ran-on=device handover=no",
      );
      assert.ok(
        Date.now() - t1 < slack,
        `the next turn took ${Date.now() - t1} ms (a plain turn took ${plainMs} ms here, allowed ${slack})`,
      );

      // 3. her computer stops (the Space still lists it for a moment): the pass is skipped and nothing runs on the server
      const spaceSpawns = await hostSpawns(s);
      await mac.stop();
      const said = await s.as(MAC, "chat.post", { threadId, body: "I prefer tea.", idempotencyKey: "ml-stop" });
      assert.equal(said.status, 200, JSON.stringify(said.data));
      const stopped = await learn("ml-l3");
      assert.equal(stopped.status, 200, `learning is never an error: ${JSON.stringify(stopped.data)}`);
      const via = (stopped.data as { via?: string }).via;
      // The message that gave the pass something to read also starts her turn, and the turn is placed a moment after the pass answers. Reading the count the instant the pass returned saw
      // "pass via model, 1 server processes" on a busy runner: the pass's process was there and the turn's was still on its way. So wait for the processes this outcome must have, then look once
      // more after a short settle so one too many is still caught.
      const want = via === "rules" ? 1 : via === "model" ? 2 : -1;
      assert.notEqual(want, -1, `the pass answered via ${via}`);
      await waitFor(
        async () => ((await hostSpawns(s)) - spaceSpawns >= want ? true : null),
        15_000,
        () => hostLog(s.d),
      );
      await new Promise<void>((r) => setTimeout(r, 400));
      const onServer = (await hostSpawns(s)) - spaceSpawns;
      process.stdout.write(
        `# step3 computer stopped: pass via ${via}, engine processes the server started for it ${onServer}\n`,
      );
      // Two honest outcomes, and no third. While the Space still lists the stopped computer as hers, the pass is refused (engine.device_off) and the rules learn, with nothing on the server (the
      // routing test in modules/engine/tests/node-turns.test.ts holds that case exactly). Once the Space has dropped it, her chats run on the server again and so does the pass, on her own account,
      // as her turns do (test/runson.device.live.test.ts). It never runs on the server while her chats still run on the computer.
      // (the message that gave the pass something to read also starts her turn, which the server now takes: one process of its own)
      assert.ok(
        (via === "rules" && onServer === 1) || (via === "model" && onServer === 2),
        `pass via ${via}, ${onServer} server processes`,
      );
    } finally {
      const quit = (p: Promise<unknown>) =>
        Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
      await quit(mac.stop());
      await quit(s.stop());
    }
  },
);
