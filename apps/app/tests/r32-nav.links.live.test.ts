// @tsx
// Lane r32-nav, item 2 (desktop, 1440, dark). A file link in a chat message opens in a new tab on Cmd-click (Ctrl-click on Windows) and on a middle click, and beside the chat on a plain click, as the open rule says.
import test from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";
import type { Pg } from "./r32-nav-kit.test.ts";

const tabNames = (page: Pg): Promise<string[]> =>
  page.evaluate(() =>
    [...(document.querySelector('[data-testid="tab-strip"]')?.querySelectorAll('[role="tab"]') ?? [])].map(
      (e) => e.getAttribute("aria-label") ?? "",
    ),
  );

test("links: a file link in a chat opens as a tab on Cmd-click and on a middle click, beside the chat on a plain click", async (t) => {
  const k = await bootNav({ width: 1440, height: 900, scheme: "dark", tag: "links-dark-1440" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, api, say, shot } = k;
  try {
    const assistant = (await api("agents.list", {})).agents[0] as { agentId: string };
    const root = JSON.stringify(await api("files.tree", {})).match(/"(fld_[a-z0-9]+)"/)![1]!;
    const folder = (await api("files.folder.create", { parentId: root, name: "Contracts" })).folder.folderId as string;
    const one = JSON.stringify(
      await api("files.create", { folderId: folder, name: "Engagement letter.md", content: { text: "Dear client" } }),
    ).match(/"(fil_[a-z0-9]+)"/)![1]!;
    const two = JSON.stringify(
      await api("files.create", { folderId: folder, name: "Payment terms.md", content: { text: "Net 30" } }),
    ).match(/"(fil_[a-z0-9]+)"/)![1]!;
    const started = (await api("chat.start", { kind: "chat", agentIds: [assistant.agentId], first: "hello" })) as {
      thread: { threadId: string };
    };
    await api("chat.post", {
      threadId: started.thread.threadId,
      body: "See [[Engagement letter.md]] and [[Payment terms.md]] for the terms",
      blocks: [
        {
          type: "refs",
          v: 1,
          data: {
            refs: [
              { kind: "file", id: one, title: "Engagement letter.md" },
              { kind: "file", id: two, title: "Payment terms.md" },
            ],
          },
        },
      ],
    });
    await page
      .getByTestId("rail-chats")
      .or(page.getByTestId("rail-chats-selected"))
      .first()
      .evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(1500);
    await page
      .locator('[data-testid^="row-c:"]:not([data-testid$="-leading"]):not([data-testid$="-trailing"])')
      .first()
      .click();
    const link = (id: string) => page.locator(`[data-testid="link-${id}"]`).first();
    await link(one).waitFor({ timeout: 20_000 });
    await shot("chat-with-file-links");
    const chatTab = page.locator('[data-testid="tab-strip"] [role="tab"][aria-selected="true"]').first();
    const chatName = (await chatTab.getAttribute("aria-label")) ?? "";
    const n0 = (await tabNames(page)).length;
    await link(one).click({ modifiers: ["Control"] });
    await page.waitForTimeout(1500);
    let names = await tabNames(page);
    say(`Ctrl-click: tabs ${n0} -> ${names.length} (${names.join(" | ")})`);
    assert.equal(names.length, n0 + 1, "Ctrl-click on a file link opens a tab");
    await shot("file-link-ctrl-click");
    await page.locator(`[data-testid="tab-strip"] [role="tab"][aria-label="${chatName}"]`).first().click();
    await page.waitForTimeout(1200);
    await link(two).waitFor({ timeout: 20_000 });
    await link(two).click({ button: "middle" });
    await page.waitForTimeout(1500);
    names = await tabNames(page);
    say(`middle click: tabs -> ${names.length}`);
    assert.equal(names.length, n0 + 2, "a middle click on a file link opens a tab");
    await page.locator(`[data-testid="tab-strip"] [role="tab"][aria-label="${chatName}"]`).first().click();
    await page.waitForTimeout(1200);
    await link(one).waitFor({ timeout: 20_000 });
    await link(one).click();
    await page.waitForTimeout(1500);
    names = await tabNames(page);
    say(`plain click: tabs -> ${names.length}`);
    assert.equal(names.length, n0 + 2, "a plain click does not open a tab");
    assert.ok((await page.getByTestId("chats-thing-pane").count()) > 0, "a plain click opens the file beside the chat");
    await shot("file-link-plain-click");
  } finally {
    await k.close();
  }
});
