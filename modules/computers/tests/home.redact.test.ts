// Redaction for AI on the agent's computer: the home mirror reads Files as the agent (origin computers), so the read gate answers it. A file the gate refuses (Not available, waiting for review, a
// picture with parts hidden) never comes down, and a copy the computer already holds from before leaves it, without counting as a failure.
// @reads /modules/computers/handlers/home.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHomeSync } from "../handlers/home.ts";
import type { HomeFs } from "../handlers/home-fs.ts";

const refusal = (reason: string) => Object.assign(new Error("hidden from AI"), { error: { code: "permission.no_grant", details: { reason } } });

function rig(refuse: Record<string, string>) {
  const disk = new Map<string, { bytes: Buffer; mtimeMs: number }>();
  const written: string[] = [], removed: string[] = [];
  const hfs: HomeFs = {
    async snapshot() { return { files: new Map(disk), dirs: new Set<string>(), refused: [], complete: true }; },
    async put(items) { for (const i of items) { written.push(i.rel); disk.set(i.rel, { bytes: Buffer.from(i.bytes), mtimeMs: 1 }); } },
    async remove(files) { for (const f of files) { removed.push(f); disk.delete(f); } },
  };
  let version = 1;
  const callAs = async (_a: string, cap: string, input: any): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (cap === "agents.get") return { agent: { folderId: "fld_home", ownerId: "usr_irfad" } };
    if (cap === "files.list") return { files: [{ fileId: "fil_intake", name: "intake.pdf", version, folderId: "fld_home" }, { fileId: "fil_notes", name: "notes.txt", version: 1, folderId: "fld_home" }], folders: [] };
    if (cap === "files.read") { const why = refuse[input.fileId]; if (why) throw refusal(why); return { base64: Buffer.from(`body of ${input.fileId}`).toString("base64"), truncated: false }; }
    throw new Error(`unexpected ${cap}`);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-redact-home-"));
  const sync = createHomeSync({ agentId: "agt_intake", computerId: "cmt_a", fs: hfs, manifest: path.join(dir, "m.json") }, { callAs, putBytes: async () => undefined, now: () => 10_000, log: () => undefined });
  return { sync, written, removed, disk, bump: () => { version++; } };
}

test("a file the read gate refuses never comes down to the agent's computer, and is not a failure", async () => {
  const r = rig({ fil_intake: "needs_review" });
  const out = await r.sync.pass();
  assert.deepEqual(r.written, ["notes.txt"]);
  assert.equal(out.failed, 0);
  assert.equal(out.hidden, 1);
});

test("a copy mirrored before the file was redacted leaves the computer when the gate starts refusing it", async () => {
  const refuse: Record<string, string> = {};
  const r = rig(refuse);
  await r.sync.pass();
  assert.ok(r.disk.has("intake.pdf"), "mirrored while it was clear");
  refuse["fil_intake"] = "redacted_binary";
  r.bump();
  const out = await r.sync.pass();
  assert.deepEqual(r.removed, ["intake.pdf"]);
  assert.ok(!r.disk.has("intake.pdf"));
  assert.equal(out.failed, 0);
});
