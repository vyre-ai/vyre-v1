// Rewind (chat gap G36, G37; review of 15 Nov): the points of a chat with an agent, going back, and what it refuses. Real git in a temporary data folder; the chat's reads stand in.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harness } from "../fixtures/harness.ts";
import { checkpointTurn, pointWanted, points, snapshot, storeOf, sweep } from "../checkpoints.ts";
import { pointsIn, rewindIn } from "../handlers/rewind.ts";
import { workFolder } from "../sandbox.ts";
import { ensure } from "../projections.ts";

const T = "thr_rw";
const AGENT = "agt_dex";
const DANA = "usr_dana";
const MAYA = "usr_maya";
const BASE = 1_700_000_000_000;

interface Msg {
  messageId: string;
  threadSeq: number;
  author: { id: string };
  body: string;
}

function setup(o: { members?: string[]; kind?: string; placement?: string } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "rewind-"));
  const h = harness();
  ensure(h.ctx.db);
  const msgs: Msg[] = [
    { messageId: "msg_ask1", threadSeq: 1, author: { id: DANA }, body: "Please add the uploads folder" },
    { messageId: "msg_reply", threadSeq: 2, author: { id: AGENT }, body: "Done" },
    { messageId: "msg_maya", threadSeq: 3, author: { id: MAYA }, body: "Maya's own ask" },
  ];
  const state = { placement: o.placement };
  const ctx = {
    ...h.ctx,
    async call(cap: string, input: Record<string, unknown>) {
      if (cap === "threads.get")
        return {
          thread: {
            kind: o.kind ?? "chat",
            members: (o.members ?? [DANA]).map((id) => ({ id })),
            agents: [{ agentId: AGENT }],
          },
        };
      if (cap === "chat.messages.list") return { messages: msgs };
      if (cap === "chat.message.get") {
        const m = msgs.find((x) => x.messageId === input["messageId"]);
        if (!m) throw new Error("none");
        return { message: m };
      }
      if (cap === "agents.get") return { agent: { name: "Dex" } };
      if (cap === "engine.placement.decide") return { placement: state.placement };
      throw new Error(`unexpected ${cap}`);
    },
  };
  return { data, h, ctx, msgs, state };
}
const turn = (s: { data: string }, who: string, id: string, messageId: string, now: number, waitMs = 5000) =>
  checkpointTurn({ dataDir: s.data, person: who, thread: T, agent: AGENT, turnId: id, messageId, now, waitMs });
const done = (s: { data: string }) => fs.rmSync(s.data, { recursive: true, force: true });

test("points name the message a turn answered; going back restores the folder, folds from that message to the end, and every step is a row that can be listed and undone, both ways", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    fs.writeFileSync(path.join(dir, "b.txt"), "new");
    const listed = await pointsIn(s.ctx, { threadId: T }, s.data);
    assert.equal(listed.available, true);
    assert.equal(listed.points[0]!.after, "Please add the uploads folder");
    const went = await rewindIn(s.ctx, { threadId: T, pointId: listed.points[0]!.pointId }, s.data);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one");
    assert.equal(fs.existsSync(path.join(dir, "b.txt")), false);
    assert.deepEqual(
      [went.afterSeq, went.uptoSeq, went.undid],
      [0, 3, false],
      "the range is the engine's: from the point's own message to the newest",
    );
    const rows1 = s.h.rows("SELECT kind, state FROM engine_rewind WHERE thread_id = ?", T);
    assert.deepEqual(rows1, [{ kind: "rewind", state: "done" }]);
    const l1 = await pointsIn(s.ctx, { threadId: T }, s.data);
    assert.deepEqual(
      l1.active.map((a) => [a.afterSeq, a.uptoSeq, a.undoPointId]),
      [[0, 3, went.undoPointId]],
    );
    // work done between the rewind and its Undo
    fs.writeFileSync(path.join(dir, "c.txt"), "between");
    const undone = await rewindIn(s.ctx, { threadId: T, pointId: went.undoPointId }, s.data);
    assert.equal(undone.undid, true);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "two");
    assert.equal(
      fs.existsSync(path.join(dir, "c.txt")),
      false,
      "going back to before the rewind removes what was made since",
    );
    // the Undo is a row of its own, and its point is listed, so the work done between the rewind and the Undo can be reached again
    assert.deepEqual(s.h.rows("SELECT kind, state FROM engine_rewind WHERE thread_id = ?", T), [
      { kind: "undo", state: "done" },
    ]);
    const l2 = await pointsIn(s.ctx, { threadId: T }, s.data);
    assert.deepEqual(l2.active, [], "nothing is folded after Undo");
    const redo = l2.points.find((p) => p.undo === true);
    assert.ok(redo, "the Undo's own point is offered");
    const back = await rewindIn(s.ctx, { threadId: T, pointId: redo!.pointId }, s.data);
    assert.equal(
      fs.readFileSync(path.join(dir, "c.txt"), "utf8"),
      "between",
      "the work done between a rewind and its Undo is reachable again",
    );
    assert.equal(back.undid, false, "going back to the Undo's point folds the range again");
    assert.equal((await pointsIn(s.ctx, { threadId: T }, s.data)).active.length, 1);
  } finally {
    done(s);
  }
});

test("outside a chat with an agent it is off; a made-up point is not found; an agent cannot go back", async () => {
  const chan = setup({ kind: "channel" });
  const solo = setup();
  try {
    assert.equal((await pointsIn(chan.ctx, { threadId: T }, chan.data)).why, "not_a_chat");
    await assert.rejects(
      rewindIn(solo.ctx, { threadId: T, pointId: `${AGENT}.${"a".repeat(40)}` }, solo.data),
      /not in this chat/,
    );
    await assert.rejects(rewindIn(solo.ctx, { threadId: T, pointId: "../../etc" }, solo.data), /not in this chat/);
    const asAgent = { ...solo.ctx, principal: { kind: "agent" as const, id: AGENT } };
    await assert.rejects(pointsIn(asAgent, { threadId: T }, solo.data), /Only a person/);
  } finally {
    done(chan);
    done(solo);
  }
});

test("item 2: engine.rewind.to makes the checks itself: a point whose message is another person's is refused, and the range is never the caller's", async () => {
  const s = setup({ members: [DANA, MAYA] });
  try {
    const mine = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(mine, "a.txt"), "dana-1");
    // Dana owns a point (her folder) whose turn began at MAYA's message: she cannot fold everything from there
    await turn(s, DANA, "trn_x", "msg_maya", BASE + 1_000);
    const listed = await pointsIn(s.ctx, { threadId: T }, s.data);
    fs.writeFileSync(path.join(mine, "a.txt"), "dana-2");
    await assert.rejects(
      rewindIn(s.ctx, { threadId: T, pointId: listed.points[0]!.pointId, afterSeq: 0, uptoSeq: 99 } as never, s.data),
      /only go back to your own message/,
    );
    assert.equal(fs.readFileSync(path.join(mine, "a.txt"), "utf8"), "dana-2", "nothing was put back");
    assert.deepEqual(s.h.rows("SELECT * FROM engine_rewind"), [], "no range was written");
    // her own message: the caller's range is ignored, the engine derives it
    await turn(s, DANA, "trn_y", "msg_ask1", BASE + 2_000);
    const l2 = await pointsIn(s.ctx, { threadId: T }, s.data);
    const own = l2.points.find((p) => p.messageId === "msg_ask1")!;
    await rewindIn(s.ctx, { threadId: T, pointId: own.pointId, afterSeq: 2, uptoSeq: 99 } as never, s.data);
    assert.deepEqual(s.h.rows("SELECT after_seq, upto_seq FROM engine_rewind"), [{ after_seq: 0, upto_seq: 3 }]);
    // Maya's point id is not Dana's: it is not found for her
    const maya = { ...s.ctx, principal: { kind: "person" as const, id: MAYA } };
    await assert.rejects(rewindIn(maya, { threadId: T, pointId: own.pointId }, s.data), /not in this chat/);
  } finally {
    done(s);
  }
});

test("item 3: not while the agent works (and the files are untouched); a point finished after the agent began is labelled during, never before; a link swapped in is never written through", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    const listed = await pointsIn(s.ctx, { threadId: T }, s.data);
    await assert.rejects(
      rewindIn(s.ctx, { threadId: T, pointId: listed.points[0]!.pointId }, s.data, { busy: (_t, a) => a === AGENT }),
      /Stop Dex first, then go back\./,
    );
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "two");
    assert.deepEqual(s.h.rows("SELECT * FROM engine_rewind"), [], "nothing was written for a refused rewind");
    // a point that lost the race to the turn's start is the folder "during" the turn
    const r = await checkpointTurn({
      dataDir: s.data,
      person: DANA,
      thread: T,
      agent: AGENT,
      turnId: "trn_slow",
      messageId: "msg_ask1",
      now: BASE + 2_000,
      waitMs: 0,
    });
    assert.equal(r.background, true);
    let late: Awaited<ReturnType<typeof pointsIn>>["points"] = [];
    for (let i = 0; i < 100 && !late.some((p) => p.during); i++) {
      await new Promise((x) => setTimeout(x, 50));
      late = (await pointsIn(s.ctx, { threadId: T }, s.data)).points;
    }
    const during = late.find((p) => p.during);
    assert.ok(during, "the late point is listed as during");
    // a link in the way: restore puts a real file where the link was and never writes through it
    const outside = path.join(s.data, "outside.txt");
    fs.writeFileSync(outside, "outside");
    fs.rmSync(path.join(dir, "a.txt"));
    fs.symlinkSync(outside, path.join(dir, "a.txt"));
    const own = late.find((p) => !p.during && p.messageId === "msg_ask1")!;
    await rewindIn(s.ctx, { threadId: T, pointId: own.pointId }, s.data);
    assert.equal(fs.readFileSync(outside, "utf8"), "outside", "nothing was written through the link");
    assert.equal(fs.lstatSync(path.join(dir, "a.txt")).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one");
  } finally {
    done(s);
  }
});

test("item 4: a turn in a crew, task or one-shot thread, or on the person's own computer, takes no point; the card is told once", async () => {
  assert.equal(pointWanted("chat", "host"), true);
  assert.equal(pointWanted("chat", undefined), false, "an unknown placement fails closed: no point");
  assert.equal(pointWanted("chat", ""), false);
  assert.equal(pointWanted("chat", "device"), false, "the folder it works in is not on this server");
  for (const kind of ["crew", "task", "helper", "channel", "oneshot"])
    assert.equal(pointWanted(kind, "host"), false, kind);
  const s = setup({ placement: "device" });
  try {
    const l = await pointsIn(s.ctx, { threadId: T }, s.data);
    assert.equal(l.ownComputer, true);
    assert.deepEqual(l.points, []);
    s.state.placement = "host";
    assert.equal((await pointsIn(s.ctx, { threadId: T }, s.data)).ownComputer, false);
  } finally {
    done(s);
  }
});

test("item 5: a path that could not be removed counts as failed and is named; the rest goes on", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    fs.writeFileSync(path.join(dir, "locked.txt"), "x");
    fs.writeFileSync(path.join(dir, "free.txt"), "y");
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    const l = await pointsIn(s.ctx, { threadId: T }, s.data);
    const r = await rewindIn(s.ctx, { threadId: T, pointId: l.points[0]!.pointId }, s.data, {
      rm: (p) => {
        if (p.endsWith("locked.txt")) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
        fs.rmSync(p, { recursive: true, force: true });
      },
    });
    assert.deepEqual([r.removed, r.failed, r.failedPaths], [1, 1, ["locked.txt"]]);
    assert.equal(fs.existsSync(path.join(dir, "locked.txt")), true);
    assert.equal(fs.existsSync(path.join(dir, "free.txt")), false);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one");
  } finally {
    done(s);
  }
});

test("item 6: the sweep drops points older than 14 days in a chat nobody touches, and the store with them", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "1");
    await turn(s, DANA, "trn_old", "msg_ask1", BASE);
    const gitDir = storeOf(s.data, dir);
    assert.equal((await points({ gitDir, workDir: dir })).length, 1);
    const r = await sweep(s.data, BASE + 15 * 24 * 3600_000);
    assert.equal(r.pointsDropped, 1);
    assert.equal(fs.existsSync(gitDir), false, "nothing is left of an idle store");
    // a recent store is left alone
    await turn(s, DANA, "trn_new", "msg_ask1", BASE + 20 * 24 * 3600_000);
    await sweep(s.data, BASE + 21 * 24 * 3600_000);
    assert.equal((await points({ gitDir, workDir: dir })).length, 1);
  } finally {
    done(s);
  }
});

test("item 6/8: a prune of a store waits for a snapshot of the same store that is being written (one lock per store); without the lock it finishes first", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "1");
    const gitDir = storeOf(s.data, dir);
    const { prune } = await import("../checkpoints.ts");
    let snapshotDone = 0;
    let pruneDone = 0;
    const snap = snapshot({
      gitDir,
      workDir: dir,
      // evaluated inside the store's lock, just before the point is committed: a slow snapshot
      label: () => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
        return "turn t m";
      },
      now: BASE,
    }).then(() => void (snapshotDone = performance.now()));
    const pr = prune({ gitDir, workDir: dir, now: BASE + 1, keep: 3 }).then(() => void (pruneDone = performance.now()));
    await Promise.all([snap, pr]);
    assert.ok(pruneDone >= snapshotDone, "the prune (and its gc) ran only after the snapshot finished");
  } finally {
    done(s);
  }
});

test("item 8: the row is written before the files are put back; a rewind cut short is listed as interrupted with Undo, and Undo brings the folder back", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    const l = await pointsIn(s.ctx, { threadId: T }, s.data);
    await assert.rejects(
      rewindIn(s.ctx, { threadId: T, pointId: l.points[0]!.pointId }, s.data, {
        beforeRestore: () => {
          throw new Error("the host stopped here");
        },
      }),
      /host stopped/,
    );
    assert.deepEqual(
      s.h.rows("SELECT state FROM engine_rewind"),
      [{ state: "going back" }],
      "the row was there before the files moved",
    );
    const after = await pointsIn(s.ctx, { threadId: T }, s.data);
    assert.equal(after.active.length, 1);
    assert.equal(after.active[0]!.interrupted, true);
    assert.ok(after.active[0]!.undoPointId, "Undo is offered");
    const undo = await rewindIn(s.ctx, { threadId: T, pointId: after.active[0]!.undoPointId! }, s.data);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "two");
    assert.equal(undo.undid, true);
    assert.equal(s.h.rows("SELECT state FROM engine_rewind WHERE state = 'going back'").length, 0);
  } finally {
    done(s);
  }
});

test("item 1: secrets are never stored in a point, by name or by content; a deleted secret is not brought back; the store is mode 700 and its files 600", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    const secrets = [
      "credentials.json",
      "service-account.json",
      "token.json",
      "secrets.yaml",
      ".aws/credentials",
      "deploy.p8",
      "a.kdbx",
      "my-service-account-prod.json",
    ];
    for (const f of secrets) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), "x");
    }
    fs.writeFileSync(
      path.join(dir, "notes.txt"),
      // secret-scan: fake
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n",
    );
    fs.writeFileSync(path.join(dir, "conf.txt"), "aws_secret_access_key = abcd\n");
    fs.writeFileSync(path.join(dir, "app.ts"), "export const x = 1;\n");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    const gitDir = storeOf(s.data, dir);
    const p = (await points({ gitDir, workDir: dir }))[0]!;
    const { execFileSync } = await import("node:child_process");
    const tree = execFileSync("git", ["--git-dir", gitDir, "ls-tree", "-r", "--name-only", p.sha], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    assert.deepEqual(tree, ["app.ts"], `stored: ${tree.join(", ")}`);
    // a secret deleted since is not brought back; a normal file is
    for (const f of ["credentials.json", "notes.txt", "app.ts"]) fs.rmSync(path.join(dir, f));
    const l = await pointsIn(s.ctx, { threadId: T }, s.data);
    await rewindIn(s.ctx, { threadId: T, pointId: l.points[0]!.pointId }, s.data);
    assert.equal(fs.existsSync(path.join(dir, "credentials.json")), false);
    assert.equal(fs.existsSync(path.join(dir, "notes.txt")), false);
    assert.equal(fs.existsSync(path.join(dir, "app.ts")), true);
    assert.equal(fs.existsSync(path.join(dir, "token.json")), true, "a secret still there is left exactly as it is");
    // modes
    const modeOf = (f: string): number => fs.statSync(f).mode & 0o777;
    assert.equal(modeOf(gitDir), 0o700);
    assert.equal(modeOf(path.dirname(gitDir)) & 0o077, 0, "the folders above the store are the server's alone");
    assert.equal(modeOf(path.join(s.data, "checkpoints")) & 0o077, 0);
    const loose: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (modeOf(f) & 0o077) loose.push(f);
      }
    };
    walk(gitDir);
    assert.deepEqual(loose, [], "no file of the store is readable by group or others");
  } finally {
    done(s);
  }
});

test("1a: a browser profile's stores are secrets whatever the content sniff says: Cookies, Login Data, cookies.sqlite, logins.json, key4.db, Web Data, Local State; a whole profile folder is one secret", async () => {
  const { isSecretPath } = await import("../../../lib/secret-files.ts");
  const names = ["Cookies", "Login Data", "cookies.sqlite", "logins.json", "key4.db", "Web Data", "Local State"];
  for (const n of names) assert.equal(isSecretPath(`profile/${n}`), true, n);
  for (const d of ["User Data", ".mozilla", "google-chrome", "chromium"])
    assert.equal(isSecretPath(`x/${d}/Default/Preferences`), true, d);
  assert.equal(isSecretPath("src/cookies-banner.tsx"), false);
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    for (const n of names) fs.writeFileSync(path.join(dir, n), Buffer.from([0, 1, 2, 3, 0, 5]));
    fs.mkdirSync(path.join(dir, "User Data", "Default"), { recursive: true });
    fs.writeFileSync(path.join(dir, "User Data", "Default", "History"), "visits");
    fs.writeFileSync(path.join(dir, "app.ts"), "ok");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    const gitDir = storeOf(s.data, dir);
    const p = (await points({ gitDir, workDir: dir }))[0]!;
    const { execFileSync } = await import("node:child_process");
    const tree = execFileSync("git", ["--git-dir", gitDir, "ls-tree", "-r", "--name-only", p.sha], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    assert.deepEqual(tree, ["app.ts"]);
  } finally {
    done(s);
  }
});

/** Every object of a store, loose and packed, as one buffer to search. */
async function allObjects(gitDir: string): Promise<Buffer> {
  const { execFileSync } = await import("node:child_process");
  return execFileSync("git", ["--git-dir", gitDir, "cat-file", "--batch-all-objects", "--batch"], {
    maxBuffer: 1 << 28,
  });
}

test("1b: a secret's bytes are never in the store's objects, loose or packed, not even as an unreferenced blob (they are kept out BEFORE the add)", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    // secret-scan: fake
    const key = "-----BEGIN RSA PRIVATE KEY-----\nTOPSECRETKEYBYTES\n-----END RSA PRIVATE KEY-----\n";
    fs.writeFileSync(path.join(dir, "credentials.json"), "NAMEDSECRETBYTES");
    fs.writeFileSync(path.join(dir, "plain-name.txt"), key);
    fs.mkdirSync(path.join(dir, "User Data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "User Data", "Cookies"), "COOKIEBYTES");
    fs.writeFileSync(path.join(dir, "app.ts"), "export const ok = 1;\n");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    // a file that was clean, was kept in a point, and becomes a secret afterwards must not be re-read
    fs.writeFileSync(path.join(dir, "later.txt"), "clean");
    await turn(s, DANA, "trn_2", "msg_ask1", BASE + 2_000);
    fs.writeFileSync(path.join(dir, "later.txt"), key.replace("TOPSECRETKEYBYTES", "LATERSECRETBYTES"));
    await turn(s, DANA, "trn_3", "msg_ask1", BASE + 3_000);
    const gitDir = storeOf(s.data, dir);
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["--git-dir", gitDir, "gc", "--quiet"]); // packed as well as loose
    const bytes = await allObjects(gitDir);
    for (const secret of ["NAMEDSECRETBYTES", "TOPSECRETKEYBYTES", "COOKIEBYTES", "LATERSECRETBYTES"])
      assert.equal(bytes.includes(Buffer.from(secret)), false, `${secret} is in the store's objects`);
    assert.equal(bytes.includes(Buffer.from("export const ok")), true, "ordinary files are kept");
  } finally {
    done(s);
  }
});

test("2: a file that holds a secret NOW is left exactly as it is by a restore, and named with the reason, though it was clean at the point", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "later.txt"), "clean");
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    // secret-scan: fake
    const key = "-----BEGIN RSA PRIVATE KEY-----\nNOWSECRET\n-----END RSA PRIVATE KEY-----\n";
    fs.writeFileSync(path.join(dir, "later.txt"), key);
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    const l = await pointsIn(s.ctx, { threadId: T }, s.data);
    const r = await rewindIn(s.ctx, { threadId: T, pointId: l.points[0]!.pointId }, s.data);
    assert.equal(fs.readFileSync(path.join(dir, "later.txt"), "utf8"), key, "the key is still there");
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one", "the rest went back");
    assert.equal(r.failed, 1);
    assert.deepEqual(r.failedPaths, ["later.txt (left as it is: it holds a secret)"]);
  } finally {
    done(s);
  }
});

test("3: the restore's own guard: a point made by the OLD code that holds a secret never brings it back, and never removes or overwrites one on disk", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await turn(s, DANA, "trn_0", "msg_ask1", BASE + 500);
    const gitDir = storeOf(s.data, dir);
    const { execFileSync } = await import("node:child_process");
    const g = (args: string[], env: Record<string, string> = {}, input?: string): string =>
      execFileSync("git", ["--git-dir", gitDir, ...args], {
        encoding: "utf8",
        env: { ...process.env, ...env },
        ...(input ? { input } : {}),
      }).trim();
    // a point as the code before the fix made it: the tree holds credentials.json and a.txt
    const blobSecret = g(["hash-object", "-w", "--stdin"], {}, "OLD-POINT-SECRET");
    const blobA = g(["hash-object", "-w", "--stdin"], {}, "one");
    const tree = g(["mktree"], {}, `100644 blob ${blobSecret}\tcredentials.json\n100644 blob ${blobA}\ta.txt\n`);
    const commit = g(["-c", "user.name=x", "-c", "user.email=x@x", "commit-tree", tree, "-m", "turn trn_old msg_ask1"]);
    g(["update-ref", `refs/points/${String(BASE + 600).padStart(15, "0")}-2-0001`, commit]);
    // credentials.json was deleted since; a.txt changed; token.json (not in the point) exists
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    fs.writeFileSync(path.join(dir, "token.json"), "keep");
    const l = await pointsIn(s.ctx, { threadId: T }, s.data);
    const old = l.points.find((p) => p.pointId.endsWith(commit))!;
    assert.ok(old, "the hand-built point is listed");
    await rewindIn(s.ctx, { threadId: T, pointId: old.pointId }, s.data);
    assert.equal(
      fs.existsSync(path.join(dir, "credentials.json")),
      false,
      "the secret in the old point was not brought back",
    );
    assert.equal(fs.readFileSync(path.join(dir, "token.json"), "utf8"), "keep", "a secret on disk was not removed");
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one");
  } finally {
    done(s);
  }
});

test("4: when the placement cannot be read or answers nothing, no point is taken (fail closed) and the card is not told it is the person's own computer", async () => {
  const { pointWanted } = await import("../checkpoints.ts");
  for (const p of [undefined, "", "unknown", "device"]) assert.equal(pointWanted("chat", p), false, String(p));
  assert.equal(pointWanted("chat", "host"), true);
});

test("7: while a rewind holds an agent, that agent's turn start waits and does NOT start when the wait slice passes (one plain line, once); it starts by itself when the gate opens", async () => {
  const { holdTurns, turnMayStart } = await import("../rewind-gate.ts");
  assert.equal(await turnMayStart(T, AGENT), "free");
  const rw = holdTurns(T, AGENT)!;
  let started = false;
  let told = 0;
  const start = turnMayStart(T, AGENT, { sliceMs: 40, onWait: () => told++ }).then((r) => {
    started = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(started, false, "the wait ran out of its slice and the turn has NOT started");
  assert.equal(told, 1, "one plain line, once");
  rw.release();
  assert.equal(await start, "waited", "the turn starts by itself when the gate opens");
  assert.equal(await turnMayStart(T, AGENT), "free");
  // a turn that began between the first look and the point of now: the second look refuses, and the files are untouched
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    const l = await pointsIn(s.ctx, { threadId: T }, s.data);
    let looks = 0;
    await assert.rejects(
      rewindIn(s.ctx, { threadId: T, pointId: l.points[0]!.pointId }, s.data, { busy: () => ++looks >= 2 }),
      /Stop Dex first, then go back\./,
    );
    assert.equal(looks, 2, "it looked again after the point of now was taken");
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "two", "nothing was put back");
    assert.deepEqual(s.h.rows("SELECT * FROM engine_rewind"), [], "no row was written");
    assert.equal(await turnMayStart(T, AGENT), "free", "the hold is released after a refusal");
  } finally {
    done(s);
  }
});

test("2c: a rewind that made no progress for minutes is given up on: the gate opens and the turn starts, and the rewind is listed as interrupted with Undo", async () => {
  const s = setup();
  try {
    const { turnMayStart, HUNG_MS } = await import("../rewind-gate.ts");
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    const l = await pointsIn(s.ctx, { threadId: T }, s.data);
    // the rewind hangs between its row and its restore
    void rewindIn(s.ctx, { threadId: T, pointId: l.points[0]!.pointId }, s.data, {
      beforeRestore: () => new Promise(() => undefined),
    }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
    let clock = Date.now();
    const gate = await turnMayStart(T, AGENT, { sliceMs: 20, now: () => (clock += HUNG_MS + 1) });
    assert.equal(gate, "gave_up", "a hung rewind is given up on");
    assert.equal(await turnMayStart(T, AGENT), "free", "the gate is open: the turn starts");
    const after = await pointsIn(s.ctx, { threadId: T }, s.data);
    assert.equal(after.active[0]?.interrupted, true);
    assert.ok(after.active[0]?.undoPointId, "it is listed with Undo");
    await rewindIn(s.ctx, { threadId: T, pointId: after.active[0]!.undoPointId! }, s.data);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "two", "Undo brings the folder back");
  } finally {
    done(s);
  }
});

test("1: two rewinds of one agent started together: one runs, the other is refused in plain words, and the folder ends as the first left it", async () => {
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    fs.writeFileSync(path.join(dir, "a.txt"), "one");
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    fs.writeFileSync(path.join(dir, "a.txt"), "two");
    await turn(s, DANA, "trn_2", "msg_ask1", BASE + 2_000);
    fs.writeFileSync(path.join(dir, "a.txt"), "three");
    const l = await pointsIn(s.ctx, { threadId: T }, s.data);
    const [newest, oldest] = [l.points[0]!, l.points[1]!];
    const res = await Promise.allSettled([
      rewindIn(s.ctx, { threadId: T, pointId: oldest.pointId }, s.data),
      rewindIn(s.ctx, { threadId: T, pointId: newest.pointId }, s.data),
    ]);
    assert.deepEqual(res.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    const bad = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.match(String(bad.reason?.message ?? bad.reason), /Going back is already running here\./);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one", "the first one's result: the oldest point");
    assert.equal(s.h.rows("SELECT state FROM engine_rewind").length, 1, "only one row was written");
    // and by the row: a row still going back and not stale refuses another
    s.h.ctx.db.run(
      "INSERT INTO engine_rewind (thread_id, after_seq, upto_seq, by_person, at, undo_sha, kind, state) VALUES (?, 0, 3, ?, ?, ?, 'rewind', 'going back')",
      T,
      DANA,
      s.h.ctx.now(),
      "f".repeat(40),
    );
    await assert.rejects(rewindIn(s.ctx, { threadId: T, pointId: newest.pointId }, s.data), /already running here/);
  } finally {
    done(s);
  }
});

test("3: a source file is not a secret by its stem: token.ts, keys.ts, env.ts, secret.ts with ordinary code are stored and restored; with a real-looking key inside they are left alone and named, several at once", async () => {
  const { isSecretPath } = await import("../../../lib/secret-files.ts");
  for (const f of [
    "token.ts",
    "keys.ts",
    "env.ts",
    "secret.ts",
    "src/token.js",
    "auth/keys.py",
    "secrets.go",
    "main.rs",
  ])
    assert.equal(isSecretPath(f), false, f);
  for (const f of [
    ".env",
    ".env.local",
    "a.pem",
    "b.key",
    "c.p12",
    "d.pfx",
    "e.p8",
    "f.kdbx",
    "id_rsa",
    "id_ed25519.pub",
    "id_ecdsa",
    ".npmrc",
    ".netrc",
    ".git-credentials",
    "credentials.json",
    "service-account-prod.json",
    "token.json",
    "secrets.yaml",
    "secrets.yml",
    "kubeconfig",
    ".aws/credentials",
  ])
    assert.equal(isSecretPath(f), true, f);
  const s = setup();
  try {
    const dir = workFolder(s.data, DANA, T, AGENT);
    for (const f of ["token.ts", "keys.ts", "env.ts", "secret.ts"])
      fs.writeFileSync(path.join(dir, f), `export const ${f.split(".")[0]} = 1;\n`);
    await turn(s, DANA, "trn_1", "msg_ask1", BASE + 1_000);
    const gitDir = storeOf(s.data, dir);
    const { execFileSync } = await import("node:child_process");
    const p = (await points({ gitDir, workDir: dir }))[0]!;
    const tree = execFileSync("git", ["--git-dir", gitDir, "ls-tree", "-r", "--name-only", p.sha], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    assert.deepEqual(tree, ["env.ts", "keys.ts", "secret.ts", "token.ts"], "ordinary code under these names is stored");
    for (const f of ["token.ts", "keys.ts", "env.ts", "secret.ts"]) fs.writeFileSync(path.join(dir, f), "changed");
    let l = await pointsIn(s.ctx, { threadId: T }, s.data);
    await rewindIn(s.ctx, { threadId: T, pointId: l.points[0]!.pointId }, s.data);
    for (const f of ["token.ts", "keys.ts", "env.ts", "secret.ts"])
      assert.equal(
        fs.readFileSync(path.join(dir, f), "utf8"),
        `export const ${f.split(".")[0]} = 1;\n`,
        `${f} was restored`,
      );
    // now three of them hold a real-looking key: a restore leaves them alone and names every one
    // secret-scan: fake
    const key = "-----BEGIN RSA PRIVATE KEY-----\nSECRETBYTES\n-----END RSA PRIVATE KEY-----\n";
    for (const f of ["token.ts", "keys.ts", "env.ts"]) fs.writeFileSync(path.join(dir, f), key);
    fs.writeFileSync(path.join(dir, "secret.ts"), "changed again");
    l = await pointsIn(s.ctx, { threadId: T }, s.data);
    const r = await rewindIn(s.ctx, { threadId: T, pointId: l.points.find((q) => !q.undo)!.pointId }, s.data);
    assert.deepEqual(r.failedPaths.sort(), [
      "env.ts (left as it is: it holds a secret)",
      "keys.ts (left as it is: it holds a secret)",
      "token.ts (left as it is: it holds a secret)",
    ]);
    assert.equal(fs.readFileSync(path.join(dir, "token.ts"), "utf8"), key);
    assert.equal(fs.readFileSync(path.join(dir, "secret.ts"), "utf8"), "export const secret = 1;\n");
  } finally {
    done(s);
  }
});
