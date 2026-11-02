// A CLI engine's own session survives a daemon restart (lane l-sessions), on the real engine, the real CLI driver and the real sandbox around a CLI process: the fake claude of
// host/tests/fixtures/fake-cli-driver, which keeps its sessions as files in its home the way Claude Code does. A turn, a restart, and the next turn resumes the engine session the first one left;
// a session whose files are gone starts a new one from the chat's summary and recent messages and says so in one line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, call, connect, hostLog, makeAgent, post, seededDir } from "./support/live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };

/** The session files the fake CLI left in the people's engine homes (<data>/scratch/<person>/home). */
const sessionFiles = (dir: string): string[] => {
  const scratch = path.join(dir, "scratch");
  if (!fs.existsSync(scratch)) return [];
  return fs.readdirSync(scratch).flatMap((p) => {
    const d = path.join(scratch, p, "home", ".fake-claude", "sessions");
    return fs.existsSync(d) ? fs.readdirSync(d).map((f) => path.join(d, f)) : [];
  });
};

async function unlock(d: Daemon): Promise<void> {
  const r = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(r.status, 204, `unlock: ${r.status}`);
}

test("after a daemon restart the chat's next turn resumes the engine's own session; a session whose files are gone starts a new one and says so", { timeout: 120_000 }, async () => {
  const dir = seededDir();
  let d = await boot(dir, null, { engineCli: cli });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Keeper");
    const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "ses-start" })).data.thread.threadId as string;

    const first = await post(d, threadId, agentId, "resumecheck", "ses-1");
    const m1 = /^resumed=none session=(fake-\d+-[a-z0-9]+)$/.exec(first);
    assert.ok(m1, `a new chat starts a new engine session: ${first}`);
    const sid = m1[1]!;
    const files = sessionFiles(dir);
    assert.deepEqual(files.map((f) => path.basename(f)), [sid], "the engine kept its session in the person's engine home");

    await d.stop();
    d = await boot(dir, null, { engineCli: cli });
    await unlock(d);
    const second = await post(d, threadId, agentId, "resumecheck", "ses-2");
    assert.equal(second, `resumed=${sid} session=${sid}`, `the turn after the restart resumes the id the first one left; ${hostLog(d)}`);
    assert.match(fs.readFileSync(files[0]!, "utf8"), /^resumecheck\nresumecheck\n$/, "the same session file, still there after the restart, holds both turns");

    // the CLI loses the session (its files went): the next turn starts a new one and says so, once
    await d.stop();
    fs.rmSync(files[0]!);
    d = await boot(dir, null, { engineCli: cli });
    await unlock(d);
    const third = await post(d, threadId, agentId, "resumecheck", "ses-3");
    const m3 = /^resumed=none session=(fake-\d+-[a-z0-9]+)$/.exec(third);
    assert.ok(m3, `a gone session is not resumed: ${third}; ${hostLog(d)}`);
    assert.notEqual(m3[1], sid);
    await d.hooks?.pump?.();
    const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string; blocks?: Array<{ type: string; data?: { state?: string; text?: string } }> }>;
    const said = msgs.flatMap((m) => (m.blocks ?? []).filter((b) => b.type === "turn_status" && b.data?.state === "note").map((b) => b.data?.text ?? ""));
    assert.deepEqual(said, ["Claude Code no longer had this chat's session, so it started a new one from the chat's summary and recent messages."]);
    const reply = msgs.filter((m) => m.author?.kind === "agent").at(-1);
    assert.equal(reply?.body, third, "the line sits with the answer it belongs to");

    const fourth = await post(d, threadId, agentId, "resumecheck", "ses-4");
    assert.equal(fourth, `resumed=none session=${m3[1]}`, "the warm process goes on in the new session, and nothing more is said");
    const later = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ blocks?: Array<{ type: string; data?: { state?: string } }> }>;
    assert.equal(later.flatMap((m) => (m.blocks ?? []).filter((b) => b.type === "turn_status" && b.data?.state === "note")).length, 1);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
