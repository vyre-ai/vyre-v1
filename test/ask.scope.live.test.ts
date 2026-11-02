// Ask on a booted daemon: one thread per person, agent and object from every door, and the screen goes with each message, never remembered.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";

test("two doors find one Ask, and each message carries the screen it was sent from", async () => {
  const dir = seededDir();
  const screens: string[] = [];
  const d = await boot(dir, scriptedModel(async function* (input: any) {   // eslint-disable-line @typescript-eslint/no-explicit-any
    screens.push(String((input.context?.sections ?? []).find((s: { id: string }) => s.id === "screen")?.text ?? ""));
    yield { type: "text", text: "Done." };
  }));
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Asker");
    const open = (k: string) => call(d, "chat.start", { kind: "ask", agentIds: [agentId], scopeType: "file", scopeId: `fil_${k}`, idempotencyKey: `as-open-${k}` });
    assert.equal((await open("a")).status, 200);
    const one = (await call(d, "chat.start", { kind: "ask", agentIds: [agentId], scopeType: "file", scopeId: "fil_a", idempotencyKey: "as-second-door" })).data.thread.threadId;
    assert.equal(one, (await open("a")).data.thread.threadId, "two doors, one conversation");

    // the screen is the one sent with this message
    await call(d, "chat.post", { threadId: one, body: "where am I", screen: { place: "files", open: [{ type: "file", id: "fil_a", title: "First page" }] }, idempotencyKey: "as-1" });
    await waitFor(async () => { await d.hooks?.pump?.(); return screens.length >= 1 ? true : null; });
    assert.match(screens[0]!, /fil_a|First page/);
    await call(d, "chat.post", { threadId: one, body: "and now", idempotencyKey: "as-2" });
    await waitFor(async () => { await d.hooks?.pump?.(); return screens.length >= 2 ? true : null; });
    assert.doesNotMatch(screens[1]!, /First page/, "a message sent with no screen remembers none");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
