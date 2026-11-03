// The work and scratch layout on Windows (lane l-winfix): short hashed segments, so Vyre's own part of an engine's paths stays well under MAX_PATH; an index Vyre keeps turns a segment back into
// the person and the thread. A Mac and Linux keep the readable layout.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { idOfSegment, layoutRoots, scratchFolder, segmentOf, workFolder, workParts } from "../sandbox.ts";

const tmp = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-layout-")));

test("Windows: a work folder is w\\<10 hex>\\<10 hex>, the scratch folder s\\<10 hex>, and the segments lead back to the ids", () => {
  const data = tmp();
  const person = "usr_0123456789abcdefghijklmnopqrstuv";
  const thread = "thr_zyxwvutsrqponmlkjihgfedcba9876543210";
  const w = workFolder(data, person, thread, "win32");
  const rel = path.relative(data, w).split(path.sep);
  assert.equal(rel[0], "w");
  assert.match(rel[1]!, /^[0-9a-f]{10}$/);
  assert.match(rel[2]!, /^[0-9a-f]{10}$/);
  assert.equal(path.relative(data, w).length, 23, "w + two 10-character segments");
  assert.equal(path.relative(data, scratchFolder(data, person, "win32")), path.join("s", rel[1]!));
  assert.deepEqual(workParts(data, w, "win32"), { person, threadId: thread, workRoot: path.join(data, "w"), personSeg: rel[1] });
  assert.equal(workFolder(data, person, thread, "win32"), w, "the same ids give the same folder");
  assert.notEqual(workFolder(data, person, "thr_other", "win32"), w);
  assert.equal(workParts(data, path.join(data, "w", "0000000000", rel[2]!), "win32"), null, "a folder Vyre did not make is no one's");
  assert.equal(idOfSegment(data, "thread", rel[1]!, "win32"), null, "a person's segment is not a thread's");
  assert.deepEqual(layoutRoots("win32"), { work: "w", scratch: "s" });
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
  const w = workFolder(data, "usr_dana", "thr_1", "linux");
  assert.equal(w, path.join(data, "work", "usr_dana", "thr_1"));
  assert.equal(scratchFolder(data, "usr_dana", "linux"), path.join(data, "scratch", "usr_dana"));
  assert.deepEqual(workParts(data, w, "linux"), { person: "usr_dana", threadId: "thr_1", workRoot: path.join(data, "work"), personSeg: "usr_dana" });
  assert.equal(fs.existsSync(path.join(data, "w-ids")), false);
});
