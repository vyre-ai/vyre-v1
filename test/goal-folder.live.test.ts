// A goal's Files folder as goal/ for a terminal engine, on a booted daemon (lane l-engine21): the daemon, Files, goals, chat and the read gate are real; the engine is a scripted session that
// does what Claude Code does in its work folder (reads, edits and adds files on disk). The sync around its turns is the production wrapper (modules/engine/goal-folder.ts).
// Covers: a turn that reads, edits and adds a file in goal/ (and the versions in Vyre after), a file changed in Vyre during the turn (kept as both), and the read gate (a Not available file never on
// disk, a Redacted file written redacted and never uploaded over the original).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boot, call, clock, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { workFolder } from "../modules/engine/sandbox.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

let keys = 0;
const ok = async (d: Awaited<ReturnType<typeof boot>>, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `gfl-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

/** The sync after a turn runs just before the turn is done; look until what it should have done is there. */
async function eventually(f: () => Promise<void>): Promise<void> {
  const end = Date.now() + 20_000;
  for (;;) { try { await f(); return; } catch (e) { if (Date.now() > end) throw e; await new Promise<void>((r) => setTimeout(r, 250)); } }
}

test("goal folder live: a goal turn reads, edits and adds files in goal/; a change made in Vyre meanwhile is kept as both; hidden files stay off the disk", { timeout: 120_000 }, async () => {
  const dir = seededDir();
  let script: ((work: string) => Promise<void>) | null = null;
  let turns = 0;
  const open: OpenSession = async () => ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const work = workFolder(dir, input.asker, input.threadId, input.agent.id);
      const s = script; script = null;
      if (s) await s(work);
      turns++;
      yield { type: "text", text: "Done." };
      yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as EngineSession);
  const d = await boot(dir, open);
  const pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  try {
    await connect(d);
    const desk = await newAgent(d, "Lab Desk");
    const made = await ok(d, "goals.create", {
      title: "Ship the brief", finish: { kind: "owner", line: "The owner says the brief is shipped" },
      deadline: clock.t + 4 * 86_400_000, leadAgentId: desk.id, rhythm: { every: "hours", hours: 6 }, quiet: null, zone: "UTC", stuckAfter: 3, budget: { turns: 60 },
    });
    const goalId = made.goal.id as string, threadId = made.goal.threadId as string;
    await waitFor(async () => (turns >= 1 ? true : null), 40_000, () => hostLog(d));   // the first wake-up, with an empty folder
    const root = (await ok(d, "goals.folder", { goalId })).folderId as string;
    const research = (await ok(d, "goals.folder", { goalId, sub: "Research" })).folderId as string;
    const mk = async (folderId: string, name: string, text: string): Promise<string> => (await ok(d, "files.create", { folderId, name, content: { text } })).file.fileId as string;
    const plan = await mk(root, "plan.md", "step one\n");
    await mk(research, "notes.md", "market notes");
    const secret = await mk(root, "secret.md", "SSN 123-45-6789 of Jane Roe");
    await ok(d, "files.agent_access.set", { target: { type: "file", id: secret }, value: "off" });
    const client = await mk(root, "client.md", "Client Jane Roe, SSN 123-45-6789, wants the brief by Friday");
    await ok(d, "files.marks.add", { target: { type: "file", id: client }, kind: "redact", shape: "span", text: "Jane Roe" });
    await ok(d, "files.marks.add", { target: { type: "file", id: client }, kind: "redact", shape: "span", text: "123-45-6789" });

    const wake = async (body: string, k: string): Promise<void> => {
      const before = turns;
      await ok(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: desk.id }], idempotencyKey: k });
      await waitFor(async () => (turns > before ? true : null), 40_000, () => hostLog(d));
      await new Promise<void>((r) => setTimeout(r, 300));
    };
    const seen: Record<string, string> = {};
    // ---- turn 1: read, edit, add, and a try at the redacted file
    script = async (work) => {
      const g = path.join(work, "goal");
      for (const f of fs.readdirSync(g, { recursive: true }).map(String)) if (fs.statSync(path.join(g, f)).isFile()) seen[f] = fs.readFileSync(path.join(g, f), "utf8");
      fs.appendFileSync(path.join(g, "plan.md"), "step two\n");
      fs.mkdirSync(path.join(g, "Drafts"), { recursive: true });
      fs.writeFileSync(path.join(g, "Drafts", "email.md"), "Hello team");
      fs.chmodSync(path.join(g, "client.md"), 0o644);
      fs.appendFileSync(path.join(g, "client.md"), "\nAgent note");
    };
    await wake("work on it", "w1");
    assert.deepEqual(Object.keys(seen).sort(), ["Research/notes.md", "client.md", "plan.md"].sort(), "the Not available file is not on disk");
    assert.equal(seen["plan.md"], "step one\n");
    assert.equal(seen["Research/notes.md"], "market notes");
    assert.ok(!/Jane Roe|123-45-6789/.test(JSON.stringify(seen)), `redacted text only: ${seen["client.md"]}`);
    assert.match(seen["client.md"]!, /REDACTED/);
    await eventually(async () => {
    const planNow = (await ok(d, "files.read", { fileId: plan })).text as string;
    assert.equal(planNow, "step one\nstep two\n");
    assert.equal((await ok(d, "files.versions", { fileId: plan })).versions.length, 2, "a new version of the same file");
    const drafts = (await ok(d, "files.list", { folder: root })).folders.find((f: { name: string }) => f.name === "Drafts");
    assert.ok(drafts, "the new folder is in Vyre");
    assert.deepEqual((await ok(d, "files.list", { folder: drafts.folderId })).files.map((f: { name: string }) => f.name), ["email.md"]);
    const rootFiles = (await ok(d, "files.list", { folder: root })).files.map((f: { name: string }) => f.name).sort();
    assert.deepEqual(rootFiles, ["client (agent copy).md", "client.md", "plan.md", "secret.md"].sort());
    assert.equal((await ok(d, "files.read", { fileId: client })).text, "Client Jane Roe, SSN 123-45-6789, wants the brief by Friday", "the original of the redacted file is untouched");
    assert.equal((await ok(d, "files.versions", { fileId: client })).versions.length, 1);
    });

    // ---- turn 2: someone saves plan.md in Vyre while the agent works on its copy
    script = async (work) => {
      fs.appendFileSync(path.join(work, "goal", "plan.md"), "agent step three\n");
      await ok(d, "files.write", { fileId: plan, content: { text: "step one\nstep two\nthe owner's own line\n" } });
    };
    await wake("again", "w2");
    await eventually(async () => {
    assert.equal((await ok(d, "files.read", { fileId: plan })).text, "step one\nstep two\nthe owner's own line\n", "the person's version stays");
    const copy = (await ok(d, "files.list", { folder: root })).files.find((f: { name: string }) => f.name === "plan (agent copy).md");
    assert.ok(copy, "the agent's version is kept beside it");
    assert.equal((await ok(d, "files.read", { fileId: copy.fileId })).text, "step one\nstep two\nagent step three\n");
    });
    // ---- turn 3: the next turn finds Vyre's version on disk, and the copy
    const again: Record<string, string> = {};
    script = async (work) => { const g = path.join(work, "goal"); for (const f of ["plan.md", "plan (agent copy).md"]) again[f] = fs.readFileSync(path.join(g, f), "utf8"); };
    await wake("once more", "w3");
    assert.equal(again["plan.md"], "step one\nstep two\nthe owner's own line\n");
    assert.equal(again["plan (agent copy).md"], "step one\nstep two\nagent step three\n");
    // ---- turn 4: a few MB goes up through an upload slot, and a file deleted in goal/ goes to Trash with an Undo line
    const draftsF = (await ok(d, "files.list", { folder: root })).folders.find((f: { name: string }) => f.name === "Drafts");
    const notes = (await ok(d, "files.list", { folder: research })).files.find((f: { name: string }) => f.name === "notes.md");
    script = async (work) => {
      fs.writeFileSync(path.join(work, "goal", "Drafts", "big.bin"), Buffer.alloc(3 * 1024 * 1024, 5));
      fs.rmSync(path.join(work, "goal", "Research", "notes.md"));
    };
    await wake("big one", "w4");
    await eventually(async () => {
      const big = (await ok(d, "files.list", { folder: draftsF.folderId })).files.find((f: { name: string }) => f.name === "big.bin");
      assert.ok(big, "the big file is in Vyre");
      assert.equal(big.size, 3 * 1024 * 1024);
      assert.deepEqual((await ok(d, "files.list", { folder: research })).files.map((f: { name: string }) => f.name), [], "notes.md left the folder");
      const trash = (await ok(d, "files.trash.list", {})).files.map((f: { fileId: string }) => f.fileId);
      assert.ok(trash.includes(notes.fileId), "it is in Trash, not gone");
    });
    const line = await waitFor(async () => {
      const msgs = (await ok(d, "chat.messages.list", { threadId, limit: 100 })).messages as Array<{ blocks?: Array<{ type: string; data: { state?: string; text?: string; fileIds?: string[] } }> }>;
      return msgs.flatMap((m) => m.blocks ?? []).find((b) => b.type === "turn_status" && b.data.state === "trashed") ?? null;
    }, 20_000, () => hostLog(d));
    assert.match(line.data.text!, /^Moved a file deleted in goal\/ to Vyre's Trash: Research\/notes\.md\.$/);
    assert.deepEqual(line.data.fileIds, [notes.fileId]);
    // Undo
    await ok(d, "files.restore", { fileId: line.data.fileIds![0] });
    assert.deepEqual((await ok(d, "files.list", { folder: research })).files.map((f: { name: string }) => f.name), ["notes.md"]);
  } finally { clearInterval(pumping); await d.stop(); }
});
