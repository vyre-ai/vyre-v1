// The owner walk's fixes, proven in the real app (lane f-ownerwalk, 12 Nov 2026): each step is something the owner met on his walk and winced at. Real daemon, production export, Chromium.
//   1 Your Profile (the avatar) opens in the Settings tab already open, not a second Settings tab.
//   2 Add a Space opens Add a Space only, never the Add a server dialog behind it.
//   3 A chat whose reply has finished says "Message Assistant…" in its empty composer, not "Steer Assistant…".
//   4 Cmd-K finds Settings and its pages by name, and the Console for the owner.
//   5 New project (Cmd-K) opens Projects with its new row started.
//   6 The agent's Computer pane draws Browser right under its label: no tall gap, no card over the next label.
//   7, 8 Space Settings opens Console > Space; Console Home and the audit log speak plainly.
//   9 to 14 The @mention line: one quiet line with Add under the sender's own message, for the sender only; a reload keeps it; Add brings them in from that message on and tells them; an agent
//          gets the same line; in a channel Add goes through the channel and tells them the same way.
import test from "node:test";
import assert from "node:assert/strict";
import { bootWalk, composer, connectAi } from "./ownerwalk-kit.test.ts";

test("owner walk fixes: one Settings tab, Add a Space alone, the composer's words, Cmd-K finds Settings, New project, the Computer pane's layout, the @mention line", async (t) => {
  const w = await bootWalk(t, "polish");
  if (!w) return;
  const { page } = w;
  const tabs = async (): Promise<string[]> => (await page.getByTestId("tab-strip").innerText()).split("\n").map((x) => x.trim()).filter((x) => x !== "" && x !== "×");
  try {
    await connectAi(w);
    const dex = (await w.api("agents.create", { name: "Dex", role: "You help the team plan and ship launches.", idempotencyKey: "pw-dex" })).data.agent.agentId as string;
    // the two teammates of the @mention steps (9 to 14) join first, while the walk is fresh
    const maya = await w.join("Maya", "Lin", "maya");
    const omar = await w.join("Omar", "Haddad", "omar");

    await w.step("1 Your Profile opens in the Settings tab already open", async () => {
      await w.go("settings", "settings-place");
      await page.getByTestId("row-page-ai").click();
      await page.getByTestId("page-ai").waitFor({ timeout: 15_000 });
      await page.getByTestId("space-tile").click();
      await page.getByRole("menuitem", { name: "Your Profile", exact: true }).click();
      await page.getByTestId("page-profile").waitFor({ timeout: 15_000 });
      const strip = await tabs();
      assert.equal(strip.filter((x) => x === "Settings").length, 1, `one Settings tab: ${JSON.stringify(strip)}`);
      await w.shot("profile-one-settings-tab", { widths: [1280] });
    });

    await w.step("2 Add a Space opens Add a Space only", async () => {
      await w.go("chat", "chats-place");
      await page.getByTestId("space-tile").click();
      await page.getByRole("menuitem", { name: "Add a Space", exact: true }).click();
      await page.getByText("Join a Space", { exact: true }).waitFor({ timeout: 15_000 });
      await page.keyboard.press("Escape");
      const back = page.getByRole("button", { name: /back/i }).first();
      if (await page.getByText("Join a Space", { exact: true }).count() && await back.count()) await back.click();
      await page.getByTestId("shell").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      assert.equal(await page.getByText("Add a server", { exact: true }).count(), 0, "no Add a server dialog was opened behind it");
      assert.equal(await page.getByTestId("settings-place").count(), 0, "Settings was not opened behind it");
      await w.shot("add-a-space-closed", { widths: [1280] });
    });

    await w.step("3 the composer of a finished chat says Message, not Steer", async () => {
      await w.go("chat", "chats-place");
      const c = composer(page); await c.waitFor({ timeout: 15_000 });
      await c.fill("LONG plan for the launch week");
      await c.press("Enter");
      // the conversation's field is made while the reply is still being written: it says Steer then
      await page.getByTestId("stop-button").waitFor({ timeout: 20_000 });
      await page.waitForFunction(() => /^Steer /.test(document.querySelector('[data-testid="conversation"] ~ * [data-testid="composer-field"], [data-testid="composer-field"]')?.getAttribute("data-placeholder") ?? ""), null, { timeout: 15_000 });
      await page.getByTestId("stop-button").click();
      await page.getByTestId("stop-button").waitFor({ state: "detached", timeout: 30_000 });
      const field = page.locator('[data-testid="composer-field"]').first();
      await page.waitForFunction(() => document.querySelector('[data-testid="composer-field"]')?.getAttribute("data-placeholder") === "Message Assistant…", null, { timeout: 15_000 })
        .catch(async () => { throw new Error(`the empty composer of a finished chat says "${await field.getAttribute("data-placeholder")}"`); });
      // said once, under the reply: the composer does not say it again
      await page.waitForTimeout(800);
      const said = ((await page.locator("body").innerText()).match(/The steps so far are kept/g) ?? []).length;
      assert.equal(said, 1, `"The steps so far are kept" is said ${said} times`);
      assert.equal(await page.getByText("Stopped because Stop was pressed.").count(), 0);
      await w.shot("composer-after-reply", { widths: [1280] });
    });

    await w.step("4 Cmd-K finds Settings, a page of it, and the Console", async () => {
      await page.keyboard.press("Control+K");
      await page.getByTestId("cmdk-input").fill("sett");
      await page.getByText("Settings", { exact: true }).first().waitFor({ timeout: 10_000 });
      await w.shot("cmdk-sett", { widths: [1280] });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+K");
      await page.getByTestId("cmdk-input").fill("notifications");
      await page.getByText("Notifications", { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.keyboard.press("Enter");
      await page.getByTestId("page-notifications").waitFor({ timeout: 15_000 });
      await page.keyboard.press("Control+K");
      await page.getByTestId("cmdk-input").fill("console");
      await page.getByText("Console", { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.keyboard.press("Enter");
      await page.getByTestId("console").waitFor({ timeout: 20_000 });
    });

    await w.step("5 New project starts a new project row", async () => {
      await w.go("chat", "chats-place");
      const seen = w.notes.length;
      await page.keyboard.press("Control+K");
      await page.getByTestId("cmdk-input").fill(">new project");
      await page.getByText("New project", { exact: true }).first().click({ timeout: 10_000 });
      const row = page.getByTestId("records-adding-input");
      await row.waitFor({ timeout: 15_000 });
      assert.match(await row.inputValue(), /^New project$/i, "the new row is a project's");
      await w.shot("new-project-row", { widths: [1280] });
      await row.fill("Spring launch");
      await row.press("Enter");
      await page.getByTestId("project-page").or(page.getByText("Spring launch", { exact: true })).first().waitFor({ timeout: 20_000 });
      const made = (await w.api("projects.list", {})).data;
      assert.ok(JSON.stringify(made).includes("Spring launch"), "a real project was made");
      await page.waitForTimeout(1500);
      assert.deepEqual(w.notes.slice(seen).filter((n) => /\/v1\/records\/get/.test(n)), [], "the new project opens as a project, never read as another type's record");
      // the request is spent: the sidebar can switch to Contacts, and a reload starts no second row (review O2)
      await w.go("records", "records-place");
      await page.getByText("Contacts", { exact: true }).first().click({ timeout: 15_000 });
      await page.getByText("No contacts yet.").first().waitFor({ timeout: 15_000 });
      assert.equal(await page.getByTestId("records-adding-input").count(), 0, "no new row on Contacts");
      await page.reload({ waitUntil: "load" }); await page.getByTestId("records-place").waitFor({ timeout: 25_000 }); await page.waitForTimeout(1500);
      assert.equal(await page.getByTestId("records-adding-input").count(), 0, "a reload starts no second New project row");
      // the phone: the same request opens Projects with a name row (review O3)
      await page.setViewportSize({ width: 390, height: 844 });
      const phoneRow = page.getByTestId("records-adding-input");
      try {
        await page.goto(`${w.web.origin}/chat`, { waitUntil: "load" });
        await page.getByTestId("mobile-shell").waitFor({ timeout: 25_000 });
        await page.getByTestId("new-project").first().click({ timeout: 15_000 });
        await phoneRow.waitFor({ timeout: 25_000 });
      } catch (e) { await page.setViewportSize({ width: 1280, height: 860 }); throw e; }
      await w.shot("new-project-phone", { widths: [390] });
      await phoneRow.fill("Phone launch"); await phoneRow.press("Enter");
      await page.setViewportSize({ width: 1280, height: 860 });
      let names = "";
      for (let i = 0; i < 20 && !names.includes("Phone launch"); i++) { names = JSON.stringify((await w.api("projects.list", {})).data); if (!names.includes("Phone launch")) await page.waitForTimeout(500); }
      assert.ok(names.includes("Phone launch"), "a project made at the phone width");
    });

    await w.step("7 Space Settings opens Console > Space for the owner", async () => {
      await w.go("chat", "chats-place");
      await page.getByTestId("space-tile").click();
      await page.getByRole("menuitem", { name: "Space Settings", exact: true }).click();
      await page.getByTestId("console").waitFor({ timeout: 20_000 });
      await page.getByTestId("page-space").waitFor({ timeout: 20_000 });
      assert.equal(await page.getByTestId("page-profile").count(), 0, "not Your Profile");
      await w.shot("space-settings-console", { widths: [1280] });
    });

    await w.step("8 Console Home says who joined in plain words, and the audit log has one view per visit", async () => {
      await w.join("Maya", "Lin", "maya");
      await page.goto(`${w.web.origin}/console`, { waitUntil: "load" });
      await page.getByTestId("console").waitFor({ timeout: 30_000 });
      await page.getByTestId("row-nav-overview").click();
      await page.getByText(/Maya Lin joined the Space from an invite/).first().waitFor({ timeout: 20_000 });
      const home = await page.locator("body").innerText();
      for (const bad of ["create account of an invite", "An outside agent accepted", "created an invite of", "group member in access settings"]) assert.ok(!home.includes(bad), `Home says "${bad}"`);
      await w.shot("console-home-activity", { widths: [1280] });
      for (let i = 0; i < 3; i++) { await page.reload({ waitUntil: "load" }); await page.getByTestId("console").waitFor({ timeout: 30_000 }); await page.waitForTimeout(800); }
      const rows = (await w.api("audit.list", { action: "audit.viewed", limit: 50 })).data.rows as unknown[];
      assert.ok(rows.length <= 1, `a visit wrote ${rows.length} "opened the audit log" rows`);
    });

    await w.step("6 the Computer pane: Browser sits under its label", async () => {
      const thread = (await w.api("chat.start", { kind: "chat", agentIds: [dex], title: "Desk work", idempotencyKey: "pw-thread" })).data.thread.threadId as string;
      await page.goto(`${w.web.origin}/chat#subject=thread:${thread}`, { waitUntil: "load" });
      await page.getByTestId("composer-field").waitFor({ timeout: 20_000 });
      if (await page.getByTestId("pane-agent").count() === 0) await page.getByTestId("pane-button").click();
      await page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
      await page.getByTestId("tab-computer").click();
      const label = page.getByTestId("label-l-browser");
      await label.waitFor({ timeout: 20_000 });
      const next = page.getByTestId("browser-note").or(page.getByTestId("browser-take")).or(page.getByTestId("browser-none")).or(page.getByTestId("browser-open")).first();
      await next.waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      const a = (await label.boundingBox())!, b = (await next.boundingBox())!;
      const gap = b.y - (a.y + a.height);
      assert.ok(gap >= 0 && gap < 80, `the Browser card starts ${Math.round(gap)} px under its label`);
      await w.shot("computer-pane", { widths: [1280] });
    });

    // 9 to 14: the @mention line (owner, 12 Nov 2026: "Maya is not in this chat." with Add, like Slack), in the same daemon and browser (review M6: one boot for the file)
    const thread = (await w.api("chat.start", { kind: "chat", agentIds: [dex], title: "Pricing copy", idempotencyKey: "mw-th" })).data.thread.threadId as string;
    assert.equal((await w.api("threads.members.add", { threadId: thread, personId: omar.personId })).status, 200);

    await w.step("9 the owner mentions Maya and sees the line with Add", async () => {
      await page.goto(`${w.web.origin}/chat#subject=thread:${thread}`, { waitUntil: "load" });
      const c = composer(page); await c.waitFor({ timeout: 20_000 });
      await c.type("@May", { delay: 60 });
      await page.getByText("Maya Lin", { exact: true }).last().click({ timeout: 10_000 });
      await c.type(" can you check the pricing copy?", { delay: 5 });
      await c.press("Enter");
      const line = page.getByTestId("not-in-chat-text");
      await line.waitFor({ timeout: 20_000 });
      assert.equal(await line.innerText(), "Maya is not in this chat.");
      assert.equal(await page.getByTestId("not-in-chat-add").innerText(), "Add");
      await w.shot("mention-line-under-message", { widths: [1280] });
      await w.shot("mention-line-under-message-phone", { widths: [390], after: async () => { await page.getByTestId("not-in-chat-text").first().waitFor({ timeout: 15_000 }).catch(() => undefined); } });
    });

    await w.step("10 Omar, in the same chat, does not see the line", async () => {
      await omar.page.goto(`${w.web.origin}/chat#subject=thread:${thread}`, { waitUntil: "load" });
      await omar.page.getByText(/check the pricing copy/).first().waitFor({ timeout: 20_000 });
      await omar.page.waitForTimeout(1000);
      assert.equal(await omar.page.getByTestId("not-in-chat-text").count(), 0, "only the sender sees the line");
      await w.shot("mention-omar-sees-no-line", { page: omar.page, widths: [1280] });
    });

    await w.step("11 a reload keeps the line while it is true", async () => {
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("not-in-chat-text").waitFor({ timeout: 20_000 });
    });

    await w.step("12 Add: Maya is in the chat, the line goes, Maya is told and can open the message", async () => {
      await page.getByTestId("not-in-chat-add").click();
      await page.getByTestId("not-in-chat-text").waitFor({ state: "detached", timeout: 20_000 });
      const members = (await w.api("threads.get", { threadId: thread })).data.thread.members as Array<{ id: string }>;
      assert.ok(members.some((m) => m.id === maya.personId), "Maya is a member now");
      await w.shot("mention-after-add", { widths: [1280] });
      let told = false;
      for (let i = 0; i < 30 && !told; i++) {
        const list = (await w.api("notifications.list", {}, maya.token)).data.notifications as Array<{ kind: string; subject?: { id: string } }> | undefined;
        told = (list ?? []).some((n) => n.kind === "mention" && n.subject?.id === thread);
        if (!told) await page.waitForTimeout(500);
      }
      assert.ok(told, "Maya has a mention notification for the chat");
      await maya.page.goto(`${w.web.origin}/chat#subject=thread:${thread}`, { waitUntil: "load" });
      await maya.page.getByText(/check the pricing copy/).first().waitFor({ timeout: 20_000 });
      await w.shot("mention-maya-opens-the-message", { page: maya.page, widths: [1280] });
    });

    await w.step("13 an agent who is not in the chat gets the same line and Add", async () => {
      const iris = (await w.api("agents.create", { name: "Iris", role: "You draft emails.", idempotencyKey: "mw-iris" })).data.agent.agentId as string;
      await page.reload({ waitUntil: "load" });
      const c = composer(page); await c.waitFor({ timeout: 20_000 });
      await c.type("@Iri", { delay: 60 });
      await page.getByText("Iris", { exact: true }).last().click({ timeout: 10_000 });
      await c.type(" draft the follow-up email", { delay: 5 });
      await c.press("Enter");
      const line = page.getByTestId("not-in-chat-text");
      await line.waitFor({ timeout: 20_000 });
      assert.equal(await line.innerText(), "Iris is not in this chat.");
      assert.equal(await page.getByTestId("no-agent-line").count(), 0, "one line for the message, not two");
      await w.shot("mention-agent-line", { widths: [1280] });
      await page.getByTestId("not-in-chat-add").click();
      await line.waitFor({ state: "detached", timeout: 20_000 });
      const agents = (await w.api("threads.get", { threadId: thread })).data.thread.agents as Array<{ agentId: string }>;
      assert.ok(agents.some((a) => a.agentId === iris), "Iris is in the chat");
    });

    await w.step("14 in a channel, Add goes through the channel and Maya's teammate Omar is told the same way", async () => {
      const ch = (await w.api("channels.create", { name: "launch", visibility: "public", memberIds: [], agentIds: [], idempotencyKey: "mw-ch" })).data.channel as { channelId: string; mainThreadId: string };
      await page.goto(`${w.web.origin}/chat#subject=thread:${ch.mainThreadId}`, { waitUntil: "load" });
      const c = composer(page); await c.waitFor({ timeout: 20_000 });
      await c.type("@Oma", { delay: 60 });
      await page.getByText("Omar Haddad", { exact: true }).last().click({ timeout: 10_000 });
      await c.type(" the launch post is ready", { delay: 5 });
      await c.press("Enter");
      const line = page.getByTestId("not-in-chat-text");
      await line.waitFor({ timeout: 20_000 });
      assert.equal(await line.innerText(), "Omar is not in this chat.");
      await page.getByTestId("not-in-chat-add").click();
      await line.waitFor({ state: "detached", timeout: 20_000 });
      let told = false;
      for (let i = 0; i < 30 && !told; i++) {
        const list = (await w.api("notifications.list", {}, omar.token)).data.notifications as Array<{ kind: string; subject?: { id: string } }> | undefined;
        told = (list ?? []).some((n) => n.kind === "mention" && n.subject?.id === ch.mainThreadId);
        if (!told) await page.waitForTimeout(500);
      }
      assert.ok(told, "Omar has a mention notification for the channel");
    });
  } finally {
    if (w.failures.length) console.log(`NOTES:\n${w.notes.join("\n")}`);
    await w.stop();
  }
  assert.deepEqual(w.failures, [], `${w.failures.length} step(s) fail`);
});
