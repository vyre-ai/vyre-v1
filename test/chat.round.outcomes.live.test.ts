// How a discussion ends, in the real app (chat gap G57): the "talking it over" line becomes the decision, says they did not settle it, or says the four turns ran out. One chat for each, shot light and
// dark, desktop and phone, into shots-evidence/chat-round. Needs Node 24, a Chromium and VYRE_APP_DIST; without them it skips and says why.
import test from "node:test";
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { scriptedModel } from "./support/live.ts";
import { hash } from "./support/chat-flows.ts";

const OUT = "shots-evidence/chat-round";
let dex = "";
let nova = "";
let mode: "decided" | "stalled" | "cap" = "decided";
const model = scriptedModel(async function* (input: any) {
  const body = String(input.trigger?.body ?? "");
  const who = String(input.agent?.id ?? "");
  const other = who === dex ? nova : dex;
  if (/Talk it over/.test(body) || /Fair point|Still thinking/.test(body)) {
    if (mode === "cap") {
      yield { type: "text", text: "Still thinking." };
      yield { type: "done", mentions: [{ kind: "agent", id: other }] };
    } else if (mode === "stalled") {
      yield { type: "text", text: "I do not know." };
    } else if (who === dex) {
      yield { type: "text", text: "Fair point. The disk is simpler to start with." };
      yield { type: "done", mentions: [{ kind: "agent", id: nova }] };
    } else {
      yield { type: "text", text: "Decided: the server disk for now, object storage later." };
    }
    return;
  }
  yield {
    type: "text",
    text:
      who === nova
        ? "Answer: The server disk\nIt is already paid for."
        : "Answer: Object storage\nThe files are large.",
  };
});

test("a discussion ends three ways, and the line in the chat says which", { timeout: 115_000 }, async (t) => {
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
    dex = await makeAgent(w.owner, "Dex", account);
    nova = await makeAgent(w.owner, "Nova", account);
    const me = await seat(s, w.owner, "Owner");
    const other = await seat(s, w.owner, "Owner"); // a second client on the same chat, never reloaded
    const outcomes: Array<["decided" | "stalled" | "cap", RegExp]> = [
      ["decided", /Agents decided: the server disk/],
      ["stalled", /They did not settle it/],
      ["cap", /They used their 4 turns without settling it\. Ask again to go on\./],
    ];
    for (const [m, words] of outcomes) {
      mode = m;
      const threadId = (
        (await w.owner.ok("chat.start", { kind: "chat", agentIds: [dex, nova], idempotencyKey: `oc-${m}` })) as {
          thread: { threadId: string };
        }
      ).thread.threadId;
      await w.owner.ok("threads.set_mode", { threadId, mode: "auto", idempotencyKey: `oc-auto-${m}` });
      await w.owner.ok("chat.post", {
        threadId,
        body: "@Dex @Nova which storage should uploads use?",
        mentions: [
          { kind: "agent", id: dex },
          { kind: "agent", id: nova },
        ],
        idempotencyKey: `oc-ask-${m}`,
      });
      await open(me, s, hash(threadId));
      if (m === "decided") await open(other, s, hash(threadId));
      if (m === "decided") await other.page.locator('[data-testid$="-discuss"]').first().waitFor({ timeout: 40_000 });
      await me.page.locator('[data-testid$="-discuss"]').first().click({ timeout: 40_000 });
      await until(
        async () =>
          (await me.page.getByText(words).count()) > 0 &&
          (await me.page.getByText("are talking it over", { exact: false }).count()) <= 1
            ? true
            : null,
        `the line says how the discussion ended (${m})`,
        45_000,
      );
      // the second client saw the line change without reloading
      if (m === "decided")
        await until(
          async () => ((await other.page.getByText(words).count()) > 0 ? true : null),
          `the second client sees how the discussion ended (${m}) without a reload`,
          20_000,
        );
      // the chat's line is the outcome now; the thread beside it opens on the quiet "talking it over" line, and the agents' instruction is never drawn
      assert.equal(
        await me.page.getByText("are talking it over", { exact: false }).count(),
        1,
        "only the thread's own first line says it",
      );
      assert.equal(
        await me.page.getByText("Talk it over", { exact: false }).count(),
        0,
        "the instruction is not drawn under anyone's name",
      );
      assert.ok((await me.page.locator('[data-testid="catch-up"]').count()) <= 1, "the same catch-up words show once");
      await shoot(me.page, OUT, `outcome-${m}`, {
        // the phone width is shot for the decision; the other two are shot at desktop width in both skins (a 120 s file cap)
        ...(m === "decided" ? {} : { only: "desktop" as const }),
        restore: async () => open(me, s, hash(threadId)),
      });
    }
    assert.deepEqual([...me.errors, ...other.errors], [], "no page errors");
  } finally {
    await s.close();
  }
});
