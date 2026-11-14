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
        return { messages: [{ messageId: "msg_ask1", author: { id: DANA }, body: "Please add the uploads folder" }] };
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
      messageId: "msg_ask1",
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
    // the rewind is undone through the point it took first, which the card now lists; its hidden range is removed
    const withUndo = await pointsIn(s.ctx, { threadId: T }, s.data);
    assert.ok(withUndo.points.some((p) => p.undo === true && p.pointId === done.undoPointId), "the undo point is offered");
    const undone = await rewindIn(s.ctx, { threadId: T, pointId: done.undoPointId, afterSeq: 4, uptoSeq: 9 }, s.data);
    assert.equal(undone.undid, true);
    assert.deepEqual(s.h.rows("SELECT after_seq FROM engine_rewind WHERE thread_id = ?", T), [], "the messages are read again");
    assert.ok(!(await pointsIn(s.ctx, { threadId: T }, s.data)).points.some((p) => p.undo === true), "an undone rewind offers no undo");
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

test("two askers: a person's points are their own folder's only; another person's point id is not found, and their files are never touched", async () => {
  const s = setup();
  try {
    const maya = "usr_maya";
    const mine = workFolder(s.data, DANA, T, AGENT);
    const hers = workFolder(s.data, maya, T, AGENT);
    fs.writeFileSync(path.join(mine, "a.txt"), "dana-1");
    fs.writeFileSync(path.join(hers, "a.txt"), "maya-1");
    await checkpointTurn({ dataDir: s.data, person: DANA, thread: T, agent: AGENT, turnId: "trn_d", now: BASE + 1_000 });
    await checkpointTurn({ dataDir: s.data, person: maya, thread: T, agent: AGENT, turnId: "trn_m", now: BASE + 1_500 });
    const d = await pointsIn(s.ctx, { threadId: T }, s.data);
    const m = await pointsIn({ ...s.ctx, principal: { kind: "person", id: maya } }, { threadId: T }, s.data);
    assert.equal(d.points.length, 1);
    assert.equal(m.points.length, 1);
    assert.notEqual(d.points[0]!.pointId, m.points[0]!.pointId);
    fs.writeFileSync(path.join(mine, "a.txt"), "dana-2");
    fs.writeFileSync(path.join(hers, "a.txt"), "maya-2");
    // Dana tries Maya's point: not found, nothing changes for either
    await assert.rejects(rewindIn(s.ctx, { threadId: T, pointId: m.points[0]!.pointId, afterSeq: 0, uptoSeq: 1 }, s.data), /not in this chat/);
    assert.equal(fs.readFileSync(path.join(hers, "a.txt"), "utf8"), "maya-2");
    // Dana's own rewind never reaches Maya's folder
    await rewindIn(s.ctx, { threadId: T, pointId: d.points[0]!.pointId, afterSeq: 0, uptoSeq: 1 }, s.data);
    assert.equal(fs.readFileSync(path.join(mine, "a.txt"), "utf8"), "dana-1");
    assert.equal(fs.readFileSync(path.join(hers, "a.txt"), "utf8"), "maya-2", "Maya's files were not touched");
  } finally {
    fs.rmSync(s.data, { recursive: true, force: true });
  }
});

test("a point that was pruned is not offered and cannot be gone back to", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "1");
    await checkpointTurn({ dataDir: s.data, person: DANA, thread: T, agent: AGENT, turnId: "trn_old", now: 1_000, waitMs: 5000 });
    const gone = (await pointsIn(s.ctx, { threadId: T }, s.data)).points;
    assert.equal(gone.length, 1);
    // a turn long after: the old point is past its age and is pruned by the new one
    await checkpointTurn({ dataDir: s.data, person: DANA, thread: T, agent: AGENT, turnId: "trn_new", now: BASE, waitMs: 5000 });
    const left = (await pointsIn(s.ctx, { threadId: T }, s.data)).points;
    assert.deepEqual(left.map((p) => p.pointId === gone[0]!.pointId), [false]);
    await assert.rejects(rewindIn(s.ctx, { threadId: T, pointId: gone[0]!.pointId, afterSeq: 0, uptoSeq: 1 }, s.data), /not in this chat/);
  } finally {
    fs.rmSync(s.data, { recursive: true, force: true });
  }
});
