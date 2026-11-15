// Rewind and a turn on the person's own computer (review of 15 Nov): the turn's engine runs on her linked computer, so the server's folder holds nothing of it. No point is taken for it, none is offered, and the
// card is told the one line. Two real daemons: a Space server and Olivia's computer (test/support/runson.ts). A turn run on the server in the same chat takes its point as before.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MAC, bootDevice, bootSpace, hostLog, makeAgent, replyAfter, send, startChat } from "./support/runson.ts";
import { OWN_COMPUTER } from "../apps/app/src/places/chats/rewind/model.ts";

test(
  "a turn on her own computer takes no point and offers none; the card says why; after the computer is gone, a turn on the server takes one",
  { timeout: 90_000 },
  async () => {
    const s = await bootSpace();
    const mac = await bootDevice();
    try {
      const agentId = await makeAgent(s.d, "Placer");
      await mac.link(s);
      const threadId = await startChat(s, agentId, "rd-dev");
      assert.equal(
        (await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data.placement,
        "device",
        hostLog(s.d),
      );
      assert.equal(
        await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "rd-1")),
        "ran-on=device handover=no",
      );
      const points = (await s.as(MAC, "engine.rewind.points", { threadId })).data as {
        available: boolean;
        ownComputer: boolean;
        points: unknown[];
      };
      assert.deepEqual(
        [points.available, points.ownComputer, points.points.length],
        [true, true, 0],
        JSON.stringify(points),
      );
      const store = path.join(s.dir, "checkpoints");
      assert.equal(
        fs.existsSync(store)
          ? fs.readdirSync(store, { recursive: true }).filter((f) => String(f).endsWith(".git")).length
          : 0,
        0,
        "no store was made for it",
      );
      assert.match(OWN_COMPUTER, /own computer cannot be gone back to here/);
      // her computer goes away: the next turn runs on the server and takes its point
      await mac.unlink();
      assert.equal(
        await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "rd-2")),
        "ran-on=space handover=no",
        hostLog(s.d),
      );
      const after = (await s.as(MAC, "engine.rewind.points", { threadId })).data as {
        ownComputer: boolean;
        points: unknown[];
      };
      assert.equal(after.ownComputer, false);
      assert.ok(after.points.length >= 1, "a turn on the server has a point");
    } finally {
      await mac.stop();
      await s.stop();
    }
  },
);
