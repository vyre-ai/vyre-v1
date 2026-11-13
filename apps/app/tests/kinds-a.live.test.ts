// Three kinds of flaw the owner named, walked in the real app against a real daemon (lane f-kinds-a, 13 Nov 2026): an id shown to a person, the same thing listed twice, and a notice on a page nobody changed.
//   Settings > Profile, just opened, on a computer whose zone is not the default: no "Saved  Undo" line.
//   A project with the owner on it: Overview > People and agents names the owner, and the command bar lists "launch" once per thing, with no id in any row.
// Every step also runs the crash guard, which now scans the page for an id (apps/app/tests/crash-guard.ts).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";

const PASSWORD = "fixture password 123";

test("kinds: no id, no repeat, no unasked notice", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({
    executablePath: process.env["CHROME_BIN"] || chromium.executablePath(),
    args: ["--no-sandbox"],
  });
  const shots = process.env["VYRE_KINDS_SHOTS"] ?? "/tmp/vyre-kinds-shots";
  fs.mkdirSync(shots, { recursive: true });
  try {
    // a computer in Pakistan: the Profile seeds its time zone from it the first time it opens
    const owner = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Asia/Karachi" });
    const page = await owner.newPage();
    const guard = guardCrashes(page);
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner");
    await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD);
    await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page);
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    let n = 0;
    const call = async (cap: string, data: Record<string, unknown>): Promise<any> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await owner.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { idempotencyKey: `ka-${cap}-${++n}`, ...data },
      });
      const body = await r.json();
      assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body).slice(0, 500)}`);
      return body.data;
    };

    // 1. Settings > Profile, just opened: nothing was changed, so nothing is announced
    await page.goto(`${web.origin}/settings`, { waitUntil: "load" });
    await page
      .getByTestId("settings")
      .waitFor({ timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByText("Profile", { exact: true })
      .first()
      .click({ timeout: 20_000 })
      .catch(() => undefined);
    await page.getByTestId("profile-card").waitFor({ timeout: 30_000 });
    // the seed wrote the computer's zone and the row shows it (waited on, not slept on); only then can a Saved line be said to be absent
    await page.waitForFunction(() => document.body.innerText.includes("Karachi"), undefined, { timeout: 20_000 });
    assert.equal(await page.getByTestId("saved").count(), 0, "no Saved line on a Profile nobody changed");
    assert.equal(await page.getByTestId("undo").count(), 0, "no Undo either");
    // the seed did run (the computer's zone is now the person's), and it said nothing
    assert.equal(
      (await call("settings.get", { key: "profile.timezone" })).row.value,
      "Asia/Karachi",
      "the zone was seeded from this computer",
    );
    await guard.check("Settings, Profile, just opened");
    await page.screenshot({ path: path.join(shots, "profile-just-opened.png") });

    // 2. a project, its channel, and a chat that all say "launch"
    const types = (await call("schema.types.list", {})).types as Array<{ key: string }>;
    const type = (types.find((x) => /project|matter/.test(x.key)) ?? types[0]!).key;
    const project = await call("projects.create", {
      type,
      title: "Spring launch",
      overviewTemplate: "tpl_client_account",
    });
    const pid = project.projectId as string;
    await call("channels.create", { name: "launch-week", visibility: "public" });
    await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.getByTestId("head-projects").waitFor({ timeout: 20_000 });
    await page.getByTestId(`row-pj:${pid}`).click();
    await page.getByTestId("project-page").waitFor({ timeout: 25_000 });
    await page.getByTestId("tab-overview").click({ force: true, timeout: 10_000 });
    await page.getByTestId("project-overview").waitFor({ timeout: 20_000 });
    await page.getByTestId("live-people").waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => !document.querySelector("[data-testid=live-loading]"), undefined, {
      timeout: 20_000,
    });
    const people = await page.getByTestId("live-people").innerText();
    assert.match(people, /Olivia Owner/, `People and agents names the owner: ${people}`);
    await guard.check("Project Overview, People and agents");
    await page.getByTestId("live-people").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, "project-overview-people.png") });

    // 2b. an ordinary channel with a message and a reply thread: search indexes its main thread as a chat, and the command bar shows the channel ONCE; the reply thread stays its own row
    const room = await call("channels.create", { name: "standup-room", visibility: "public" });
    const roomThread = (room.channel?.mainThreadId ?? room.mainThreadId) as string;
    const first = (await call("chat.post", { threadId: roomThread, body: "Notes for the standup go here" }))
      .message as { messageId: string };
    const reply = (await call("chat.thread", { threadId: roomThread, messageId: first.messageId })).thread as {
      threadId: string;
    };
    await call("chat.post", { threadId: reply.threadId, body: "Replies about the standup agenda" });

    // 3. the command bar: "launch" lists each thing once and shows no id
    await page.keyboard.press("Control+K");
    await page.getByTestId("cmdk-input").waitFor({ timeout: 10_000 });
    await page.getByTestId("cmdk-input").type("launch", { delay: 30 });
    await page.waitForFunction(
      () => {
        const t = document.querySelector("[data-testid=cmdk-list]")?.textContent ?? "";
        return t.includes("Spring launch") && t.includes("launch-week");
      },
      undefined,
      { timeout: 20_000 },
    );
    const rows = (await page.getByTestId("cmdk-list").innerText())
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    const titles = rows.filter((r) => /^(Spring launch|launch-week|#launch-week)$/i.test(r));
    assert.ok(titles.length >= 2, `the list has the project and the channel: ${JSON.stringify(rows)}`);
    assert.deepEqual([...new Set(titles)], titles, `no row twice: ${JSON.stringify(rows)}`);
    // the channel by its name: one row, and its reply thread beside it
    await page.getByTestId("cmdk-input").fill("standup");
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-testid=cmdk-list]")?.textContent ?? "").includes(
          "Replies about the standup agenda",
        ),
      undefined,
      { timeout: 30_000 },
    );
    const roomRows = (await page.getByTestId("cmdk-list").innerText())
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    // the channel's own thread must not also be a row under Chats (the channel row is the one that stays)
    const heads = ["Chats", "Channels", "Tasks", "Records", "Files", "People", "Agents", "Ask"];
    const after = roomRows.indexOf("Chats") < 0 ? [] : roomRows.slice(roomRows.indexOf("Chats") + 1);
    const end = after.findIndex((r) => heads.includes(r));
    const chatTitles = end < 0 ? after : after.slice(0, end);
    assert.ok(
      !chatTitles.some((r) => /^#?standup-room$/i.test(r)),
      `the channel's main thread is not a second row under Chats: ${JSON.stringify(roomRows)}`,
    );
    assert.ok(roomRows.includes("Channels"), `the channel row stays: ${JSON.stringify(roomRows)}`);
    assert.ok(
      roomRows.some((r) => r.includes("Replies about the standup agenda")),
      `its reply thread is its own row: ${JSON.stringify(roomRows)}`,
    );
    await page.getByTestId("cmdk-input").fill("launch");
    await guard.check("the command bar, launch");
    await page.screenshot({ path: path.join(shots, "command-bar-launch.png") });
    await page.keyboard.press("Escape");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
