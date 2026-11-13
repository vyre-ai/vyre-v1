// A pasted address of this Space that names a thing opens that thing; anything else is text for a chat (owner, 13 Nov 2026). One rule, in the app's address resolver (shell/reach).
import test from "node:test";
import assert from "node:assert/strict";
import { resolveSpaceLink } from "../reach/space-link.ts";

const ORIGINS = ["https://space.example.test"];

test("this Space's own /open links open the thing they name: a chat, a file, a record, a message", () => {
  assert.deepEqual(resolveSpaceLink("https://space.example.test/open/thread/thr_1", ORIGINS), {
    subject: { type: "thread", id: "thr_1" },
  });
  assert.deepEqual(resolveSpaceLink("  https://space.example.test/open/file/fil_9  ", ORIGINS), {
    subject: { type: "file", id: "fil_9" },
  });
  assert.deepEqual(resolveSpaceLink("https://space.example.test/open/record/rec_2", ORIGINS), {
    subject: { type: "record", id: "rec_2" },
  });
  assert.deepEqual(resolveSpaceLink("https://space.example.test/open/message/thr_1/msg_4", ORIGINS), {
    subject: { type: "thread", id: "thr_1" },
    args: { m: "msg_4" },
  });
});

test("an artifact's own address opens the artifact", () => {
  assert.deepEqual(resolveSpaceLink("https://space.example.test/a/sit_abc123", ORIGINS), {
    subject: { type: "artifact", id: "sit_abc123" },
  });
  assert.equal(resolveSpaceLink("https://other.example.test/a/sit_abc123", ORIGINS), null);
});

test("the desktop link form of this Space opens too", () => {
  assert.deepEqual(
    resolveSpaceLink("vyre://open?address=https%3A%2F%2Fspace.example.test&kind=file&id=fil_9", ORIGINS),
    { subject: { type: "file", id: "fil_9" } },
  );
});

test("anything else is not a link to a thing: another Space, another site, a kind with no page, words around a link, a bare path", () => {
  assert.equal(resolveSpaceLink("https://other.example.test/open/thread/thr_1", ORIGINS), null, "another Space");
  assert.equal(resolveSpaceLink("https://news.example.test/article", ORIGINS), null);
  assert.equal(resolveSpaceLink("https://space.example.test/open/spaceship/x1", ORIGINS), null, "a kind with no page");
  assert.equal(
    resolveSpaceLink("see https://space.example.test/open/thread/thr_1 please", ORIGINS),
    null,
    "words around it are a message",
  );
  assert.equal(resolveSpaceLink("/open/thread/thr_1", ORIGINS), null);
  assert.equal(resolveSpaceLink("Heyy", ORIGINS), null);
  assert.equal(resolveSpaceLink("vyre://open?address=https%3A%2F%2Fother.example.test&kind=file&id=f", ORIGINS), null);
});

test("the product's own link forms open the thing: <origin>/a/<id>, <origin>/#subject=<type>:<id>, and a dead tauri address an older desktop build copied", () => {
  assert.deepEqual(resolveSpaceLink("https://space.example.test/a/art_77", ORIGINS), {
    subject: { type: "artifact", id: "art_77" },
  });
  assert.deepEqual(resolveSpaceLink("https://space.example.test/#subject=record:rec_5", ORIGINS), {
    subject: { type: "record", id: "rec_5" },
  });
  assert.deepEqual(resolveSpaceLink("https://space.example.test/chat#subject=thread:thr_3", ORIGINS), {
    subject: { type: "thread", id: "thr_3" },
  });
  assert.deepEqual(resolveSpaceLink("tauri://localhost/a/sit_abc", ORIGINS), {
    subject: { type: "artifact", id: "sit_abc" },
  });
  assert.deepEqual(resolveSpaceLink("tauri://localhost/open/file/fil_9", ORIGINS), {
    subject: { type: "file", id: "fil_9" },
  });
  assert.deepEqual(resolveSpaceLink("https://tauri.localhost/open/thread/thr_1", ORIGINS), {
    subject: { type: "thread", id: "thr_1" },
  });
  assert.equal(resolveSpaceLink("https://other.example.test/#subject=record:rec_5", ORIGINS), null);
});

test("round trip: a link built for every kind the resolver knows opens the same thing", () => {
  for (const kind of [
    "file",
    "folder",
    "task",
    "project",
    "agent",
    "automation",
    "run",
    "goal",
    "channel",
    "thread",
    "chat",
    "record",
  ]) {
    const id = `${kind}_1`;
    const got = resolveSpaceLink(`https://space.example.test/open/${kind}/${id}`, ORIGINS);
    assert.ok(got?.subject, kind);
    assert.equal(got.subject.id, id, kind);
  }
});
