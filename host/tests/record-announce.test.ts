// The replay's scan: a high-water mark so a start reads only record events newer than the last clean scan, the first start that sets the mark and makes nothing, records of live calls (made since the daemon started)
// left alone, and the replay never run as a principal that no longer exists.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../../kernel/src/log/schema.ts";
import { orphanAnnouncements, readMark, replayActors, replayAnnouncements } from "../src/daemon/record-announce.ts";
import type { PendingAnnouncement } from "../src/daemon/record-announce.ts";

const enc = new TextEncoder();
function world(
  records: { id: string; at: number; announce?: Record<string, unknown>; announced?: boolean; deleted?: boolean }[],
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-ann-"));
  const space = new DatabaseSync(path.join(dir, "space.db"));
  space.exec(SCHEMA);
  space.exec(
    "CREATE TABLE rt_party (id TEXT PRIMARY KEY, version INTEGER, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, data TEXT)",
  );
  const log = new DatabaseSync(path.join(dir, "events.db"));
  log.exec(SCHEMA);
  records.forEach((r, i) => {
    space.prepare("INSERT INTO events (seq, event, payload) VALUES (?, ?, ?)").run(
      i + 1,
      JSON.stringify({
        id: `evt_k${i}`,
        type: "record.created",
        at: r.at,
        actor: "usr_dana",
        trace_id: "a".repeat(32),
        entity: "party",
        entity_id: r.id,
      }),
      enc.encode(
        JSON.stringify({
          type: "party",
          id: r.id,
          data: { name: r.id },
          at: r.at,
          ...(r.announce ? { announce: r.announce } : {}),
        }),
      ),
    );
    space.prepare("INSERT INTO rt_party VALUES (?, 1, ?, ?, ?, '{}')").run(r.id, r.at, r.at, r.deleted ? r.at : null);
    if (r.announced)
      log
        .prepare("INSERT INTO events (seq, event, payload) VALUES (?, ?, ?)")
        .run(
          i + 1,
          JSON.stringify({ id: `evt_m${i}`, type: "record.created", at: r.at, entity: "record", entity_id: r.id }),
          enc.encode("{}"),
        );
  });
  space.close();
  log.close();
  return {
    dir,
    spaceDb: path.join(dir, "space.db"),
    eventsDb: path.join(dir, "events.db"),
    markFile: path.join(dir, "mark"),
  };
}
const base = (
  w: ReturnType<typeof world>,
  commit: (p: PendingAnnouncement) => Promise<unknown>,
  startedAt = 10_000,
) => ({
  spaceDb: w.spaceDb,
  eventsDb: w.eventsDb,
  markFile: w.markFile,
  startedAt,
  commit,
  exists: () => true,
  spaceOwner: () => "usr_owner",
});

test("the first start sets the mark to where the log is and makes nothing; the next reads only what is newer", async () => {
  const w = world([
    { id: "rec_old1", at: 100, announce: { quiet: true } },
    { id: "rec_old2", at: 200, announce: {} },
  ]);
  try {
    const seen: string[] = [];
    assert.equal(await replayAnnouncements(base(w, async (p) => void seen.push(p.id))), 0, "nothing the first time");
    assert.equal(readMark(w.markFile), 2);
    // a stop later: two more records, one announced, one not; one record made after the daemon started (a live call)
    const space = new DatabaseSync(w.spaceDb);
    const add = (seq: number, id: string, at: number, announce: object) => {
      space.prepare("INSERT INTO events (seq, event, payload) VALUES (?, ?, ?)").run(
        seq,
        JSON.stringify({
          id: `evt_x${seq}`,
          type: "record.created",
          at,
          actor: "usr_dana",
          on_behalf: "usr_mira",
          run_id: "run_1",
          trace_id: "b".repeat(32),
          entity: "party",
          entity_id: id,
        }),
        enc.encode(JSON.stringify({ type: "party", id, data: {}, at, announce })),
      );
      space.prepare("INSERT INTO rt_party VALUES (?, 1, ?, ?, NULL, '{}')").run(id, at, at);
    };
    add(3, "rec_lost", 300, { quiet: true, depth: 2, origin: "automation:aut_1" });
    add(4, "rec_fine", 400, {});
    add(5, "rec_live", 20_000, {});
    space.close();
    const log = new DatabaseSync(w.eventsDb);
    log
      .prepare("INSERT INTO events (seq, event, payload) VALUES (7, ?, x'7b7d')")
      .run(
        JSON.stringify({ id: "evt_fine", type: "record.created", at: 400, entity: "record", entity_id: "rec_fine" }),
      );
    log.close();
    const got: PendingAnnouncement[] = [];
    assert.equal(await replayAnnouncements(base(w, async (p) => void got.push(p))), 1);
    assert.deepEqual(
      got.map((p) => p.id),
      ["rec_lost"],
      "the lost one only: not the announced one, not the live call's, not the ones before the mark",
    );
    assert.equal(got[0]!.depth, 2);
    assert.equal(got[0]!.origin, "automation:aut_1");
    assert.equal(got[0]!.onBehalf, "usr_mira");
    assert.equal(got[0]!.runId, "run_1");
    assert.equal(readMark(w.markFile), 4, "the mark stops before the record a live call made");
  } finally {
    fs.rmSync(w.dir, { recursive: true, force: true });
  }
});

test("a failed replay keeps the mark, so the next start looks again", async () => {
  const w = world([{ id: "rec_a", at: 100, announce: {} }]);
  try {
    fs.writeFileSync(w.markFile, "0\n");
    assert.equal(await replayAnnouncements(base(w, async () => Promise.reject(new Error("refused")))), 0);
    assert.equal(readMark(w.markFile), 0);
    assert.equal(await replayAnnouncements(base(w, async () => undefined)), 1);
    assert.equal(readMark(w.markFile), 1);
  } finally {
    fs.rmSync(w.dir, { recursive: true, force: true });
  }
});

test("records of kinds that carry no marker and records removed since are left alone", async () => {
  const w = world([
    { id: "rec_nomark", at: 100 },
    { id: "rec_gone", at: 100, announce: {}, deleted: true },
  ]);
  try {
    fs.writeFileSync(w.markFile, "0\n");
    const seen: string[] = [];
    assert.equal(await replayAnnouncements(base(w, async (p) => void seen.push(p.id))), 0);
    assert.deepEqual(seen, []);
  } finally {
    fs.rmSync(w.dir, { recursive: true, force: true });
  }
});

test("the replay never runs as a principal that is gone: the person it acted for, else the Space owner, else nobody", () => {
  const p = (over: Partial<PendingAnnouncement>): PendingAnnouncement => ({
    id: "rec_a",
    type: "party",
    data: {},
    actor: "agt_scout",
    onBehalf: "usr_mira",
    traceId: "a".repeat(32),
    quiet: true,
    seq: 1,
    ...over,
  });
  const alive =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id);
  assert.deepEqual(replayActors(p({}), alive("agt_scout", "usr_mira"), "usr_owner"), {
    actor: "agt_scout",
    actingFor: "usr_mira",
    changed: false,
  });
  assert.deepEqual(
    replayActors(p({}), alive("usr_mira", "usr_owner"), "usr_owner"),
    { actor: "usr_mira", changed: true },
    "the agent is gone: as the person it worked for",
  );
  assert.deepEqual(
    replayActors(p({}), alive("usr_owner"), "usr_owner"),
    { actor: "usr_owner", changed: true },
    "both gone: the Space owner",
  );
  assert.deepEqual(
    replayActors(p({}), alive("agt_scout", "usr_owner"), "usr_owner"),
    { actor: "agt_scout", actingFor: "usr_owner", changed: true },
    "the person is gone: for the Space owner",
  );
  assert.equal(replayActors(p({}), alive(), "usr_owner"), null, "nobody left");
});

// 26 Nov 2026 (Meier, rc.42): dv_event had 4,267 records and the owner saw 986. A sync pass that an update stopped before its call committed left records no announcement ever named and no marker in their own
// event to say one was owed; the marker replay cannot find them, and a record the log never heard of is not a resource, so nobody sees it. The repair announces them at the next start.
test("records with no announcement and no marker are announced at the start, quietly, for the actor their own event names; a later start looks only at the records made since", async () => {
  const w = world([
    { id: "rec_seen1", at: 100, announced: true },
    { id: "rec_orph1", at: 200 },
    { id: "rec_orph2", at: 300 },
    { id: "rec_gone", at: 400, deleted: true },
    { id: "rec_live", at: 20_000 },
  ]);
  try {
    fs.writeFileSync(w.markFile, "5\n"); // the marker replay has been through them: it looks for the marker, and these have none
    const repairFile = path.join(w.dir, "repair");
    const got: PendingAnnouncement[] = [];
    const run = (): Promise<number> => replayAnnouncements({ ...base(w, async (p) => void got.push(p)), repairFile });
    assert.equal(await run(), 2);
    assert.deepEqual(
      got.map((p) => p.id).sort(),
      ["rec_orph1", "rec_orph2"],
      "not the announced, the deleted or the live call's",
    );
    assert.ok(got.every((p) => p.quiet === true && p.repair === true && p.actor === "usr_dana" && p.type === "party"));
    assert.ok(fs.existsSync(repairFile), "the repair is marked done");
    // they are announced now: the next start looks only past what the first looked at
    const log = new DatabaseSync(w.eventsDb);
    let seq = 100;
    for (const p of got)
      log
        .prepare("INSERT INTO events (seq, event, payload) VALUES (?, ?, x'7b7d')")
        .run(
          seq++,
          JSON.stringify({ id: `evt_r${seq}`, type: "record.created", at: 1, entity: "record", entity_id: p.id }),
        );
    log.close();
    got.length = 0;
    assert.equal(await run(), 0);
    // a start after an update looks at the whole Space again: a record at or below the mark that no announcement named is found (a rowid a delete freed was used again)
    const lowSpace = new DatabaseSync(w.spaceDb);
    lowSpace.prepare("INSERT INTO rt_party VALUES ('rec_low', 1, 150, 150, NULL, '{}')").run();
    lowSpace.close();
    // a mark that is past it (as if the row took a rowid a delete had freed)
    fs.writeFileSync(repairFile, `${JSON.stringify({ v: 2, at: Date.now(), tables: { rt_party: 1000 } })}\n`);
    got.length = 0;
    assert.equal(await run(), 0, "the same version trusts the mark: the record under it is not looked at");
    assert.equal(
      await replayAnnouncements({ ...base(w, async (p) => void got.push(p)), repairFile, version: "2.0.0" }),
      1,
      "a new version looks at everything",
    );
    assert.deepEqual(
      got.map((p) => p.id),
      ["rec_low"],
    );
    const lowDel = new DatabaseSync(w.spaceDb);
    lowDel.prepare("DELETE FROM rt_party WHERE id = 'rec_low'").run();
    lowDel.close();
    got.length = 0;
    // a record made later is past the mark: found even though the repair was done
    const space = new DatabaseSync(w.spaceDb);
    space.prepare("INSERT INTO rt_party VALUES ('rec_late', 1, 500, 500, NULL, '{}')").run();
    space.close();
    assert.equal(await run(), 1);
    assert.deepEqual(
      got.map((p) => p.id),
      ["rec_late"],
    );
    assert.equal(got[0]!.actor, "", "no event of its own: the replay runs it as the Space owner");
  } finally {
    fs.rmSync(w.dir, { recursive: true, force: true });
  }
});

test("a repair that fails for one record is not marked done, so the next start looks again", async () => {
  const w = world([{ id: "rec_orph", at: 200 }]);
  try {
    fs.writeFileSync(w.markFile, "1\n");
    const repairFile = path.join(w.dir, "repair");
    assert.equal(
      await replayAnnouncements({ ...base(w, async () => Promise.reject(new Error("busy"))), repairFile }),
      0,
    );
    assert.ok(!fs.existsSync(repairFile));
  } finally {
    fs.rmSync(w.dir, { recursive: true, force: true });
  }
});

// 27 Nov 2026 (freeze-2 on the merged tree): the repair's two counts at start-up held the loop 224 ms on a Meier-sized Space (9,400 matters: 120 ms; the log: 80 ms). A start now reads no count: the first look
// is whole and in steps, every later one reads only the rows past the mark.
test("on a Meier-sized Space no step of the repair holds the loop 100 ms, and a start after the first reads only what was made since", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-ann-big-"));
  try {
    const space = new DatabaseSync(path.join(dir, "space.db"));
    space.exec(SCHEMA);
    space.exec(
      "CREATE TABLE rt_matter (id TEXT PRIMARY KEY, version INTEGER, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, data TEXT)",
    );
    const log = new DatabaseSync(path.join(dir, "events.db"));
    log.exec(SCHEMA);
    const N = 30_000;
    space.exec("BEGIN");
    log.exec("BEGIN");
    const ins = space.prepare("INSERT INTO rt_matter VALUES (?, 1, 100, 100, NULL, '{}')");
    const ev = log.prepare("INSERT INTO events (seq, event, payload) VALUES (?, ?, x'7b7d')");
    for (let i = 0; i < N; i++) {
      const id = `rec_m${String(i).padStart(6, "0")}`;
      ins.run(id);
      if (i % 100 !== 7)
        // one in a hundred was never announced
        ev.run(
          i + 1,
          JSON.stringify({ id: `evt_${i}`, type: "record.created", at: 100, entity: "record", entity_id: id }),
        );
    }
    space.exec("COMMIT");
    log.exec("COMMIT");
    space.close();
    log.close();
    const files = { spaceDb: path.join(dir, "space.db"), eventsDb: path.join(dir, "events.db"), before: 10_000 };
    const w = watchLoop();
    const first = await orphanAnnouncements({ ...files, mark: null });
    const max = await w.stop();
    assert.equal(first.pending.length, N / 100, "the first look is whole and finds each record no announcement named");
    assert.ok(max <= 100, `the first look held the loop for ${max} ms`);
    // the next start, with the mark: only rows past it
    const w2 = watchLoop();
    const t0 = performance.now();
    const again = await orphanAnnouncements({ ...files, mark: first.mark });
    const took = performance.now() - t0;
    const max2 = await w2.stop();
    assert.equal(again.pending.length, 0, "nothing past the mark");
    assert.ok(max2 <= 50, `the next start held the loop for ${max2} ms`);
    assert.ok(took < 100, `the next start took ${Math.round(took)} ms: it reads the tail only`);
    // one record made after, announced or not
    const sp = new DatabaseSync(files.spaceDb);
    sp.prepare("INSERT INTO rt_matter VALUES ('rec_new', 1, 200, 200, NULL, '{}')").run();
    sp.close();
    const third = await orphanAnnouncements({ ...files, mark: first.mark });
    assert.deepEqual(
      third.pending.map((p) => p.id),
      ["rec_new"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** The longest time the loop went without running a 2 ms timer. */
function watchLoop(): { stop(): Promise<number> } {
  let last = performance.now(),
    max = 0;
  const t = setInterval(() => {
    const at = performance.now();
    max = Math.max(max, at - last - 2);
    last = at;
  }, 2);
  return {
    stop: async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
      clearInterval(t);
      return Math.round(max);
    },
  };
}
