// A task that was put away (living tasks, lane r42-alive) is nothing to be told about any more: its notice stops counting, like a task that closed. Putting it back brings nothing back; the mail stays the person's.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { NOW, alice } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";

test("task.archived clears the notices about that task, once, and no other task's", async () => {
  const h = harness();
  const put = (id: string, task: string): void =>
    void h.sqlite
      .prepare(
        "INSERT INTO notifications_items (id, person, kind, level, place, title, subject_type, subject_id, count, at, seen_at, deleted_at) VALUES (?, ?, 'approval.requested', 'interrupt', 'chats', 'x', 'task', ?, 1, ?, NULL, NULL)",
      )
      .run(id, alice.id, task, NOW);
  put("ntf_a", "tsk_gone");
  put("ntf_b", "tsk_stays");
  const run = (name: string, taskId: string) =>
    consumers["notifications.task_closed"].run(
      h.ctxFor(null, { id: "svc_host", kind: "service" }) as never,
      {
        name,
        payload: { taskId },
      } as never,
    );
  assert.deepEqual(await run("task.archived", "tsk_gone"), ["ntf_a"]);
  assert.deepEqual(await run("task.archived", "tsk_gone"), [], "a second delivery changes nothing");
  const seen = h.sqlite.prepare("SELECT id, seen_at FROM notifications_items ORDER BY id").all() as {
    id: string;
    seen_at: number | null;
  }[];
  assert.notEqual(seen[0]!.seen_at, null);
  assert.equal(seen[1]!.seen_at, null);
});
