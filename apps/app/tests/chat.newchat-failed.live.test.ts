// @tsx
// The first message of a new chat when the answer to chat.start is lost: failed with Retry, and one chat and one message after it (see chat.newchat-kit.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { walk, sendNew } from "./chat.newchat-kit.test.ts";

test("new chat first message, the answer to chat.start is lost: it shows as failed with Retry, and Retry makes one chat with one message", async (t) => {
  if (!process.env["VYRE_APP_DIST"]) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  await walk("failed", 0, 0, async ({ page, web, relay, api, v }) => {
    await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
    const text = `Draft the hiring note for the Oslo office ${Math.random().toString(36).slice(2, 8)}`;
    // the server gets the first try and makes the chat, then the answer is lost on the way back: the person has to be able to try again without a twin
    relay.failChatStart.drop = 1;
    await sendNew(page, v, text, "Drafted.", {});
    await page.getByTestId("landing-failed").waitFor({ timeout: 10_000 });
    assert.ok(await page.getByTestId("landing-retry").isVisible(), "the failed message has a Retry");
    assert.ok((await page.getByTestId("landing-pending").textContent())!.includes(text), "his words are still on screen");
    await page.getByTestId("landing-retry").click();
    await page.getByText("Drafted.", { exact: true }).waitFor({ timeout: 30_000 });
    const list = (await api("threads.list", { kind: ["chat"], limit: 50 })).threads as { threadId: string; title?: string }[];
    const mine = list.filter((x) => (x.title ?? "").startsWith("Draft the hiring note"));
    assert.equal(mine.length, 1, "one chat, not two");
    const msgs = (await api("chat.messages.list", { threadId: mine[0]!.threadId, limit: 50 })).messages as { body?: string; text?: string }[];
    assert.equal(msgs.filter((m) => (m.body ?? m.text ?? "") === text).length, 1, "his message is in the chat once");
    assert.equal(relay.starts, 2, "chat.start went twice (the try and the retry)");
  });
});
