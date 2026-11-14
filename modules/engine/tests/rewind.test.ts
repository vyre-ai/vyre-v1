// Rewind (chat gap G36, G37): the points of a private chat, going back, and what it refuses. Real git in a temporary data folder; the chat's reads stand in.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harness } from "../fixtures/harness.ts";
import { checkpointTurn } from "../checkpoints.ts";
import { pointsIn, rewindIn } from "../handlers/rewind.ts";
import { workFolder } from "../sandbox.ts";
import { ensure } from "../projections.ts";

const T = "thr_rw";
const AGENT = "agt_dex";
const DANA = "usr_dana";
const BASE = 1_700_000_000_000;

function setup(o: { members?: string[]; kind?: string } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "rewind-"));
  const h = harness();
  ensure(h.ctx.db);
  const ctx = {
    ...h.ctx,
    async call(cap: string) {
      if (cap === "threads.get")
        return {
          thread: {
            kind: o.kind ?? "chat",
            members: (o.members ?? [DANA]).map((id) => ({ id })),
            agents: [{ agentId: AGENT }],
          },
        };
      if (cap === "chat.messages.list")
        return { messages: [{ author: { id: DANA }, body: "Please add the uploads folder", createdAt: BASE + 500 }] };
      throw new Error(`unexpected ${cap}`);
    },
  };
  return { data, h, ctx };
}

test("points list a turn each, named by what the person had just asked; going back restores the folder and records the hidden range", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await checkpointTurn({
      dataDir: s.data,
      person: DANA,
      thread: T,
      agent: AGENT,
      turnId: "trn_1",
      now: BASE + 2_000,
    });
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    fs.writeFileSync(path.join(dir, "b.txt"), "new");
    await checkpointTurn({
      dataDir: s.data,
      person: DANA,
      thread: T,
      agent: AGENT,
      turnId: "trn_2",
      now: BASE + 3_000,
    });
    const listed = await pointsIn(s.ctx, { threadId: T }, s.data);
    assert.equal(listed.available, true);
    assert.equal(listed.points.length, 2);
    assert.equal(listed.points[0]!.at, BASE + 3_000, "newest first");
    assert.equal(listed.points[1]!.after, "Please add the uploads folder");
    fs.writeFileSync(path.join(dir, "a.txt"), "three");
    const done = await rewindIn(
      s.ctx,
      { threadId: T, pointId: listed.points[1]!.pointId, afterSeq: 4, uptoSeq: 9 },
      s.data,
    );
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one");
    assert.equal(fs.existsSync(path.join(dir, "b.txt")), false);
    assert.deepEqual([done.restored >= 1, done.removed], [true, 1]);
    const rows = s.h.rows("SELECT after_seq, upto_seq, by_person FROM engine_rewind WHERE thread_id = ?", T);
    assert.deepEqual(rows, [{ after_seq: 4, upto_seq: 9, by_person: DANA }]);
    // the rewind is undone through the point it took first
    await rewindIn(s.ctx, { threadId: T, pointId: done.undoPointId, afterSeq: 4, uptoSeq: 9 }, s.data);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "three");
  } finally {
    fs.rmSync(s.data, { recursive: true, force: true });
  }
});

test("off in a chat with other people and outside a chat with an agent; a point of someone else's folder is not found; an agent cannot go back", async () => {
  const group = setup({ members: [DANA, "usr_maya"] });
  const chan = setup({ kind: "channel" });
  const solo = setup();
  try {
    assert.deepEqual(await pointsIn(group.ctx, { threadId: T }, group.data), {
      available: false,
      why: "group",
      points: [],
    });
    assert.equal((await pointsIn(chan.ctx, { threadId: T }, chan.data)).why, "not_a_chat");
    await assert.rejects(
      rewindIn(group.ctx, { threadId: T, pointId: `${AGENT}.${"a".repeat(40)}`, afterSeq: 0, uptoSeq: 1 }, group.data),
      /off in a chat/,
    );
    await assert.rejects(
      rewindIn(solo.ctx, { threadId: T, pointId: `${AGENT}.${"a".repeat(40)}`, afterSeq: 0, uptoSeq: 1 }, solo.data),
      /not in this chat/,
    );
    await assert.rejects(
      rewindIn(solo.ctx, { threadId: T, pointId: "../../etc", afterSeq: 0, uptoSeq: 1 }, solo.data),
      /not in this chat/,
    );
    const asAgent = { ...solo.ctx, principal: { kind: "agent" as const, id: AGENT } };
    await assert.rejects(pointsIn(asAgent, { threadId: T }, solo.data), /Only a person/);
  } finally {
    for (const w of [group, chan, solo]) fs.rmSync(w.data, { recursive: true, force: true });
  }
});
