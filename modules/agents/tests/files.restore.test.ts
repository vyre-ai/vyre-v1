// agents: the boot check. Every agent's AGENT.md and agent.toml are in Agents/<name>; a missing one is put back from the agent record (P-L5_30).
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { restoreAgentFiles } from "../handlers/crud.ts";
import { AGENT_MD_DEFAULT } from "../projections.ts";
import { harness } from "../fixtures/harness.ts";
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
