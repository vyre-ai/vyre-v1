// The multi-agent round in the real app (chat gap G51, G56, G57): tag two agents, see the round row at once, then the round table card when both have answered, then "Let them discuss" and the thread.
// Pictures go to shots-evidence/chat-round, light and dark, desktop and phone. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { scriptedModel } from "./support/live.ts";
import { hash } from "./support/chat-flows.ts";

const OUT = "shots-evidence/chat-round";
let nova = "";
const model = scriptedModel(async function* (input: any) {
  const body = String(input.trigger?.body ?? "");
  const who = String(input.agent?.id ?? "");
  if (/Talk it over/.test(body)) {
    yield { type: "text", text: "Fair point. The disk is simpler to start with." };
    yield { type: "done", mentions: [{ kind: "agent", id: nova }] };
    return;
  }
  if (who === nova && /Fair point/.test(body)) {
    yield { type: "text", text: "Decided: the server disk for now, object storage later." };
    return;
  }
  yield { type: "text", text: who === nova ? "I would use the server disk. It is already paid for." : "Object storage. The files are large." };
  await new Promise((r) => setTimeout(r, 4000));
});

test("a message that tags two agents: the round row, the round table, and the discussion", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") {
    t.skip(env);
    return;
  }
  const s = await bootScreens({ kind: "team", engineOpenSession: model }, env);
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const dex = await makeAgent(w.owner, "Dex", account);
    nova = await makeAgent(w.owner, "Nova", account);
    const me = await seat(s, w.owner, "Owner");
    const started = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [dex, nova], idempotencyKey: "rw-start" })) as {
      thread: { threadId: string };
    };
    const threadId = started.thread.threadId;
    await w.owner.ok("threads.set_mode", { threadId, mode: "auto", idempotencyKey: "rw-auto" });
    await open(me, s, hash(threadId));
    const field = me.page.getByTestId("composer-field");
    await field.click();
    for (const [typed, pick] of [
      ["@Dex", "Dex"],
      ["@Nova", "Nova"],
    ] as const) {
      await field.pressSequentially(`${typed}`, { delay: 60 });
      await me.page.getByText(pick, { exact: true }).last().click({ timeout: 10_000 });
    }
    await field.pressSequentially(" which storage should uploads use?", { delay: 5 });
    await field.press("Enter");
    const row = me.page.locator('[data-testid^="round-"][role="list"]').first();
    await row.waitFor({ timeout: 10_000 });
    assert.equal(await me.page.locator('[data-testid^="round-"][data-testid*="-agt_"]').count(), 2, "both agents on the row");
    await shoot(me.page, OUT, "round-row", { restore: async () => open(me, s, hash(threadId)) });
    const card = me.page.locator('[data-testid^="round-table-"]').first();
    await card.waitFor({ timeout: 40_000 });
    await shoot(me.page, OUT, "round-table", { restore: async () => open(me, s, hash(threadId)) });
    // the card reads after what it sums up: under the last answer, below both
    const cardBox = await card.boundingBox();
    const lastAnswer = await me.page.getByText("It is already paid for", { exact: false }).first().boundingBox();
    assert.ok(cardBox && lastAnswer && cardBox.y > lastAnswer.y, "the card sits under the last answer");
    await me.page.locator('[data-testid$="-discuss"]').first().click();
    await me.page.getByText("are talking it over", { exact: false }).first().waitFor({ timeout: 20_000 });
    assert.equal(await me.page.locator('[data-testid^="round-table-"]').count(), 0, "the card folds once the talk starts");
    await until(
      async () => ((await me.page.getByText("Decided:", { exact: false }).count()) > 0 ? true : null),
      "the discussion ends on a Decided line",
      60_000,
    );
    await shoot(me.page, OUT, "discussion", { phone: false });
    assert.deepEqual(me.errors, [], "no page errors");
  } finally {
    await s.close();
  }
});
