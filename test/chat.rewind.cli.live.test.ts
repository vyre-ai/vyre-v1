// Rewind on a real CLI turn on a booted daemon (chat gap G36, G37): the stand-in CLI engine (host/tests/fixtures/fake-cli-driver) writes files in its work folder across three turns; the person goes back to
// the second; the files match; the agent's next turn does not read the later messages; undoing the rewind brings it all back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, call, connect, makeAgent, post, seededDir, waitFor } from "./support/live.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };

/** The agent's work folder: <data>/work/<person>/<thread>/<agent>. */
const folders = (dir: string): string[] => {
  const out: string[] = [];
  const root = path.join(dir, "work");
  for (const p of fs.existsSync(root) ? fs.readdirSync(root) : [])
    for (const t of fs.readdirSync(path.join(root, p)))
      for (const a of fs.readdirSync(path.join(root, p, t))) out.push(path.join(root, p, t, a));
  return out;
};
/** Ask the stand-in which of the three asks it was given as the thread so far ("a=yes b=no c=no"). */
async function seenBy(d: Parameters<typeof post>[0], threadId: string, agentId: string, key: string): Promise<string> {
  return post(d, threadId, agentId, "histcheck", key);
}
const read = (dir: string, f: string): string | null => {
  const p = path.join(dir, f);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};

test("three turns write files; going back to the second puts the first turn's files back, the next turn does not read the later messages, and undoing brings it all back", { timeout: 120_000 }, async () => {
  const dir = seededDir();
  const d = await boot(dir, null, { engineCli: cli });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Writer");
    const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "rw-start" })).data
      .thread.threadId as string;
    await post(d, threadId, agentId, "writefile a.txt one", "rw-1");
    const r2 = await post(d, threadId, agentId, "writefile a.txt two", "rw-2a");
    void r2;
    await post(d, threadId, agentId, "writefile b.txt bee", "rw-2b");
    await post(d, threadId, agentId, "writefile c.txt see", "rw-3");
    const all = folders(dir);
    const work = all.find((f) => f.includes(`${path.sep}${threadId}${path.sep}`) && !f.endsWith("shared"));
    assert.ok(work, `no folder holds a.txt: ${JSON.stringify(all.map((f) => [f, fs.readdirSync(f)]))}; scratch ${fs.existsSync(path.join(dir, "scratch"))}`);
    assert.ok(work, "the agent has a work folder");
    assert.equal(read(work, "a.txt"), "two\n");
    // the points: one per turn, newest first
    let last = "";
    const listed = await waitFor(async () => {
      const r = (await call(d, "engine.rewind.points", { threadId })).data as {
        available: boolean;
        points: { pointId: string; after?: string; files: number }[];
      };
      last = JSON.stringify(r);
      return r.available && r.points.length >= 4 ? r : null;
    }, 20_000, () => last);
    const askedLines = listed.points.map((p) => p.after);
    assert.ok(askedLines.includes("writefile a.txt two"), JSON.stringify(askedLines));
    // go back to the start of the turn that said "writefile a.txt two": a.txt is "one" again, b.txt and c.txt are gone
    const target = listed.points.find((p) => p.after === "writefile a.txt two")!;
    const back = await call(d, "chat.rewind", { threadId, pointId: target.pointId, idempotencyKey: "rw-back" });
    assert.equal(back.status, 200, JSON.stringify(back.data));
    assert.equal(read(work, "a.txt"), "one\n");
    assert.equal(read(work, "b.txt"), null);
    assert.equal(read(work, "c.txt"), null);
    // the chat keeps every message and says what happened
    const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as { body: string }[];
    assert.ok(msgs.some((m) => m.body === "writefile c.txt see"), "the chat still shows the later messages");
    assert.ok(msgs.some((m) => /^Went back/.test(m.body)));
    // the agent's next turn does not read what came after the point: it is given the first ask, and not the later ones
    assert.equal(await seenBy(d, threadId, agentId, "rw-h1"), "a=yes b=no c=no");
    // undo: the point the rewind took first brings the files back and the messages are read again
    const undo = (
      (await call(d, "engine.rewind.points", { threadId })).data as { points: { pointId: string; undo?: boolean }[] }
    ).points.find((p) => p.undo === true);
    assert.ok(undo, "the undo point is offered");
    // the agent's own turn may have written nothing; files are as the rewind left them
    const back2 = await call(d, "chat.rewind", { threadId, pointId: undo!.pointId, idempotencyKey: "rw-undo" });
    assert.equal(back2.status, 200, JSON.stringify(back2.data));
    assert.equal(read(work, "a.txt"), "two\n");
    assert.equal(read(work, "b.txt"), "bee\n");
    assert.equal(read(work, "c.txt"), "see\n");
    assert.equal(await seenBy(d, threadId, agentId, "rw-h2"), "a=yes b=yes c=yes", "the messages are read again");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
