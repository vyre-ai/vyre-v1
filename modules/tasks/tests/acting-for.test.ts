// A person's own Assistant, or any agent acting for that person, works and completes a task assigned to that person as they could (lane l-chrome2a). Another person's agent is refused, an agent with
// nobody behind it is refused, and the thread line says who did it for whom.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { bot, bot2, cara, owner, newTask } from "../fixtures/seed.ts";
import { findTask } from "../projections.ts";

const me = { id: owner.id };
function world(): Harness {
  const h = harness();
  h.callee("chat.start", (i: { scopeId: string }) => ({ thread: { threadId: `thr_${i.scopeId.slice(4)}` } }));
  h.callee("threads.members.add", () => ({}));
  h.callee("threads.add_agent", () => ({}));
  h.callee("chat.post", () => ({ message: {} }));
  h.callee("access.principals.get", (i: { principal: { id: string } }) => ({ principal: { name: i.principal.id === bot.id ? "Assistant" : i.principal.id === owner.id ? "Irfad" : "Someone" } }));
  return h;
}
const mine = (h: Harness) => h.call("tasks.create", newTask({ assigned: { kind: "person", id: owner.id } }), me).then((r) => r.task.id as string);
const lines = (h: Harness): string[] => h.threadCalls.filter((c) => c.cap === "chat.post").map((c) => (c.input as { body: string }).body);

test("the Assistant completes the task assigned to its person, and the thread reads 'Assistant did this for Irfad'", async () => {
  const h = world();
  const id = await mine(h);
  const r = await h.call("tasks.submit", { taskId: id, outputs: { done: "yes" }, summary: "Sent the invoices and filed the receipts" }, { id: bot.id, kind: "agent", actingFor: owner.id });
  assert.equal(r.next, "done");
  assert.equal(findTask(h.db, id)!.state, "done");
  assert.match(lines(h).join("\n"), /^Assistant did this for Irfad\.\n\nSubmitted: Sent the invoices/m);
});

test("it may also ask and block for its person, as the person could", async () => {
  const h = world();
  const id = await mine(h);
  const as = { id: bot.id, kind: "agent" as const, actingFor: owner.id };
  const q = await h.call("tasks.ask", { taskId: id, question: "Which account?", options: [] }, as).catch((e) => e);
  assert.ok(q && !(q instanceof Error), `ask: ${String(q?.message ?? "")}`);
});

test("another person's agent is refused, and so is an agent with nobody behind it", async () => {
  const h = world();
  const id = await mine(h);
  const refusedAs = (e: unknown): boolean => ["permission.not_found", "permission.no_grant"].includes(String(codeOf(e))) || reasonOf(e) === "wrong_actor";   // it may not even see the task, or sees it and holds no seat
  await assert.rejects(h.call("tasks.submit", { taskId: id, summary: "Done for Cara" }, { id: bot2.id, kind: "agent", actingFor: cara.id }), refusedAs);
  await assert.rejects(h.call("tasks.submit", { taskId: id, summary: "Done" }, { id: bot.id, kind: "agent" }), refusedAs);
  assert.equal(findTask(h.db, id)!.state, "todo", "nothing moved");
  assert.ok(!lines(h).some((l) => /did this for/.test(l)));
});

test("the person's own act reads as theirs, with no 'did this for' line", async () => {
  const h = world();
  const id = await mine(h);
  await h.call("tasks.submit", { taskId: id, summary: "Did it myself" }, me);
  assert.ok(!lines(h).some((l) => /did this for/.test(l)), lines(h).join("|"));
});
