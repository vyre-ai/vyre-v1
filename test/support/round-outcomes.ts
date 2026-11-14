// The kit for the two walks of how a discussion ends (chat gap G57): the model stand-in that makes each ending, and one function that runs chats to the endings it is given in a real browser, shooting each
// into shots-evidence/chat-round. Two walk files use it so that every ending is shot at phone width too inside a walk's 120 s cap.
import assert from "node:assert/strict";
import { connectClaude, makeAgent, unlockVault, until } from "./mail-world.ts";
import { bootScreens, browserOrSkip, open, seat } from "./mail-browser.ts";
import { shoot } from "./chat-shots.ts";
import { scriptedModel } from "./live.ts";
import { hash } from "./chat-flows.ts";

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

export type Ending = "decided" | "stalled" | "cap";
const WORDS: Record<Ending, RegExp> = {
  decided: /Agents decided: the server disk/,
  stalled: /They did not settle it/,
  cap: /They used their 4 turns without settling it\. Ask again to go on\./,
};

/** Run one chat to each ending, in a real browser, and shoot the line in both skins at desktop and phone width. A second client on the same chat, never reloaded, must see the line change (secondClient). */
export async function runEndings(
  t: { skip(why?: string): void },
  endings: readonly Ending[],
  o: { secondClient: boolean },
): Promise<void> {
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
    const other = o.secondClient ? await seat(s, w.owner, "Owner") : null; // a second client on the same chat, never reloaded
    for (const m of endings) {
      const words = WORDS[m];
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
      if (other) await open(other, s, hash(threadId));
      if (other) await other.page.locator('[data-testid$="-discuss"]').first().waitFor({ timeout: 40_000 });
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
      if (other)
        await until(
          async () => ((await other!.page.getByText(words).count()) > 0 ? true : null),
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
      await shoot(me.page, OUT, `outcome-${m}`, { restore: async () => open(me, s, hash(threadId)) });
    }
    assert.deepEqual([...me.errors, ...(other?.errors ?? [])], [], "no page errors");
  } finally {
    await s.close();
  }
}
