// A routine on a broken sign-in, on a booted daemon: three runs in a row fail for one reason, the routine pauses itself and says why once in its chat and on its row; a sign-in saved to the Vault puts it back, and
// the turn the missing sign-in parked runs once. Nothing is faked but the model vendor, a scripted session that answers only when the person has signed in.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, connect, hostLog, makeAgent, ok, scriptedModel, seededDir, startChat, stop, waitFor } from "./support/eco-live.ts";

test("a routine whose runs fail three times pauses itself with the reason; signing in puts it back and the parked turn runs once", { timeout: 180_000 }, async () => {
  let signedIn = false;
  let attempts = 0;
  const model = scriptedModel(async function* () {
    attempts++;
    if (!signedIn) { yield { type: "error", code: "engine.signin_missing", message: "That account's Vault item has no credentials field. Sign in to it again. [account Claude_Code]" }; return; }
    yield { type: "text", text: "Hi." };
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Assistant");
    const chat = await startChat(d, agent, "pause");
    await ok(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "pause-mode" });
    const chan = (await ok(d, "channels.create", { name: "hi", visibility: "invite", agentIds: [agent], idempotencyKey: "pause-chan" })).channel as { channelId: string; mainThreadId: string };
    const saved = (await ok(d, "agents.routine.save", { agentId: agent, title: "Hi every minute", cron: "* * * * *", prompt: "Say hi.", channelId: chan.channelId, idempotencyKey: "pause-rtn" })).routine as { routineId: string };
    const list = async (): Promise<{ enabled: boolean; pausedReason?: string; lastRun?: { runId: string; status: string } }> => ((await ok(d, "agents.routines.list", { agentId: agent })).routines as Array<{ routineId: string; enabled: boolean; pausedReason?: string; lastRun?: { runId: string; status: string } }>).find((r) => r.routineId === saved.routineId)!;
    // each run ends failed: the first on the model's own error, the next two folded into the turn that error parked (they do not reach the model again)
    let lastRunId = ""; let seen = "";
    for (let i = 1; i <= 3; i++) {
      const run = (await ok(d, "agents.routine.run_now", { agentId: agent, routineId: saved.routineId, idempotencyKey: `pause-run-${i}` })).runId as string;
      lastRunId = run;
      await waitFor(async () => { await d.hooks?.pump?.(); const r = await list(); seen = `${i} ${run} ${JSON.stringify(r)}`; return r.lastRun?.runId === run && r.lastRun.status === "failed" ? true : null; }, 30_000, () => `${seen} ${hostLog(d)}`);
    }
    assert.ok(lastRunId);
    assert.equal(attempts, 1, "the parked turn kept the next two from reaching the model");
    await waitFor(async () => { await d.hooks?.pump?.(); const r = await list(); return r.enabled ? null : r; }, 60_000, () => `${JSON.stringify(list())} ${hostLog(d)}`);
    const row = await list();
    assert.match(String(row.pausedReason), /^Paused after 3 failed runs: .*Sign in to it again/);
    const lines = ((await ok(d, "chat.messages.list", { threadId: chan.mainThreadId })).messages as Array<{ body: string }>).filter((m) => /^Paused "Hi every minute" after 3 failed runs/.test(m.body));
    assert.equal(lines.length, 1, "said once in its chat");
    const before = attempts;
    // the account reads "Sign in again" in Settings (the failed turn marked it), and the person signs in again: the account's own item gets a new sign-in
    const accounts = async (): Promise<Array<{ state?: string; status?: string; handle?: string }>> => ((await ok(d, "providers.list", {})).providers as Array<{ state?: string; status?: string; handle?: string }>);
    assert.ok((await accounts()).some((p) => p.state === "needs_sign_in"), "the account says Sign in again");
    signedIn = true;
    const item = ((await ok(d, "vault.items.list", {})).items as Array<{ id: string; name: string }>).find((i) => i.name === "Olivia_Claude")!;
    await ok(d, "vault.item.update", { itemId: item.id, fieldsSet: [{ key: "setup_token", value: "fresh", secret: true }], idempotencyKey: "pause-resign" });
    assert.ok(!(await accounts()).some((p) => p.state === "needs_sign_in"), "signing in put the account back");
    await waitFor(async () => { await d.hooks?.pump?.(); return (await list()).enabled ? true : null; }, 30_000, () => hostLog(d));
    assert.equal((await list()).pausedReason, undefined, "the pause reason is gone");
    // the turn the missing sign-in parked runs once, and answers in the chat
    await waitFor(async () => { await d.hooks?.pump?.(); return attempts > before ? true : null; }, 30_000, () => hostLog(d));
    await waitFor(async () => { await d.hooks?.pump?.(); const m = ((await ok(d, "chat.messages.list", { threadId: chan.mainThreadId })).messages as Array<{ body: string }>).filter((x) => x.body === "Hi."); return m.length === 1 ? true : null; }, 30_000, () => hostLog(d));
    assert.equal(attempts, before + 1, "one run answers the waiting turn");
  } finally { await stop(d); }
});
