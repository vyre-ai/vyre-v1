// The same mirror, pointed at a project's shared folder (agent workspaces, 6 Nov): the root is the project's folder in Files, nothing in it is read-only, every Files call is made as the agent that ran
// the pass (so the file's history says who), and an edit is written with the reason it was given.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHomeSync } from "../handlers/home.ts";
import { sha256b64 } from "../../../kernel/src/seal/index.ts";
import type { HomeFs } from "../handlers/home-fs.ts";

function rig(agentId: string, disk: Map<string, { bytes: Buffer; mtimeMs: number }>, files: Array<{ fileId: string; name: string; folderId: string; version: number; size: number }>, manifest: string) {
  const calls: Array<{ as: string; cap: string; input: any }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const hfs: HomeFs = { async snapshot() { return { files: new Map(disk), dirs: new Set<string>(), refused: [], complete: true }; }, async put() { /* none */ }, async remove() { /* none */ } };
  const callAs = async (as: string, cap: string, input: any): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    calls.push({ as, cap, input });
    if (cap === "agents.get") return { agent: { folderId: "fld_agent_home", ownerId: "usr_a" } };
    if (cap === "files.list") return input.folder === "fld_project" ? { files, folders: [] } : { files: [], folders: [] };
    if (cap === "files.read") return { base64: Buffer.from("old").toString("base64"), truncated: false };
    if (cap === "files.write") return { file: { fileId: input.fileId, version: input.baseVersion + 1 } };
    if (cap === "files.create") return { file: { fileId: "fil_new", version: 1, size: 1 } };
    throw new Error(`unexpected ${cap}`);
  };
  const sync = createHomeSync({ agentId, computerId: "prj_site", fs: hfs, manifest, rootFolder: "fld_project", plain: true, reason: "edited in a workspace" }, { callAs, putBytes: async () => undefined, now: () => 10_000, log: () => undefined });
  return { sync, calls };
}

test("a project mirror reads the project's folder, not the agent's home, and every call is the running agent's", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-prj-"));
  const manifest = path.join(dir, "m.json");
  const disk = new Map([["plan.md", { bytes: Buffer.from("new plan"), mtimeMs: 1 }]]);
  const a = rig("agt_a", disk, [], manifest);
  await a.sync.pass();
  assert.ok(a.calls.filter((c) => c.cap === "files.list").every((c) => c.input.folder === "fld_project"), "the project's folder is the root");
  assert.deepEqual(a.calls.find((c) => c.cap === "files.create")!.as, "agt_a");
  // a second agent, the same manifest: the file exists now, and its edit is Bee's
  const files = [{ fileId: "fil_new", name: "plan.md", folderId: "fld_project", version: 1, size: 1 }];
  disk.set("plan.md", { bytes: Buffer.from("bee's edit"), mtimeMs: 1 });
  const b = rig("agt_b", disk, files, manifest);
  await b.sync.pass();
  const w = b.calls.find((c) => c.cap === "files.write")!;
  assert.deepEqual([w.as, w.input.fileId, w.input.reason], ["agt_b", "fil_new", "edited in a workspace"], "the history names the agent that made the change and where");
});

test("in a project folder AGENT.md and agent.toml are ordinary files; in an agent's home they stay read-only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-prj-"));
  const disk = new Map([["AGENT.md", { bytes: Buffer.from("project readme"), mtimeMs: 1 }]]);
  const files = [{ fileId: "fil_r", name: "AGENT.md", folderId: "fld_project", version: 1, size: 3 }];
  const manifest = path.join(dir, "m.json");
  fs.writeFileSync(manifest, JSON.stringify({ files: { "AGENT.md": { fileId: "fil_r", version: 1, sha: sha256b64(Buffer.from("old")) } }, folders: {} }));   // the last pass left "old" there
  const r = rig("agt_a", disk, files, manifest);
  await r.sync.pass();
  assert.equal(r.calls.some((c) => c.cap === "files.write"), true, "the edit goes up like any file's");
  assert.equal(r.calls.some((c) => c.cap === "agents.suggestion.propose"), false, "it is not turned into a suggestion for the agent's owner");
});
