// rc.9 chat flows in the real app, journey 6: a tablet (a finger for a pointer, 1024 px wide) has no hover bar; a long press on an answer opens the sheet with Make a Task and Remember This. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. One journey per file so each stays inside the 120 s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shootHere } from "./support/chat-shots.ts";
import { OUT, askers, model, hash } from "./support/chat-flows.ts";

test("journey 6, Team on a tablet: a long press on an agent's answer opens the sheet with Make a Task and Remember This, and both work", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  askers.length = 0;
  const s = await bootScreens({ kind: "team", engineOpenSession: model }, env);
  const dir = `${OUT}/6-tablet`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    await makeAgent(w.owner, "Billing", account);
    const maya = await w.join("maya");
    const dm = (await maya.ok("chat.start", { kind: "chat", agentIds: [], personId: w.owner.id, idempotencyKey: "j6-dm" })).thread.threadId as string;
    await maya.ok("chat.post", { threadId: dm, body: "Olivia, how are the invoices?", idempotencyKey: "j6-hi" });
    const me = await seat(s, w.owner, "Owner", { touch: { width: 1024, height: 768 } });
    await open(me, s, hash(dm));
    assert.deepEqual(await me.page.evaluate(() => [matchMedia("(pointer: coarse)").matches, matchMedia("(hover: none)").matches]), [true, true], "this seat's pointer is a finger and it cannot hover");
    await me.page.getByTestId("composer-field").click();
    await me.page.getByTestId("composer-field").fill("@Billing sum this up for us");
    await me.page.getByTestId("composer-send").click();
    await me.page.getByText(/Three invoices are paid, two are open\./).first().waitFor({ timeout: 40_000 });
    const reply = await until(async () => { const r = await w.owner.ok("chat.messages.list", { threadId: dm }); return (r.messages as Array<{ messageId: string; author?: { kind?: string }; body?: string }>).find((x) => x.author?.kind === "agent" && /Three invoices are paid, two are open\./.test(x.body ?? ""))?.messageId ?? null; }, "the answer is on the server");
    // a long press (touchstart, held past 450 ms, touchend) on the answer
    const longPress = async (): Promise<void> => { const row = me.page.getByTestId(`msg-${reply}`); await row.dispatchEvent("touchstart"); await me.page.waitForTimeout(650); await row.dispatchEvent("touchend"); };
    await longPress();
    await me.page.getByText("Make a Task", { exact: true }).waitFor({ timeout: 10_000 });
    await me.page.getByText("Remember This", { exact: true }).waitFor({ timeout: 10_000 });
    await shootHere(me.page, dir, "tablet-sheet");
    await me.page.getByText("Make a Task", { exact: true }).click();
    await me.page.getByText(/Task created/).first().waitFor({ timeout: 20_000 });
    await longPress();
    await me.page.getByText("Remember This", { exact: true }).click();
    await me.page.getByText(/Remembered/).first().waitFor({ timeout: 20_000 });
    const tasks = (await w.owner.ok("tasks.list", { scope: "all" })).tasks as Array<{ title: string; source?: { id?: string } }>;
    assert.ok(tasks.some((x) => /Three invoices are paid/.test(JSON.stringify(x)) && x.source?.id === dm), "the task exists, with the answer's words, pointing back at the chat");
    const facts = (await w.owner.ok("memory.facts.list", {})).facts as Array<{ text: string }>;
    assert.ok(facts.some((f) => /Three invoices are paid/.test(f.text)), "the fact is in memory");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
