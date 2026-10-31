// Records > Agents: an Agents row finds the real agent behind it by name, a New agent is made through agents.create, a New project through projects.create, and a row with no agent says so.
import test from "node:test";
import assert from "node:assert/strict";
import { NOT_SET_UP, SET_UP, agentFor, nameKey } from "../recordpage/agentlink.ts";
import { madeKind, makeRecord } from "../table/make.ts";

const AGENTS = [{ agentId: "agt_1", name: "Intake" }, { agentId: "agt_2", name: "Docs Writer" }];

test("an Agents row finds its agent by name: case, spacing and edges do not matter", () => {
  assert.equal(agentFor("  intake ", AGENTS)?.agentId, "agt_1");
  assert.equal(agentFor("docs   writer", AGENTS)?.agentId, "agt_2");
  assert.equal(nameKey("  A  B "), "a b");
});

test("a row with no agent behind it finds none (Test), and an empty name finds none", () => {
  assert.equal(agentFor("Test", AGENTS), null);
  assert.equal(agentFor("   ", AGENTS), null);
  assert.ok(NOT_SET_UP.length > 0 && SET_UP === "Set it up" && !NOT_SET_UP.includes(String.fromCharCode(0x2014)));
});

const recorder = () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push([cap, input as Record<string, unknown>]);
    if (cap === "projects.create") return { projectId: "prj_1", recordId: "rec_p" };
    if (cap === "records.create") return { record: { id: "rec_1" } };
    return { agent: { agentId: "agt_9" } };
  };
  return { calls, call };
};

test("New agent makes a real agent first (agents.create), then the row that lists it", async () => {
  const r = recorder();
  assert.equal(madeKind({ key: "agent" }), "agent");
  const id = await makeRecord(r.call, { key: "agent", titleField: "name" }, "Scout", "k1");
  assert.deepEqual(r.calls.map((c) => c[0]), ["agents.create", "records.create"]);
  assert.equal(r.calls[0]![1]["name"], "Scout");
  assert.equal(id, "rec_1");
});

test("a refused agents.create makes no row", async () => {
  const calls: string[] = [];
  const call = async (cap: string): Promise<unknown> => { calls.push(cap); throw { error: { code: "validation.duplicate", message: "An agent with that name already exists." } }; };
  await assert.rejects(makeRecord(call, { key: "agent", titleField: "name" }, "Scout", "k2"));
  assert.deepEqual(calls, ["agents.create"]);
});

test("New project makes a real project (projects.create) and opens its record; New contact is a plain record", async () => {
  const p = recorder();
  assert.equal(madeKind({ key: "projects", template: "project" }), "project");
  assert.equal(await makeRecord(p.call, { key: "projects", titleField: "title", template: "project" }, "Launch", "k3"), "rec_p");
  assert.deepEqual(p.calls.map((c) => c[0]), ["projects.create"]);
  assert.deepEqual([p.calls[0]![1]["type"], p.calls[0]![1]["title"]], ["projects", "Launch"]);
  const c = recorder();
  assert.equal(madeKind({ key: "contact" }), "record");
  assert.equal(await makeRecord(c.call, { key: "contact", titleField: "name" }, "Ann", "k4"), "rec_1");
  assert.deepEqual(c.calls.map((x) => x[0]), ["records.create"]);
});
