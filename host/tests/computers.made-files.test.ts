// The chat line for files an agent made on its computer: one message in the chat the work was for, a file card each (four at most), posted as the agent; no chat, no post.
import test from "node:test";
import assert from "node:assert/strict";
import { createMadeFilesAnnouncer } from "../src/daemon/daemon.ts";

const file = (n: number) => ({ fileId: `fil_${n}`, name: `f${n}.pdf`, kind: "pdf", size: 10 * n, version: 1 });

function rig(thread: string | undefined) {
  const posts: Array<{ agentId: string; cap: string; input: any }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const logs: string[] = [];
  const say = createMadeFilesAnnouncer({
    db: { all: () => (thread ? [{ thread_id: thread }] : []) },
    call: async (agentId, cap, input) => { posts.push({ agentId, cap, input }); return {}; },
    log: (m) => logs.push(m),
  });
  return { say, posts, logs };
}

test("the files land in the chat the computer last worked for, as file cards", async () => {
  const r = rig("thr_1");
  await r.say({ agentId: "agt_a", computerId: "cmt_a", files: [file(1), file(2)] });
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0]!.cap, "chat.post");
  assert.equal(r.posts[0]!.agentId, "agt_a");
  assert.equal(r.posts[0]!.input.threadId, "thr_1");
  assert.deepEqual(r.posts[0]!.input.blocks.map((b: any) => [b.type, b.data.fileId, b.data.name]), [["file", "fil_1", "f1.pdf"], ["file", "fil_2", "f2.pdf"]]);   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(r.posts[0]!.input.body, "");
});

test("more than four files show four cards and count the rest; a repeat of the same files has the same key", async () => {
  const r = rig("thr_1");
  const six = [1, 2, 3, 4, 5, 6].map(file);
  await r.say({ agentId: "agt_a", computerId: "cmt_a", files: six });
  await r.say({ agentId: "agt_a", computerId: "cmt_a", files: six });
  assert.equal(r.posts[0]!.input.blocks.length, 4);
  assert.equal(r.posts[0]!.input.body, "and 2 more in Files");
  assert.equal(r.posts[0]!.input.idempotencyKey, r.posts[1]!.input.idempotencyKey);
});

test("work for no chat (a routine, a person at the keyboard) posts nothing and says why in the log", async () => {
  const r = rig(undefined);
  await r.say({ agentId: "agt_a", computerId: "cmt_a", files: [file(1)] });
  assert.deepEqual(r.posts, []);
  assert.equal(r.logs.length, 1);
});
