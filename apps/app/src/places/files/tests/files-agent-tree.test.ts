// The Files sample's agent folders hold what agents.create really makes (P-L9e_29): the decided tree, AGENT.md, agent.toml, memory/MAP.md and the guide, with Modified and Made by filled, under
// neutral names; and every read the list sends is accepted by the generated validators, as the real handler would accept it.
// @reads /modules/agents/projections.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_TREE, createSampleFiles, northwind } from "../list/sample.ts";
import { validateInput } from "../../../../../../generated/validators.ts";

test("the sample's agent tree is the one agents.create makes", () => {
  const src = readFileSync(new URL("../../../../../../modules/agents/projections.ts", import.meta.url), "utf8");
  const m = /export const TREE_FOLDERS: readonly string\[\] = \[([^\]]*)\]/.exec(src);
  assert.ok(m, "TREE_FOLDERS is declared in the agents module");
  const real = [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual([...AGENT_TREE], real);
});

test("every agent folder holds the decided tree and its files, each with Modified and Made by, and no folder is called Rivera matter", () => {
  const s = createSampleFiles(northwind, { subjects: true });
  const folders = s.replica.rows("folders") as unknown as { id: string; name: string; parent: string | null; subject?: { kind: string; id?: string } }[];
  const files = s.replica.rows("files") as unknown as { fileId: string; name: string; folderId: string; updatedAt: number; updatedBy: string; ownerId: string }[];
  const homes = folders.filter((x) => x.subject?.kind === "agent" && x.subject.id !== undefined);
  assert.ok(homes.length >= 5);
  for (const home of homes) {
    const kids = folders.filter((x) => x.parent === home.id).map((x) => x.name).sort();
    assert.deepEqual(kids, [".vyre", "chats", "downloads", "inbox", "knowledge", "logs", "memory", "routines", "skills", "work"].sort(), `${home.name}: the top of the tree`);
    const own = files.filter((x) => x.folderId === home.id).map((x) => x.name);
    assert.ok(own.includes("AGENT.md") && own.includes("agent.toml"), `${home.name}: AGENT.md and agent.toml`);
    const memory = folders.find((x) => x.parent === home.id && x.name === "memory")!;
    assert.ok(files.some((x) => x.folderId === memory.id && x.name === "MAP.md"), `${home.name}: memory/MAP.md`);
    const dotVyre = folders.find((x) => x.parent === home.id && x.name === ".vyre")!;
    assert.ok(files.some((x) => x.folderId === dotVyre.id && x.name === "guide.md"), `${home.name}: .vyre/guide.md`);
  }
  const made = files.filter((x) => ["AGENT.md", "agent.toml", "MAP.md", "guide.md"].includes(x.name));
  assert.ok(made.length >= homes.length * 4);
  for (const x of made) assert.ok(x.updatedAt > 0 && x.updatedBy !== "" && x.ownerId !== "", `${x.name}: Modified and Made by are filled`);
  assert.ok(!folders.some((x) => /rivera/i.test(x.name)), "no folder is named after a client");
  // the list leaves a folder hidden by name out
  const list = s.replica.run("files.list", { folder: homes[0]!.id })!.data as { folders: { name: string }[] };
  assert.ok(!list.folders.some((x) => x.name === ".vyre"), ".vyre is not listed");
  assert.ok(list.folders.some((x) => x.name === "memory"));
});

test("the sample's own folder and file ids are ids the contract accepts, so every read it is sent passes the generated validators", () => {
  const s = createSampleFiles(northwind, { subjects: true });
  const folders = s.replica.rows("folders") as unknown as { id: string }[];
  for (const x of folders) assert.deepEqual(validateInput("files.list", 1, { folder: x.id }), [], x.id);
  for (const x of folders.slice(0, 40)) s.replica.run("files.list", { folder: x.id });
  assert.deepEqual(s.rejected, [], "no read was refused");
  assert.notDeepEqual(validateInput("files.list", 1, { folder: "fld_not_an_id" }), [], "an id the contract refuses is refused here too");
});
