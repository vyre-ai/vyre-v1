// The work and scratch layout on Windows (lane l-winfix): short hashed segments, so Vyre's own part of an engine's paths stays well under MAX_PATH; an index Vyre keeps turns a segment back into
// the person and the thread. A Mac and Linux keep the readable layout.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SHARED_FOLDER, idOfSegment, layoutRoots, scratchFolder, segmentOf, sharedFolder, workFolder, workParts } from "../sandbox.ts";

const tmp = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-layout-")));

test("Windows: a work folder is w\\<10 hex>\\<10 hex>, the scratch folder s\\<10 hex>, and the segments lead back to the ids", () => {
  const data = tmp();
  const person = "usr_0123456789abcdefghijklmnopqrstuv";
  const thread = "thr_zyxwvutsrqponmlkjihgfedcba9876543210";
  const w = workFolder(data, person, thread, undefined, "win32");
  const rel = path.relative(data, w).split(path.sep);
  assert.equal(rel[0], "w");
  assert.match(rel[1]!, /^[0-9a-f]{10}$/);
  assert.match(rel[2]!, /^[0-9a-f]{10}$/);
  assert.equal(path.relative(data, w).length, 23, "w + two 10-character segments");
  assert.equal(path.relative(data, scratchFolder(data, person, "win32")), path.join("s", rel[1]!));
  assert.deepEqual(workParts(data, w, "win32"), { person, threadId: thread, workRoot: path.join(data, "w"), personSeg: rel[1] });
  assert.equal(workFolder(data, person, thread, undefined, "win32"), w, "the same ids give the same folder");
  assert.notEqual(workFolder(data, person, "thr_other", undefined, "win32"), w);
  assert.equal(workParts(data, path.join(data, "w", "0000000000", rel[2]!), "win32"), null, "a folder Vyre did not make is no one's");
  assert.equal(idOfSegment(data, "thread", rel[1]!, "win32"), null, "a person's segment is not a thread's");
  assert.deepEqual(layoutRoots("win32"), { work: "w", scratch: "s" });
});

test("Windows: an agent's own folder in a chat is one more short segment, and the chat's shared folder beside it is never an engine's", () => {
  const data = tmp();
  const person = "usr_0123456789abcdefghijklmnopqrstuv";
  const thread = "thr_zyxwvutsrqponmlkjihgfedcba9876543210";
  const agent = "agt_01a19fdf18fb4f989d65b9f3418bc972";
  const a = workFolder(data, person, thread, agent, "win32");
  const rel = path.relative(data, a).split(path.sep);
  assert.equal(rel.length, 4);
  assert.match(rel[3]!, /^[0-9a-f]{10}$/);
  assert.equal(path.relative(data, a).length, 34, "w + three 10-character segments");
  assert.deepEqual(workParts(data, a, "win32"), { person, threadId: thread, agent, workRoot: path.join(data, "w"), personSeg: rel[1] });
  assert.notEqual(workFolder(data, person, thread, "agt_other", "win32"), a, "two agents in one chat never share a folder");
  const shared = sharedFolder(data, person, thread, "win32");
  assert.equal(path.basename(shared), SHARED_FOLDER);
  assert.equal(path.dirname(shared), path.dirname(a));
  assert.equal(workParts(data, shared, "win32"), null, "an engine never runs in the shared folder");
});

test("Windows: a hash another id already holds is made longer", () => {
  const data = tmp();
  const first = segmentOf(data, "thread", "thr_a", "win32");
  // another id already holds thr_b's ten-digit hash
  const want = segmentOf(tmp(), "thread", "thr_b", "win32");
  fs.writeFileSync(path.join(data, "w-ids", want), "thread:thr_somebody_else");
  const got = segmentOf(data, "thread", "thr_b", "win32");
  assert.equal(got.length, 12);
  assert.ok(got.startsWith(want));
  assert.equal(idOfSegment(data, "thread", got, "win32"), "thr_b");
  assert.equal(idOfSegment(data, "thread", first, "win32"), "thr_a");
});

test("a Mac and Linux keep work/<person>/<thread> and scratch/<person>", () => {
  const data = tmp();
  const w = workFolder(data, "usr_dana", "thr_1", undefined, "linux");
  assert.equal(w, path.join(data, "work", "usr_dana", "thr_1"));
  assert.equal(scratchFolder(data, "usr_dana", "linux"), path.join(data, "scratch", "usr_dana"));
  assert.deepEqual(workParts(data, w, "linux"), { person: "usr_dana", threadId: "thr_1", workRoot: path.join(data, "work"), personSeg: "usr_dana" });
  const a = workFolder(data, "usr_dana", "thr_1", "agt_intake", "linux");
  assert.equal(a, path.join(data, "work", "usr_dana", "thr_1", "agt_intake"));
  assert.deepEqual(workParts(data, a, "linux"), { person: "usr_dana", threadId: "thr_1", agent: "agt_intake", workRoot: path.join(data, "work"), personSeg: "usr_dana" });
  assert.equal(fs.existsSync(path.join(data, "w-ids")), false);
});
