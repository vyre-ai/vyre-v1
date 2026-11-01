// The real app, rc.9 lane E: work an agent starts in a chat appears under its reply as cards. Same harness as the personal mail journeys (test/support/mail-browser.ts): Node 24, Chromium and the web
// export (VYRE_APP_DIST); with VYRE_REQUIRE_CHROME=1 (CI) it fails instead of skipping. Pictures of every step in light and dark, desktop and phone, in shots-evidence/work-cards-journey/.
//   An agent is asked to make a record: the reply carries a "Record created" card with the record's name, which opens the record. Then it is asked to run a Flow: the Run card says what the Run is doing
//   and reads Done when it ends.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";
import { standIn } from "./memory-live-kit.ts";

test("journey, work cards: the reply says what was made and the cards stay current", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "personal", engineOpenSession: standIn }, env);
  const dir = "shots-evidence/work-cards-journey";
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    const helper = await makeAgent(w.owner, "Worker", account);
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [helper] })).thread.threadId as string;
    const flow = (await w.owner.ok("automations.create", { name: "Lead sweep", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "t", key: "create_task", title: "Call the lead", input: { title: "Call the lead", assigned: { kind: "person", id: w.owner.id } } }] } })).automation.id as string;
    await w.owner.ok("automations.set_enabled", { automationId: flow, enabled: true });

    const me = await seat(s, w.owner, "Owner");
    await open(me, s, `/chat#subject=thread:${threadId}`);
    await me.page.getByTestId("shell").or(me.page.getByTestId("mobile-shell")).first().waitFor({ timeout: 30_000 });
    await shoot(me.page, dir, "empty-chat");

    // 1. a record
    await w.owner.ok("chat.post", { threadId, body: `TOOL records_create ${JSON.stringify({ type: "contact", fields: { name: "Dana Fox" }, idempotencyKey: "j-rec" })}`, mentions: [{ kind: "agent", id: helper }] });
    await until(async () => { await w.d.hooks?.pump?.(); return (await me.page.getByText(/Record created/).count()) > 0 ? true : null; }, "the Record created card", 40_000);
    assert.ok(await me.page.getByText("Dana Fox").first().isVisible(), "the card names the record");
    await shoot(me.page, dir, "record-card");

    // 2. a Run
    await w.owner.ok("chat.post", { threadId, body: `TOOL automations_run ${JSON.stringify({ automationId: flow, idempotencyKey: "j-run" })}`, mentions: [{ kind: "agent", id: helper }] });
    await until(async () => { await w.d.hooks?.pump?.(); return (await me.page.getByText(/Run started/).count()) > 0 ? true : null; }, "the Run started card", 40_000);
    await until(async () => { await w.d.hooks?.pump?.(); return (await me.page.getByText("Done", { exact: true }).count()) > 0 ? true : null; }, "the Run card reads Done", 40_000);
    await shoot(me.page, dir, "run-card-done");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
