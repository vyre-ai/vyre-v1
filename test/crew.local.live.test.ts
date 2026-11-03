// The crew on a person's own computer (owner test 4 Nov, DESIGN-crew.md): a Space with no Docker and no GitHub, the owner's assistant doing the setup itself. Nothing inside the daemon is faked but
// the model vendor, a scripted session that makes the tool calls a model would.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, makeAgent, ok, scriptedModel, seededDir, startChat, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

type Answer = { ok: boolean; content: { data?: any; error?: { code?: string; message?: string } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const data = (a: Answer, what: string): any => { assert.equal(a.ok, true, `${what}: ${JSON.stringify(a.content)}`); return a.content.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any

test("the owner's assistant makes a project all in one go, and every read of the id list gives resolves; it adds a teammate and provisions a computer", async () => {
  const out: Record<string, any> = {};   // eslint-disable-line @typescript-eslint/no-explicit-any
  let lead = "";
  let d: Daemon | undefined;
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead || !/make a project/.test(input.trigger?.body ?? "")) return;
    yield* run("tool_search", { query: "projects create get list members teammates" });
    yield* run("tool_search", { query: "projects get project" });
    yield* run("tool_search", { query: "computers provision" });
    const made = data((yield* run("projects_create", { type: "project", title: "Crew test", members: [{ principal: "usr_noah", role: "member" }], idempotencyKey: "p1" })) as Answer, "projects_create");
    out["made"] = made;
    await d!.hooks?.pump?.();
    out["list"] = data((yield* run("projects_list", {})) as Answer, "projects_list");
    out["get"] = data((yield* run("projects_get", { projectId: made.projectId })) as Answer, "projects_get");
    out["members"] = data((yield* run("projects_members_list", { projectId: made.projectId })) as Answer, "projects_members_list");
    out["mates"] = data((yield* run("projects_teammates_list", { projectId: made.projectId })) as Answer, "projects_teammates_list");
    out["mate"] = data((yield* run("projects_teammates_create", { projectId: made.projectId, name: "Ember", role: "member", idempotencyKey: "t1" })) as Answer, "projects_teammates_create");
    out["computer"] = data((yield* run("computers_provision", { agentId: lead, idempotencyKey: "cp1" })) as Answer, "computers_provision");
    yield { type: "text", text: "done" };
  });
  d = await boot(seededDir(), model);
  try {
    await connect(d);
    lead = await makeAgent(d, "Lead");
    const chat = await startChat(d, lead, "setup1");
    await ok(d, "chat.post", { threadId: chat, body: "make a project", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "setup1-post" });
    await waitFor(async () => (out["computer"] !== undefined ? true : null), 40_000, () => `${hostLog(d!)} ${JSON.stringify(out).slice(0, 600)}`);
    const id = out["made"].projectId as string;
    assert.deepEqual(out["list"].projects.map((p: { projectId: string }) => p.projectId), [id], "one project, not a half-made second");
    assert.equal(out["get"].project.projectId, id);
    assert.equal(out["members"].members.find((m: { principal: string }) => m.principal === "usr_olivia")?.role, "lead");
    assert.deepEqual(out["mates"].teammates, []);
    assert.equal(out["mate"].teammate.madeForProject, true);
    assert.equal(out["computer"].computer.agentId, lead);
    // the people a project starts with get their grant on it, written by the host once the project exists
    const shares = (await ok(d, "access.shares_of", { resource: { type: "project", id } })).shares as Array<{ grant: { subject: { id: string }; level: string } }>;
    assert.equal(shares.find((s) => s.grant.subject.id === "usr_noah")?.grant.level, "edit", "Noah holds Edit on the project");
  } finally { await stop(d); }
});

test("making a project that fails half way leaves no project behind", async () => {
  const out: Record<string, any> = {};   // eslint-disable-line @typescript-eslint/no-explicit-any
  let lead = "";
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead || !/make a project/.test(input.trigger?.body ?? "")) return;
    yield* run("tool_search", { query: "projects create list" });
    // a starter nobody can give a role to: refused before anything is made
    out["bad"] = yield* run("projects_create", { type: "project", title: "Never made", members: [{ principal: "usr_nobody", role: "member" }], idempotencyKey: "bad1" });
    out["list"] = yield* run("projects_list", {});
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    lead = await makeAgent(d, "Lead");
    const chat = await startChat(d, lead, "setup2");
    await ok(d, "chat.post", { threadId: chat, body: "make a project", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "setup2-post" });
    await waitFor(async () => (out["list"] !== undefined ? true : null), 40_000, () => hostLog(d));
    assert.equal((out["bad"] as Answer).ok, false);
    assert.deepEqual(((out["list"] as Answer).content.data.projects as unknown[]), []);
    assert.equal(((await call(d, "projects.list", {})).data.projects as unknown[]).length, 0);
  } finally { await stop(d); }
});
