// New on a Projects list (the phone's New button, a view's New) makes a real project: record, channel and folder through projects.create, never a bare record that no project list knows (15 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { newRecord } from "../views-a/view.tsx";

const rig = () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const opened: string[] = [];
  const data = {
    call: async (cap: string, input: unknown): Promise<unknown> => {
      calls.push([cap, input as Record<string, unknown>]);
      if (cap === "projects.create") return { projectId: "prj_1", recordId: "rec_p" };
      return { record: { id: "rec_1" } };
    },
    nav: { openRecord: (id: string) => void opened.push(id) },
  };
  return { calls, opened, data: data as never };
};
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

test("New on the Projects type makes a project and opens its record", async () => {
  const r = rig();
  newRecord(r.data, "project", {}, { key: "project", title: "Project", titleField: "title", template: "project" });
  await settle();
  assert.deepEqual(
    r.calls.map((c) => c[0]),
    ["projects.create"],
    "a project, not a bare record",
  );
  assert.equal(r.calls[0]![1]["title"], "New project");
  assert.deepEqual(r.opened, ["rec_p"]);
});

test("New on a type of the person's own is still a bare record", async () => {
  const r = rig();
  newRecord(r.data, "contact", {}, { key: "contact", title: "Contact", titleField: "name" });
  await settle();
  assert.deepEqual(
    r.calls.map((c) => c[0]),
    ["records.create"],
  );
  assert.deepEqual(r.opened, ["rec_1"]);
});
