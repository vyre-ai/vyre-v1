// agents: the boot check. Every agent's AGENT.md and agent.toml are in Agents/<name>; a missing one is put back from the agent record (P-L5_30).
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { restoreAgentFiles } from "../handlers/crud.ts";
import { AGENT_MD_DEFAULT } from "../projections.ts";
import { DANA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const make = async (hn: Harness, name = "Intake"): Promise<any> => (await h["agents.create"]!(hn.ctx, { name, role: "Use me when a new client form arrives.", idempotencyKey: `rk${++n}` })).agent;   // eslint-disable-line @typescript-eslint/no-explicit-any
const record = (hn: Harness, id: string): Record<string, unknown> => hn.rows("SELECT * FROM agents_agent WHERE id = ?", id)[0]!;

test("nothing is missing: the check changes nothing and asks Files for no file to be made, moved or restored", async () => {
  const hn = harness();
  await make(hn);
  hn.clear();
  assert.deepEqual(await restoreAgentFiles(hn.ctx), []);
  for (const cap of ["files.create", "files.restore", "files.move"]) assert.equal(hn.world.calls.filter((c) => c.cap === cap).length, 0, cap);
});

test("a file in Trash is restored with its history; a file moved away or renamed is put back; a file that is gone is made again from the record", async () => {
  const hn = harness();
  const a = await make(hn);
  const home = String(record(hn, a.agentId)["folderId"]);
  const toml = String(record(hn, a.agentId)["tomlFileId"]);
  const md = String(record(hn, a.agentId)["agentMdFileId"]);
  const other = hn.world.folderNamed("memory", home)!.folderId;

  await hn.world.handlers["files.delete"]!({ fileId: toml });
  assert.deepEqual(await restoreAgentFiles(hn.ctx), ["Intake/agent.toml"]);
  assert.equal(hn.world.files.get(toml)?.deletedAt, undefined, "the same file is back, with its versions");
  assert.equal(hn.world.files.get(toml)?.folderId, home);

  const f = hn.world.files.get(md)!;
  f.folderId = other;
  f.name = "notes.md";
  assert.deepEqual(await restoreAgentFiles(hn.ctx), ["Intake/AGENT.md"]);
  assert.deepEqual([f.folderId, f.name], [home, "AGENT.md"]);

  hn.world.files.delete(md);
  assert.deepEqual(await restoreAgentFiles(hn.ctx), ["Intake/AGENT.md"]);
  const made = hn.world.fileIn(home, "AGENT.md")!;
  assert.equal(String(record(hn, a.agentId)["agentMdFileId"]), made.fileId, "the record points at the new file");
  assert.equal(hn.world.text(made.fileId), AGENT_MD_DEFAULT("Intake", "Use me when a new client form arrives."));

  hn.world.files.delete(toml);
  assert.deepEqual(await restoreAgentFiles(hn.ctx), ["Intake/agent.toml"]);
  const again = hn.world.fileIn(home, "agent.toml")!;
  assert.equal(hn.world.text(again.fileId), String(record(hn, a.agentId)["tomlText"]), "agent.toml comes back as the last good text the record keeps");
  assert.deepEqual(await restoreAgentFiles(hn.ctx), [], "and the next check finds nothing to do");
});

test("every agent is checked, a deleted agent is not, and one that Files cannot fix does not stop the others", async () => {
  const hn = harness();
  const a = await make(hn, "Alpha");
  const b = await make(hn, "Beta");
  const c = await make(hn, "Gamma");
  hn.world.files.delete(String(record(hn, a.agentId)["agentMdFileId"]));
  hn.world.files.delete(String(record(hn, b.agentId)["agentMdFileId"]));
  hn.world.files.delete(String(record(hn, c.agentId)["agentMdFileId"]));
  hn.ctx.db.run("UPDATE agents_agent SET deletedAt = ? WHERE id = ?", 1, c.agentId);
  const create = hn.world.handlers["files.create"]!;
  hn.world.answer("files.create", () => { throw Object.assign(new Error("down"), { error: { code: "internal.unavailable", message: "down" } }); });
  assert.deepEqual(await restoreAgentFiles(hn.ctx), [], "Files is down: nothing is put back, nothing throws");
  assert.ok(hn.warned.length > 0, "and it says so in the log");
  hn.world.answer("files.create", create);
  assert.deepEqual((await restoreAgentFiles(hn.ctx)).sort(), ["Alpha/AGENT.md", "Beta/AGENT.md"], "Files is back: every live agent is put right, the deleted one is left alone");
});

test("an agent access knows with no record gets one, with Agents/<name>, both files and the decided tree; one with no owner or a name already taken is left alone", async () => {
  const hn = harness();
  hn.world.principals.push(
    { id: "agt_scout", kind: "agent", name: "Scout", owner: DANA, status: "active" },
    { id: "agt_orphan", kind: "agent", name: "Orphan", status: "active" },
    { id: "agt_gone", kind: "agent", name: "Gone", owner: DANA, status: "removed" },
  );
  await make(hn, "Taken");
  hn.world.principals.push({ id: "agt_twin", kind: "agent", name: "Taken", owner: DANA, status: "active" });
  assert.deepEqual((await restoreAgentFiles(hn.ctx)).sort(), ["Scout/AGENT.md", "Scout/agent.toml"]);
  const rec = hn.rows("SELECT * FROM agents_agent WHERE id = 'agt_scout'")[0]!;
  assert.equal(rec["name"], "Scout");
  assert.equal(rec["ownerId"], DANA);
  const home = String(rec["folderId"]);
  assert.equal(hn.world.fileIn(home, "AGENT.md")?.fileId, rec["agentMdFileId"]);
  assert.equal(hn.world.fileIn(home, "agent.toml")?.fileId, rec["tomlFileId"]);
  assert.ok(hn.world.tree(home).includes("memory/"), "the decided tree is there");
  assert.equal(hn.rows("SELECT * FROM agents_agent WHERE id IN ('agt_orphan', 'agt_gone', 'agt_twin')").length, 0);
  assert.deepEqual(await restoreAgentFiles(hn.ctx), [], "the next pass finds nothing to do");
});

test("a record with no folder or no file ids is given Agents/<name> and both files", async () => {
  const hn = harness();
  const a = await make(hn, "Lost");
  hn.ctx.db.run("UPDATE agents_agent SET folderId = NULL, tomlFileId = NULL, agentMdFileId = NULL WHERE id = ?", a.agentId);
  assert.deepEqual((await restoreAgentFiles(hn.ctx)).sort(), ["Lost/AGENT.md", "Lost/agent.toml"]);
  const r = record(hn, a.agentId);
  assert.ok(r["folderId"] && r["tomlFileId"] && r["agentMdFileId"], "the record points at them again");
  assert.equal(hn.world.text(String(r["tomlFileId"])), String(r["tomlText"]));
});

test("an outside agent is never adopted: it is an outside actor, not an agent of the Space, and gets no record, folder or files", async () => {
  const hn = harness();
  hn.world.principals.push(
    { id: "act_claudecode1", kind: "actor", name: "Claude Code", owner: DANA, status: "active" },
    { id: "act_codex1", kind: "actor", name: "Codex", status: "active" },
    { id: "agt_scout", kind: "agent", name: "Scout", owner: DANA, status: "active" },
  );
  assert.deepEqual((await restoreAgentFiles(hn.ctx)).sort(), ["Scout/AGENT.md", "Scout/agent.toml"], "only the Space's own agent");
  assert.equal(hn.rows("SELECT * FROM agents_agent").length, 1);
  assert.equal(hn.world.folderNamed("Claude Code", hn.world.root), undefined);
  assert.equal(hn.world.folderNamed("Codex", hn.world.root), undefined);
  // and a list that ignored the kind filter still adopts no actor, and no agent whose id is not an agent id
  hn.world.answer("access.principals.list", () => ({ principals: [
    { id: "act_claudecode1", kind: "actor", name: "Claude Code", owner: DANA, status: "active" },
    { id: "ext_agent9", kind: "agent", name: "Imported", owner: DANA, status: "active" },
  ] }));
  assert.deepEqual(await restoreAgentFiles(hn.ctx), []);
  assert.equal(hn.rows("SELECT * FROM agents_agent").length, 1);
});

// ---- ruling 99: the agent edits its own home, its owner manages it ----------------------------------------------------------------------------------------

const onHome = (hn: Harness, home: string): string[] => hn.world.homeGrants.filter((g) => g.resource.id === home).map((g) => `${g.subject.kind}:${g.subject.id}:${g.level}:${g.source}`).sort();
const shareCalls = (hn: Harness) => hn.world.calls.filter((c) => c.cap === "access.share");

test("create gives the agent Edit on its own folder (not Manage) and its owner Manage, and nothing else", async () => {
  const hn = harness();
  const a = await make(hn);
  const home = String(record(hn, a.agentId)["folderId"]);
  assert.deepEqual(onHome(hn, home), [], "creation grants are emitted at the gateway commit boundary");
  assert.equal(shareCalls(hn).length, 0, "creation does not call access.share before the principal exists");
});

test("the boot pass adds the grants an agent made before the ruling lacks, once, and only those two", async () => {
  const hn = harness();
  const a = await make(hn);
  const home = String(record(hn, a.agentId)["folderId"]);
  hn.world.homeGrants.length = 0;   // an agent made before ruling 99: no grants and no marker
  hn.ctx.db.run("DELETE FROM agents_meta WHERE key = ?", `agents.home_grants.v1:${a.agentId}`);
  hn.clear();
  assert.deepEqual(await restoreAgentFiles(hn.ctx), ["Intake/grants"]);
  assert.deepEqual(onHome(hn, home), [`agent:${a.agentId}:edit:agent:${a.agentId}`, `person:${DANA}:manage:agent:${a.agentId}`].sort());
  assert.equal(shareCalls(hn).length, 2);
  assert.deepEqual(shareCalls(hn).map((c) => [(c.input as { idempotencyKey: string }).idempotencyKey, c.opts?.idempotencyKey]), [
    [`agent-home:${a.agentId}:agent`, `agent-home:${a.agentId}:agent`],
    [`agent-home:${a.agentId}:owner:${DANA}`, `agent-home:${a.agentId}:owner:${DANA}`],
  ]);
  hn.clear();
  assert.deepEqual(await restoreAgentFiles(hn.ctx), [], "the next pass writes nothing");
  assert.equal(hn.world.calls.filter((c) => c.cap === "access.share").length, 0);
});

test("a person's choice stands: lower or remove the agent's grant after the pass and later passes leave it as it is", async () => {
  const hn = harness();
  const a = await make(hn);
  const home = String(record(hn, a.agentId)["folderId"]);
  assert.deepEqual(await restoreAgentFiles(hn.ctx), [], "made with its grants, marked done");
  // an admin lowers the agent to view and takes the owner's grant away
  const agentGrant = hn.world.homeGrants.find((g) => g.subject.kind === "agent" && g.resource.id === home)!;
  agentGrant.level = "view";
  hn.world.homeGrants.splice(hn.world.homeGrants.findIndex((g) => g.subject.kind === "person" && g.resource.id === home), 1);
  hn.clear();
  assert.deepEqual(await restoreAgentFiles(hn.ctx), []);
  assert.deepEqual(await restoreAgentFiles(hn.ctx), []);
  assert.equal(hn.world.calls.filter((c) => c.cap === "access.share").length, 0, "no grant is written again");
  assert.deepEqual(onHome(hn, home), [`agent:${a.agentId}:view:agent:${a.agentId}`], "the lowered grant stays lowered, the removed one stays removed");
});

test("the marker is only set once the grants are written: a failure is tried again next pass", async () => {
  const hn = harness();
  const a = await make(hn);
  hn.world.homeGrants.length = 0;
  hn.ctx.db.run("DELETE FROM agents_meta WHERE key = ?", `agents.home_grants.v1:${a.agentId}`);
  const share = hn.world.handlers["access.share"]!;
  hn.world.answer("access.share", () => { throw Object.assign(new Error("down"), { error: { code: "internal.unavailable", message: "down" } }); });
  assert.deepEqual(await restoreAgentFiles(hn.ctx), [], "access is down: nothing written, nothing throws");
  hn.world.answer("access.share", share);
  assert.deepEqual(await restoreAgentFiles(hn.ctx), ["Intake/grants"], "access is back: the grants are written now");
});

test("an adopted agent gets the same two grants on its new folder", async () => {
  const hn = harness();
  hn.world.principals.push({ id: "agt_scout", kind: "agent", name: "Scout", owner: DANA, status: "active" });
  await restoreAgentFiles(hn.ctx);
  const home = String(record(hn, "agt_scout")["folderId"]);
  assert.deepEqual(onHome(hn, home), [`agent:agt_scout:edit:agent:agt_scout`, `person:${DANA}:manage:agent:agt_scout`].sort());
});
