// P-L5_30: an agent folder is never empty. Boot a daemon on the real `small` seed: some of its agents come from agents.create, the rest are principals written straight to the log. After the boot
// pass of the agents module every agent of the seed, however it was made, has a record, its Agents/<name> folder and both files. The seed is built (or copied) once for this file.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SMALL_TARGET } from "./recipe.ts";
import { bootSmall, startSeeded } from "./build.ts";

const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "small-agent-files-"));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("after one boot pass every agent of the small seed has a record, a folder, AGENT.md and agent.toml", async () => {
  const s = await bootSmall({ cache: scratch(), scratch: scratch() });
  const d = await startSeeded(s.dir);
  try {
    const rowsOf = (sql: string): Record<string, unknown>[] => d.db!.all(sql) as Record<string, unknown>[];
    const complete = (): boolean => {
      const agents = rowsOf("SELECT id, folderId, tomlFileId, agentMdFileId FROM agents_agent WHERE deletedAt IS NULL");
      if (agents.length < SMALL_TARGET.agents) return false;
      return agents.every((a) => rowsOf(`SELECT id, name FROM files_file WHERE folder_id = '${String(a["folderId"])}' AND deleted_at IS NULL`).filter((f) =>
        (f["name"] === "AGENT.md" && f["id"] === a["agentMdFileId"]) || (f["name"] === "agent.toml" && f["id"] === a["tomlFileId"])).length === 2);
    };
    const deadline = Date.now() + 60_000;
    while (!complete() && Date.now() < deadline) await sleep(250);
    const agents = rowsOf("SELECT id, name, folderId, tomlFileId, agentMdFileId FROM agents_agent WHERE deletedAt IS NULL");
    const seeded = new DatabaseSync(path.join(s.dir, "events.db"), { readOnly: true });
    let missing: string[] = [];
    try {
      const ids = (seeded.prepare("SELECT json_extract(CAST(payload AS TEXT), '$.id') AS id, json_extract(CAST(payload AS TEXT), '$.name') AS name FROM events WHERE type = 'principal.created' AND json_extract(CAST(payload AS TEXT), '$.kind') = 'agent'").all() as { id: string; name: string }[]);
      missing = ids.filter((p) => !agents.some((a) => a["id"] === p.id)).map((p) => `${p.id} (${p.name})`);
    } finally { seeded.close(); }
    assert.ok(agents.length >= SMALL_TARGET.agents, `every agent of the seed (${SMALL_TARGET.agents}) has a record, found ${agents.length}; no record for ${missing.join(", ") || "none"}`);
    for (const a of agents) {
      const names = rowsOf(`SELECT id, name FROM files_file WHERE folder_id = '${String(a["folderId"])}' AND deleted_at IS NULL`);
      assert.ok(names.some((f) => f["name"] === "AGENT.md" && f["id"] === a["agentMdFileId"]), `${String(a["name"])} has its AGENT.md`);
      assert.ok(names.some((f) => f["name"] === "agent.toml" && f["id"] === a["tomlFileId"]), `${String(a["name"])} has its agent.toml`);
    }
    const principals = new DatabaseSync(path.join(s.dir, "events.db"), { readOnly: true });
    try {
      const n = (principals.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'principal.created' AND json_extract(CAST(payload AS TEXT), '$.kind') = 'agent'").get() as { n: number }).n;
      assert.equal(n, SMALL_TARGET.agents, "the seed holds the target number of agent principals, and each has a record above");
    } finally { principals.close(); }
  } finally { await d.stop(); s.close(); }
});
