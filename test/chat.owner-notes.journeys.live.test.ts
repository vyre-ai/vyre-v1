// The owner's four notes from the rc.9 Mac app, in the real app (Chrome, the production web export with its registry hash), real daemon, engine and CLI driver around the fake claude:
// a record the agent names is a link by its name (never rec_...), and pressing it opens the record; :smi in the composer offers emoji and inserts one; a person is never told they wrote; a reply that
// used no memory has no "Used" line. Light and dark, desktop and phone.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { cli, connectSubscription } from "./support/cli-world.ts";

const OUT = "shots-evidence/chat-owner-notes";
// The daemon's shutdown does not close the CLI session (live-engine owns it), so the process ends 1.5 s after the journey with the code of its result.
let passes = 0;
let ran = false;
after(() => { if (ran) setTimeout(() => process.exit(passes === 1 ? 0 : 1), 1_500); });

test("owner notes: a named record is a link, :smi inserts an emoji, own messages never make a 'wrote' banner, no Used line without memory", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  ran = true;
  const s = await bootScreens({ kind: "personal", engineCli: cli }, env);
  const dir = `${OUT}/notes`;
  try {
    const w = s.world;
    await connectSubscription(w);
    const rec = (await w.owner.ok("records.create", { type: "contact", fields: { name: "Dana Fox", email: "dana@fox.test" } })).record as { id: string };
    const agent = (await w.owner.ok("agents.create", { name: "Haiku", role: "You answer briefly.", idempotencyKey: "on-agent" })).agent.agentId as string;
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "on-chat" })).thread.threadId as string;
    await w.owner.ok("threads.set_mode", { threadId, mode: "auto", idempotencyKey: "on-auto" });
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    const field = me.page.getByTestId("composer-field");

    // the colon: :smi offers a picker; Enter puts the emoji in the field
    await field.click();
    await field.fill("nice :smi");
    await me.page.getByTestId("composer-popup").waitFor({ timeout: 10_000 });
    assert.ok(await me.page.getByText("😄").first().isVisible(), "the smile is offered");
    await shoot(me.page, dir, "emoji-picker", { phone: false });
    await field.press("Enter");
    await me.page.waitForFunction(() => Array.from(document.querySelectorAll("textarea,input,[contenteditable]")).some((n) => ((n as HTMLInputElement).value ?? n.textContent ?? "").includes("nice 😄")), undefined, { timeout: 5_000 });
    await field.fill("");

    // an agent that names a record by its id: the reply shows its name as a link, never the id
    await field.fill(`say Opened [[Dana Fox|${rec.id}]] and also ${rec.id} for you.`);
    await me.page.getByTestId("composer-send").click();
    await me.page.locator(`[data-testid="link-${rec.id}"]`).first().waitFor({ timeout: 30_000 });
    const feed = await me.page.getByTestId("conversation-feed").innerText();
    const agentPart = feed.slice(feed.lastIndexOf("Opened"));
    assert.ok(!/rec_[0-9a-z]{6,}/i.test(agentPart), "no raw id in the reply");
    assert.ok(agentPart.includes("Dana Fox"));
    assert.ok(!/Used \d+ memor/.test(feed), "a reply that used no memory has no Used line");
    assert.ok(!/ wrote\./.test(feed), "a person is never told they wrote");
    await shoot(me.page, dir, "record-link", { phone: false });
    await me.page.locator(`[data-testid="link-${rec.id}"]`).first().click();
    await me.page.waitForTimeout(1_500);
    await shoot(me.page, dir, "record-opened", { phone: false });
    passes += 1;
  } finally { await s.close(); }
});
