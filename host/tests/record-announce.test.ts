// The replay's scan: a high-water mark so a start reads only record events newer than the last clean scan, the first start that sets the mark and makes nothing, records of live calls (made since the daemon started)
// left alone, and the replay never run as a principal that no longer exists.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../../kernel/src/log/schema.ts";
import { readMark, replayActors, replayAnnouncements } from "../src/daemon/record-announce.ts";
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
