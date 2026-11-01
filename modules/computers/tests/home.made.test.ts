// Files the agent makes on its computer are reported by the home pass (and only those): a new file counts, an edit does not, recordings and hidden folders do not, and a repeat pass reports nothing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHomeSync, worthSaying } from "../handlers/home.ts";
import type { HomeFs } from "../handlers/home-fs.ts";

function rig() {
  const disk = new Map<string, { bytes: Buffer; mtimeMs: number }>();
  const calls: Array<{ cap: string; input: any }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  let n = 0;
  const hfs: HomeFs = {
    async snapshot() { return { files: new Map(disk), dirs: new Set<string>(), refused: [], complete: true }; },
    async put() { /* nothing comes down in these tests */ },
    async remove() { /* none */ },
  };
  const callAs = async (_a: string, cap: string, input: any): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    calls.push({ cap, input });
    if (cap === "agents.get") return { agent: { folderId: "fld_home", ownerId: "usr_a" } };
    if (cap === "files.list") return { files: [], folders: [] };
    if (cap === "files.create") return { file: { fileId: `fil_${++n}`, version: 1, kind: input.name.endsWith(".png") ? "image" : "pdf", size: 3 } };
    if (cap === "files.folder.create") return { folder: { folderId: "fld_sub" } };
    throw new Error(`unexpected ${cap}`);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-made-"));
  const sync = createHomeSync({ agentId: "agt_a", computerId: "cmt_a", fs: hfs, manifest: path.join(dir, "m.json") }, { callAs, putBytes: async () => undefined, now: () => 10_000, log: () => undefined });
  return { disk, sync, calls };
}

test("a file the agent made is reported once, with its Files id; an unchanged repeat reports nothing", async () => {
  const r = rig();
  r.disk.set("Q3.pdf", { bytes: Buffer.from("abc"), mtimeMs: 1 });
  const first = await r.sync.pass();
  assert.deepEqual(first.made, [{ fileId: "fil_1", name: "Q3.pdf", kind: "pdf", size: 3, version: 1 }]);
  assert.deepEqual((await r.sync.pass()).made, []);
});

test("recordings, hidden folders and files still being written are not reported", async () => {
  const r = rig();
  r.disk.set("work/recordings/rcd_1/events.jsonl", { bytes: Buffer.from("x"), mtimeMs: 1 });
  r.disk.set(".cache/a.bin", { bytes: Buffer.from("x"), mtimeMs: 1 });
  r.disk.set("half.pdf", { bytes: Buffer.from("x"), mtimeMs: 9_999 });
  assert.deepEqual((await r.sync.pass()).made, []);
  assert.equal(worthSaying("notes/a.md"), true);
  assert.equal(worthSaying("work/recordings/x/y"), false);
  assert.equal(worthSaying("a/.b/c"), false);
});

test("a file made in a new folder is reported by its own name", async () => {
  const r = rig();
  r.disk.set("reports/chart.png", { bytes: Buffer.from("png"), mtimeMs: 1 });
  const out = await r.sync.pass();
  assert.deepEqual(out.made.map((f) => [f.name, f.kind]), [["chart.png", "image"]]);
});
