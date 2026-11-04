// An agent's kind is a column, not a word in its role line (hole 18, AUDIT-agents-model 4): the private assistant stays private whatever its role says, and a role line never makes an agent private.
// @reads /modules/agents/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, handlers, hostCalls } from "../impl.ts";
import { DANA, LEO, harness } from "../fixtures/harness.ts";

const H = handlers as unknown as Record<string, (c: unknown, i: unknown) => Promise<any>>;
const ensureAssistant = consumers["agents.ensure_assistant"].run;
const born = (id: string, name: string) => ({ payload: { principalId: id, kind: "person", name } });
const code = (e: any): string => e?.error?.code ?? e?.code;

test("an assistant whose role line changes stays private to its owner", async () => {
  const hn = harness();
  const [id] = await ensureAssistant(hn.person(DANA), born(DANA, "Dana Reyes"));
  await H["agents.role_line.set"]!(hn.person(DANA), { agentId: id, description: "Runs my week" });
  hn.allowOnly(() => true);
  const seen = (await H["agents.list"]!(hn.person(LEO), { limit: 100 })).agents;
  assert.ok(!seen.some((a: any) => a.agentId === id), "another member never sees it");
  await assert.rejects(() => H["agents.get"]!(hn.person(LEO), { agentId: id }), (e) => code(e) === "validation.not_found");
  assert.equal((await H["agents.get"]!(hn.person(DANA), { agentId: id })).agent.kind, "assistant");
});

test("an agent someone calls assistant is an ordinary agent: the word grants no privacy and no second assistant", async () => {
  const hn = harness();
  const made = (await H["agents.create"]!(hn.person(DANA), { name: "Front Desk", role: "assistant" })).agent;
  assert.equal(made.kind, "agent");
  hn.allowOnly(() => true);
  assert.ok((await H["agents.list"]!(hn.person(LEO), { limit: 100 })).agents.some((a: any) => a.agentId === made.agentId), "a shared agent stays listed");
  const [mine] = await ensureAssistant(hn.person(DANA), born(DANA, "Dana Reyes"));
  assert.notEqual(mine, made.agentId, "the person still gets their real assistant");
});

test("a teammate says so in its kind and project, and kind is on every read", async () => {
  const hn = harness();
  const made = (await H["agents.create"]!(hn.person(DANA), { name: "Reviewer", projectId: "prj_1" })).agent;
  assert.equal(made.kind, "teammate");
  assert.equal(made.teammateOf, "prj_1");
  const listed = (await H["agents.list"]!(hn.person(DANA), { projectId: "prj_1", limit: 10 })).agents;
  assert.deepEqual(listed.map((a: any) => [a.agentId, a.kind]), [[made.agentId, "teammate"]]);
});

test("agents made before the column are read from what they carried: the migration moves the role word and the teammate key", async () => {
  const hn = harness();
  const [id] = await ensureAssistant(hn.person(DANA), born(DANA, "Dana Reyes"));
  const mate = (await H["agents.create"]!(hn.person(DANA), { name: "Reviewer", projectId: "prj_1" })).agent;
  hn.db.run("UPDATE agents_agent SET kind = 'agent', projectId = NULL");
  hn.db.run("INSERT INTO agents_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `teammate:${mate.agentId}`, "prj_1");
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../migrations/0006_agent_kind.sql", import.meta.url), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  for (const stmt of sql.split(";").map((s) => s.trim()).filter((s) => s.startsWith("UPDATE"))) hn.db.run(stmt);
  const rows = hn.rows("SELECT id, kind, projectId FROM agents_agent ORDER BY name");
  assert.deepEqual(rows.find((r) => r["id"] === id)?.["kind"], "assistant");
  assert.deepEqual(rows.find((r) => r["id"] === mate.agentId), { id: mate.agentId, kind: "teammate", projectId: "prj_1" });
});

test("the removal wizard leaves the private assistant out of what can be handed on, by kind", async () => {
  const hn = harness();
  const [id] = await ensureAssistant(hn.person(DANA), born(DANA, "Dana Reyes"));
  await H["agents.role_line.set"]!(hn.person(DANA), { agentId: id, description: "Runs my week" });
  const owned = (hostCalls as any)["agents.owned_by"](hn.ctx, { person: DANA });
  assert.equal(owned.agents.count, 0);
});
