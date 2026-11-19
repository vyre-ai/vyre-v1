// @tsx
// Living tasks on the Tasks page (lane r42-alive): Archived is a scope of the page, its rows say why they were put away, Archive leaves the list at once with Undo, and Put back returns a task to its lists.
import test from "node:test";
import assert from "node:assert/strict";
import { archivedLine, buildEntries, NO_FILTER } from "./model.ts";
import type { BuildIn, TaskRow } from "./model.ts";
import { bulkArchive, putBack } from "./actions.ts";
import type { ActEnv } from "./actions.ts";
import { createTaskStore } from "./store.ts";

const NOW = Date.UTC(2026, 10, 19, 10);
const me = "usr_me";
const row = (over: Partial<TaskRow> & { id: string }): TaskRow =>
  ({
    kind: "work",
    title: over.id,
    state: "todo",
    blocked: false,
    assigned: { kind: "person", id: me },
    labels: [],
    dependsOn: [],
    createdBy: me,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TaskRow;
const names = { name: (id: string): string => (id === "agt_dex" ? "Dex" : id), project: (id: string): string => id };
const base: Omit<BuildIn, "rows" | "scope"> = {
  needs: [],
  me,
  now: NOW,
  offsetMin: 0,
  group: "smart",
  sort: "smart",
  filter: NO_FILTER,
  doneRows: null,
  doneCount: 3,
  names,
};
const put = (code: "hand" | "passed", why: string, by = me): NonNullable<TaskRow["archived"]> => ({
  at: NOW,
  by,
  code,
  why,
});

test("the Archived list is one group of what was put away: nothing is added there and nothing in it is done", () => {
  const entries = buildEntries({
    ...base,
    scope: "archived",
    rows: [row({ id: "a", archived: put("passed", "The call was Thu 5 Nov") })],
  });
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["head", "task"],
  );
  assert.equal(entries[0]!.kind === "head" && entries[0].title, "Archived");
  const none = buildEntries({ ...base, scope: "archived", rows: [] });
  assert.deepEqual(
    none.map((e) => (e.kind === "empty" ? e.text : e.kind)),
    ["Nothing is archived."],
  );
});

test("an archived row says why it was put away, else who put it away", () => {
  assert.equal(
    archivedLine(put("passed", "The call was Thu 5 Nov", "svc_host"), me, names.name),
    "Archived · The call was Thu 5 Nov",
  );
  assert.equal(archivedLine(put("hand", ""), me, names.name), "Archived by you");
  assert.equal(archivedLine(put("hand", "", "agt_dex"), me, names.name), "Archived by Dex");
  assert.equal(archivedLine(put("passed", "", "svc_host"), me, names.name), "Archived");
});

test("the Archived store asks for the archived tasks only, and is kept apart from Mine", async () => {
  const calls: Record<string, unknown>[] = [];
  const store = createTaskStore(
    async (_c, input) => {
      calls.push(input as Record<string, unknown>);
      return { rev: "1", unchanged: false, rows: [], doneThisWeek: 0, total: 0 };
    },
    { scope: "mine", archived: true },
  );
  store.refresh();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [{ scope: "mine", archived: true }]);
});

function envOf(rows: TaskRow[], refuse: ReadonlySet<string> = new Set()) {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const said: { text: string; undo?: () => void }[] = [];
  let list = rows;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown>;
    calls.push({ cap, input: i });
    if (cap === "tasks.index")
      return { rev: String(calls.length), unchanged: false, rows: list, doneThisWeek: 0, total: list.length };
    if (refuse.has(String(i["taskId"]))) throw new Error("Other work is waiting on this task. Cancel it instead.");
    return {};
  };
  const store = createTaskStore(call, { scope: "mine" });
  const env: ActEnv = {
    call,
    say: (text, undo) => said.push(undo ? { text, undo } : { text }),
    store,
    newKey: () => "k",
    now: () => NOW,
    offsetMin: 0,
  };
  return { env, store, calls, said, setList: (r: TaskRow[]) => (list = r) };
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test("Archive takes the rows off the list at once, says so with Undo, and Undo puts every one back", async () => {
  const h = envOf([row({ id: "a" }), row({ id: "b" }), row({ id: "c" })]);
  h.store.refresh();
  await settle();
  const going = bulkArchive(h.env, ["a", "b"]);
  assert.deepEqual(
    h.store.get().rows.map((r) => r.id),
    ["c"],
    "gone before the server answers",
  );
  await going;
  assert.deepEqual(
    h.calls.filter((c) => c.cap === "tasks.archive").map((c) => c.input["taskId"]),
    ["a", "b"],
  );
  assert.equal(h.said.at(-1)!.text, "2 tasks archived");
  h.said.at(-1)!.undo!();
  await settle();
  assert.deepEqual(
    h.calls.filter((c) => c.cap === "tasks.unarchive").map((c) => c.input["taskId"]),
    ["a", "b"],
  );
  await settle();
  assert.equal(h.store.get().rows.length, 3, "the list is read again and holds them");
});

test("a task that cannot be archived stays on the list with the reason; the others still go", async () => {
  const h = envOf([row({ id: "a" }), row({ id: "b" })], new Set(["a"]));
  h.store.refresh();
  await settle();
  await bulkArchive(h.env, ["a", "b"]);
  assert.deepEqual(
    h.store.get().rows.map((r) => r.id),
    ["a"],
  );
  assert.equal(h.said.at(-1)!.text, "Archived. Other work is waiting on this task. Cancel it instead.");
  const none = envOf([row({ id: "a" })], new Set(["a"]));
  none.store.refresh();
  await settle();
  await bulkArchive(none.env, ["a"]);
  assert.equal(none.store.get().rows.length, 1);
  assert.equal(none.said.at(-1)!.text, "Other work is waiting on this task. Cancel it instead.");
  assert.equal(none.said.at(-1)!.undo, undefined);
});

test("Put back takes the task off the Archived list and tells the server", async () => {
  const h = envOf([row({ id: "a", archived: put("hand", "") })]);
  h.store.refresh();
  await settle();
  await putBack(h.env, ["a"]);
  assert.equal(h.store.get().rows.length, 0);
  assert.deepEqual(h.calls.at(-1), { cap: "tasks.unarchive", input: { taskId: "a" } });
  assert.equal(h.said.at(-1)!.text, "Back in your tasks");
});
