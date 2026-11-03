// A goal's folder as goal/ (modules/engine/goal-folder.ts) against an in-memory Files: download at the start, upload at the end as new versions, a file changed in Vyre during the turn kept as both,
// Not available and Needs review files never on disk, a Redacted file written redacted, read-only and never uploaded over the original, an unfinished turn's edits saved first.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GOAL_NOTES, MAX_UP, diskName, endOfTurn, startOfTurn } from "../goal-folder.ts";
import type { GoalFolderPorts, GoalTurn } from "../goal-folder.ts";

interface F { id: string; folder: string; name: string; bytes: Buffer; version: number; state: "clear" | "hidden" | "reviewed" | "needs_review" | "off"; shown?: string; kind?: string }
interface D { id: string; parent: string | null; name: string; value: "on" | "off" }
const err = (code: string): Error => Object.assign(new Error(code), { error: { code } });

function world() {
  const files: F[] = [];
  const dirs: D[] = [{ id: "fld_root", parent: null, name: "Goal", value: "on" }];
  const writes: Array<{ cap: string; input: Record<string, unknown> }> = [];
  let n = 0;
  const put = (folder: string, name: string, text: string, extra: Partial<F> = {}): F => { const f: F = { id: `fil_${++n}`, folder, name, bytes: Buffer.from(text), version: 1, state: "clear", ...extra }; files.push(f); return f; };
  const ports: GoalFolderPorts = {
    async read(cap, input) {
      const i = input as Record<string, unknown>;
      if (cap === "goals.get") return { goal: { folderId: "fld_root" } };
      if (cap === "files.list") return {
        files: files.filter((f) => f.folder === i.folder).map((f) => ({ fileId: f.id, name: f.name, version: f.version, size: f.bytes.length, kind: f.kind ?? "text" })),
        folders: dirs.filter((d) => d.parent === i.folder).map((d) => ({ folderId: d.id, name: d.name })),
      };
      if (cap === "files.agent_states") return { files: files.filter((f) => f.folder === i.folderId).map((f) => ({ fileId: f.id, state: f.state })), folders: dirs.filter((d) => d.parent === i.folderId).map((d) => ({ folderId: d.id, value: d.value })) };
      if (cap === "files.read") {
        const f = files.find((x) => x.id === i.fileId)!;
        if (f.state === "off" || f.state === "needs_review") throw err("permission.no_grant");
        return { base64: (f.state === "clear" ? f.bytes : Buffer.from(f.shown ?? "")).toString("base64"), truncated: false, version: f.version };
      }
      throw new Error(`unexpected read ${cap}`);
    },
    async act(cap, input) {
      const i = input as Record<string, unknown>;
      writes.push({ cap, input: i });
      if (cap === "files.write") {
        const f = files.find((x) => x.id === i.fileId)!;
        if (i.baseVersion !== f.version) throw err("validation.version_conflict");
        f.bytes = Buffer.from(String((i.content as { base64: string }).base64), "base64"); f.version++;
        return { file: { fileId: f.id, version: f.version } };
      }
      if (cap === "files.create") {
        if (files.some((x) => x.folder === i.folderId && x.name === i.name)) throw err("validation.duplicate");
        const f = put(String(i.folderId), String(i.name), "", { bytes: Buffer.from(String((i.content as { base64: string }).base64), "base64") });
        return { file: { fileId: f.id, version: 1 } };
      }
      if (cap === "files.folder.create") {
        if (dirs.some((x) => x.parent === i.parentId && x.name === i.name)) throw err("validation.duplicate");
        const d: D = { id: `fld_${++n}`, parent: String(i.parentId), name: String(i.name), value: "on" }; dirs.push(d);
        return { folder: { folderId: d.id } };
      }
      throw new Error(`unexpected act ${cap}`);
    },
  };
  return { files, dirs, writes, put, ports };
}
const turn = (work: string, k = 1): GoalTurn => ({ work, goalId: "gol_1", agentId: "agt_1", asker: "usr_1", turnId: `trn_${k}` });
const tmp = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-goal-folder-")));
const g = (work: string, rel: string): string => path.join(work, "goal", rel);

test("goal folder: the folder comes down, an edit goes up as a new version, a new file in a new subfolder is created", async () => {
  const w = world(), work = tmp();
  const plan = w.put("fld_root", "plan.md", "step one\n");
  w.dirs.push({ id: "fld_res", parent: "fld_root", name: "Research", value: "on" });
  w.put("fld_res", "notes.md", "notes");
  await startOfTurn(w.ports, turn(work));
  assert.equal(fs.readFileSync(g(work, "plan.md"), "utf8"), "step one\n");
  assert.equal(fs.readFileSync(g(work, "Research/notes.md"), "utf8"), "notes");
  // the agent edits one file, adds one in Research and one in a folder it makes
  fs.writeFileSync(g(work, "plan.md"), "step one\nstep two\n");
  fs.writeFileSync(g(work, "Research/new.md"), "found it");
  fs.mkdirSync(g(work, "Drafts"));
  fs.writeFileSync(g(work, "Drafts/email.md"), "Hello");
  await endOfTurn(w.ports, turn(work));
  assert.equal(plan.version, 2);
  assert.equal(plan.bytes.toString(), "step one\nstep two\n");
  assert.equal(w.files.find((f) => f.name === "new.md")?.folder, "fld_res");
  const drafts = w.dirs.find((d) => d.name === "Drafts")!;
  assert.equal(w.files.find((f) => f.name === "email.md")?.folder, drafts.id);
  assert.equal(w.files.find((f) => f.name === "notes.md")!.version, 1, "an untouched file is not written");
  // a second turn: nothing changed, nothing is written
  const before = w.writes.length;
  await startOfTurn(w.ports, turn(work, 2));
  await endOfTurn(w.ports, turn(work, 2));
  assert.equal(w.writes.length, before);
  assert.equal(fs.existsSync(path.join(work, GOAL_NOTES)), false);
});

test("goal folder: a file changed in Vyre during the turn is kept as both, never overwritten", async () => {
  const w = world(), work = tmp();
  const f = w.put("fld_root", "brief.md", "v1");
  await startOfTurn(w.ports, turn(work));
  fs.writeFileSync(g(work, "brief.md"), "agent version");
  f.bytes = Buffer.from("a person's version"); f.version = 2;   // someone saves in Vyre while the agent works
  await endOfTurn(w.ports, turn(work));
  assert.equal(f.bytes.toString(), "a person's version", "Vyre's version stays");
  const copy = w.files.find((x) => x.name === "brief (agent copy).md")!;
  assert.equal(copy.bytes.toString(), "agent version");
  assert.match(fs.readFileSync(path.join(work, GOAL_NOTES), "utf8"), /brief\.md changed in Vyre while you worked.*brief \(agent copy\)\.md/);
  // the next turn brings Vyre's version down over the stale one, and the copy beside it
  await startOfTurn(w.ports, turn(work, 2));
  assert.equal(fs.readFileSync(g(work, "brief.md"), "utf8"), "a person's version");
  assert.equal(fs.readFileSync(g(work, "brief (agent copy).md"), "utf8"), "agent version");
});

test("goal folder: Not available and Needs review never reach the disk; Redacted comes down redacted, read-only, and an edit of it is a copy", async () => {
  const w = world(), work = tmp();
  w.put("fld_root", "ok.md", "fine");
  w.put("fld_root", "secret.md", "SSN 123-45-6789", { state: "off" });
  w.put("fld_root", "unreviewed.md", "SSN 123-45-6789", { state: "needs_review" });
  const red = w.put("fld_root", "client.md", "Name: Jane Roe, SSN 123-45-6789", { state: "reviewed", shown: "Name: [REDACTED], SSN [REDACTED]" });
  w.dirs.push({ id: "fld_hid", parent: "fld_root", name: "Hidden", value: "off" });
  w.put("fld_hid", "inside.md", "never");
  await startOfTurn(w.ports, turn(work));
  assert.deepEqual(fs.readdirSync(path.join(work, "goal")).sort(), ["client.md", "ok.md"]);
  const all = JSON.stringify(fs.readdirSync(work, { recursive: true }).map((x) => [x, (() => { try { return fs.readFileSync(path.join(work, String(x)), "utf8"); } catch { return ""; } })()]));
  assert.ok(!all.includes("123-45-6789") && !all.includes("Jane Roe") && !all.includes("never"), "nothing hidden is anywhere in the work folder");
  assert.equal(fs.readFileSync(g(work, "client.md"), "utf8"), "Name: [REDACTED], SSN [REDACTED]");
  assert.equal(fs.statSync(g(work, "client.md")).mode & 0o222, 0, "read-only");
  // the agent forces an edit through
  fs.chmodSync(g(work, "client.md"), 0o644);
  fs.writeFileSync(g(work, "client.md"), "Name: [REDACTED], SSN [REDACTED]\nFollow up Monday");
  await endOfTurn(w.ports, turn(work));
  assert.equal(red.bytes.toString(), "Name: Jane Roe, SSN 123-45-6789", "the original is untouched");
  assert.equal(red.version, 1);
  assert.equal(w.files.find((x) => x.name === "client (agent copy).md")?.bytes.toString(), "Name: [REDACTED], SSN [REDACTED]\nFollow up Monday");
  assert.ok(!w.writes.some((x) => x.cap === "files.write"), "no write ever went to a redacted file");
  // a file that became hidden after it was on disk leaves the disk
  w.files.find((x) => x.name === "ok.md")!.state = "off";
  await startOfTurn(w.ports, turn(work, 2));
  assert.equal(fs.existsSync(g(work, "ok.md")), false);
});

test("goal folder: edits an unfinished turn left are saved before the next download, a taken name becomes a copy, big files and links are left alone", async () => {
  const w = world(), work = tmp();
  const f = w.put("fld_root", "a.md", "one");
  await startOfTurn(w.ports, turn(work));
  fs.writeFileSync(g(work, "a.md"), "edited, then the daemon stopped");   // no endOfTurn
  await startOfTurn(w.ports, turn(work, 2));
  assert.equal(f.bytes.toString(), "edited, then the daemon stopped");
  assert.equal(fs.readFileSync(g(work, "a.md"), "utf8"), "edited, then the daemon stopped");
  // a file the agent cannot see has the name the agent picks
  w.put("fld_root", "taken.md", "hidden one", { state: "off" });
  fs.writeFileSync(g(work, "taken.md"), "mine");
  fs.writeFileSync(g(work, "big.bin"), Buffer.alloc(MAX_UP + 1, 1));
  fs.symlinkSync("/etc/hosts", g(work, "link.txt"));
  await endOfTurn(w.ports, turn(work, 2));
  assert.equal(w.files.find((x) => x.name === "taken (agent copy).md")?.bytes.toString(), "mine");
  assert.ok(!w.files.some((x) => x.name === "big.bin" || x.name === "link.txt"));
  assert.match(fs.readFileSync(path.join(work, GOAL_NOTES), "utf8"), /big\.bin is over 256 KB/);
});

test("goal folder: names are safe on disk", () => {
  assert.equal(diskName("a/b\\c.md"), "a_b_c.md");
  assert.equal(diskName(".."), "_");
  assert.equal(diskName("con.txt"), "_con.txt");
  assert.equal(diskName("report. "), "report");
});
