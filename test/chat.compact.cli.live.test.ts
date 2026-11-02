// Compact with what to keep (lane l-sessions), on the real engine, the real CLI driver and the real sandbox around a CLI process (the fake claude of host/tests/fixtures/fake-cli-driver, which
// compacts the way Claude Code does and keeps its sessions as files in its home). The Compact button's capability: Claude Code compacts its own session with the words, the chat shows one line with
// the context it left, the meter shows the same, and "Keep this every time" goes into the work folder's compact instructions. When the CLI no longer has the session, Vyre compacts from the chat's
// summary instead, says so in the line, and the next turn starts a new engine session whose prompt carries the summary with the words to keep.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, call, connect, hostLog, makeAgent, post, seededDir } from "./support/live.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };

const under = (root: string, ...parts: string[]): string[] => {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).map((p) => path.join(root, p, ...parts)).filter((p) => fs.existsSync(p));
};

test("Compact keeps what the person names: Claude Code compacts itself and the line and the meter show what it left; a gone session is compacted by Vyre with the words in its summary", { timeout: 90_000 }, async () => {
  const dir = seededDir();
  const d = await boot(dir, null, { engineCli: cli });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Keeper");
    const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "cmp-start" })).data.thread.threadId as string;
    // the person picks the model in the panel: its window is what the line and the meter count against
    const picked = await call(d, "engine.set_model", { threadId, agentId, model: "sonnet", provider: "anthropic", idempotencyKey: "cmp-model" });
    assert.equal(picked.status, 200, JSON.stringify(picked.data));
    const first = await post(d, threadId, agentId, "resumecheck", "cmp-1");
    const sid = /^resumed=none session=(fake-\d+-[a-z0-9]+)$/.exec(first)?.[1];
    assert.ok(sid, first);

    // what the composer sends for Compact with "Keep this every time" ticked
    const out = await call(d, "engine.compact", { threadId, agentId, keep: "the lease dates", always: true, idempotencyKey: "cmp-c1" });
    assert.equal(out.status, 200, `${JSON.stringify(out.data)} ${hostLog(d)}`);
    assert.equal(out.data.line, "Compacted. Kept: the lease dates. Context now about 3k of 200k tokens.");
    assert.deepEqual([out.data.engine, out.data.how, out.data.fellBack, out.data.keepEvery], ["claude_code", "engine", false, "the lease dates"]);
    assert.deepEqual(out.data.context, { used: 2_500, window: 200_000 });
    const file = under(path.join(dir, "scratch"), "home", ".fake-claude", "sessions", sid)[0];
    assert.ok(file, "the session the chat holds");
    assert.match(fs.readFileSync(file, "utf8"), /^resumecheck\n\/compact the lease dates\n$/, "the engine's own compact went to the chat's session with the words to keep");
    const guide = under(path.join(dir, "work"), threadId, "CLAUDE.md")[0];
    assert.ok(guide);
    assert.match(fs.readFileSync(guide, "utf8"), /# Compact instructions\n\nWhen this conversation is compacted or summarised, keep this, as the person asked: the lease dates\n$/, "the engine's own automatic compaction keeps them too");

    await d.hooks?.pump?.();
    const lines = async (): Promise<string[]> => {
      const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ blocks?: Array<{ type: string; data?: { state?: string; text?: string } }> }>;
      return msgs.flatMap((m) => (m.blocks ?? []).filter((b) => b.type === "turn_status" && b.data?.state === "note").map((b) => b.data?.text ?? ""));
    };
    assert.deepEqual(await lines(), [out.data.line], "one calm line in the chat");
    const usage = await call(d, "engine.usage.get", { threadId, agentId });
    assert.equal(usage.status, 200, JSON.stringify(usage.data));
    assert.deepEqual(usage.data.context, { used: 2_500, window: 200_000 }, "the meter shows what the compaction left");
    assert.equal(usage.data.keepEvery, "the lease dates", "the panel opens with the standing words");

    // the CLI loses the session: Vyre compacts from the chat's summary, keeping the standing words and the new ones
    fs.rmSync(file);
    const again = await call(d, "engine.compact", { threadId, agentId, keep: "the deposit", idempotencyKey: "cmp-c2" });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.deepEqual([again.data.how, again.data.fellBack], ["vyre", true]);
    assert.match(again.data.line, /^Compacted\. Kept: the deposit; the lease dates\. Context now about \d+k of 200k tokens\. Claude Code no longer had this chat's session, so Vyre compacted it from the chat's summary\.$/);
    assert.deepEqual((await lines()).length, 2);

    // the next turn starts a new engine session from that summary, and the summary carries the words to keep
    const echoed = await post(d, threadId, agentId, "rawecho", "cmp-2");
    assert.match(echoed, /This chat was compacted \(this stands for everything before the messages below/);
    assert.match(echoed, /Keep this, as the person asked: the deposit; the lease dates/);
    assert.match(echoed, /The latest messages before the compaction:\n[^\n]*resumecheck/, "what was said before the compaction is in the summary");
    assert.doesNotMatch(echoed, /Earlier in this thread:[\s\S]*resumecheck/, "and not sent again word for word");
    const after = await post(d, threadId, agentId, "resumecheck", "cmp-3");
    assert.match(after, /^resumed=none session=fake-\d+-[a-z0-9]+$/, "a new engine session, not the one before the compaction");
    assert.notEqual(after, `resumed=none session=${sid}`);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
