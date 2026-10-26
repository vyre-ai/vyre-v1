// P-L5_30: an agent folder is never empty. In the real `small` seed, built through agents.create on a booted daemon, every agent the module made has AGENT.md and agent.toml in its Agents/<name>
// folder, and the record points at those two files. The seed is built (or copied) once for this file.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootSmall } from "./build.ts";

const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "small-agent-files-"));

test("every agent made through agents.create holds AGENT.md and agent.toml in its folder, and its record names those files", async () => {
  const s = await bootSmall({ cache: scratch(), scratch: scratch() });
  try {
    const file = path.join(s.dir, "modules.db");
    if (!fs.existsSync(file)) { assert.equal(s.agentsByModule, 0, "no modules.db means no agent was made through the module"); return; }
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const table = (name: string): boolean => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
      if (!table("agents_agent") || !table("files_file")) { assert.equal(s.agentsByModule, 0, "agents or files has no table, so no agent was made through the module"); return; }
      const agents = db.prepare("SELECT id, name, folderId, tomlFileId, agentMdFileId FROM agents_agent WHERE deletedAt IS NULL").all() as { id: string; name: string; folderId: string; tomlFileId: string; agentMdFileId: string }[];
      assert.equal(agents.length, s.agentsByModule, "every agent the builder counted is a row");
      for (const a of agents) {
        const inFolder = (db.prepare("SELECT id, name FROM files_file WHERE folder_id = ? AND deleted_at IS NULL").all(a.folderId) as { id: string; name: string }[]);
        assert.ok(inFolder.some((f) => f.name === "AGENT.md" && f.id === a.agentMdFileId), `${a.name} has its AGENT.md`);
        assert.ok(inFolder.some((f) => f.name === "agent.toml" && f.id === a.tomlFileId), `${a.name} has its agent.toml`);
      }
    } finally { db.close(); }
  } finally { s.close(); }
});
