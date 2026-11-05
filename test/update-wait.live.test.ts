// The app update waits for a reply that is running (apps/desktop/src-tauri/src/updater.rs, the Updating screen), end to end on a booted daemon: the shell asks GET /local/daemon/busy and hears
// the chat the reply is in, by its title; "Stop and update now", and the end of the wait, are POST /local/daemon/stop-turns, which ends the reply cleanly (the turn is cancelled, the chat says it
// was stopped, nothing more is written) and leaves nothing running. Nothing inside the daemon is faked; the model vendor is a stand-in that holds the turn.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";

type Busy = { turns: number; sources: Array<{ name: string; turns: number }>; chats: Array<{ id: string; title: string }> };

test("a reply is running: the daemon names its chat, stop-turns ends it cleanly, and nothing is left running", async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => { release = r; });
  const model = scriptedModel(async function* () { yield { type: "text", text: "this reply was never allowed to finish" }; }, { gate: () => held });
  const d = await boot(seededDir(), model);
  const admin = { authorization: `Bearer ${d.token}` };
  const busy = async (): Promise<Busy> => ((await (await fetch(`${d.url}/local/daemon/busy`, { headers: admin })).json()) as { data: Busy }).data;
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Intake");
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "uw-start" });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const threadId = started.data.thread.threadId as string;
    const title = ((await call(d, "threads.get", { threadId })).data.thread as { title?: string }).title ?? "";
    const posted = await call(d, "chat.post", { threadId, body: "book the consult", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "uw-post" });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));

    // the shell's question: one reply runs here, and it is in this chat
    const running = await waitFor(async () => { const b = await busy(); return b.turns > 0 ? b : null; });
    assert.equal(running.turns, 1);
    assert.deepEqual(running.chats, [{ id: threadId, title: title || "a chat" }], "the chat is named by its title");

    // "Stop and update now": the reply ends cleanly and nothing runs after it
    const stop = await fetch(`${d.url}/local/daemon/stop-turns`, { method: "POST", headers: admin });
    assert.equal(stop.status, 200);
    const after = await waitFor(async () => { const b = await busy(); return b.turns === 0 ? b : null; });
    assert.deepEqual(after.chats, [], "no chat is waited for any more");
    const turns = (await call(d, "engine.turns.list", { threadId })).data.turns as Array<{ state?: string; status?: string }>;
    assert.ok(turns.length > 0 && turns.every((t) => /cancel|stop/i.test(String(t.state ?? t.status))), `the turn was ended, not left running: ${JSON.stringify(turns)}`);
    await d.hooks?.pump?.();
    const said = ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }>).filter((m) => m.author?.kind === "agent").map((m) => m.body ?? "");
    assert.ok(!said.some((b) => b.includes("never allowed to finish")), "the held reply wrote nothing after it was stopped");
    const blocks = ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ blocks?: Array<{ type: string; data?: { text?: string } }> }>).flatMap((m) => m.blocks ?? []);
    assert.equal(blocks.filter((b) => b.type === "turn_status" && /Stopped for an update/.test(String(b.data?.text))).length, 1, "the chat says, once and quietly, why the reply stopped");

    // after the update the line carries Continue: pressing it runs that turn again on the same message, and this time it finishes
    const note = ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ blocks?: Array<{ type: string; data?: { state?: string; turnId?: string } }> }>).flatMap((m) => m.blocks ?? []).find((b) => b.type === "turn_status" && b.data?.state === "stopped_for_update");
    assert.ok(note?.data?.turnId, "the line names the turn that was stopped, so Continue can run it");
    const messagesBefore = ((await call(d, "chat.messages.list", { threadId })).data.messages as unknown[]).filter((m) => (m as { author?: { kind?: string } }).author?.kind === "person").length;
    release();
    const retried = await call(d, "engine.turn.retry", { turnId: note!.data!.turnId });
    assert.equal(retried.status, 200, JSON.stringify(retried.data));
    const reply = await waitFor(async () => {
      await d.hooks?.pump?.();
      const m = ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }>).find((x) => x.author?.kind === "agent" && (x.body ?? "").includes("never allowed to finish"));
      return m ?? null;
    });
    assert.ok(reply, "Continue ran the turn again and the reply arrived");
    const people = ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string } }>).filter((m) => m.author?.kind === "person").length;
    assert.equal(people, messagesBefore, "the message was not posted again");

    // the route is the admin token's alone, and a second press has nothing to end
    assert.equal((await fetch(`${d.url}/local/daemon/stop-turns`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${d.url}/local/daemon/stop-turns`, { method: "POST", headers: admin })).status, 200);
    assert.equal((await busy()).turns, 0);
  } finally { release(); await d.stop(); }
});
