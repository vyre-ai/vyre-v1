// @tsx
// A link to a view opens that view on a phone (390 wide). The phone shell used to drop the hash of a link to a tab's place, so every Inbox link (Unmatched, Meetings, ...) landed on the list of inboxes.
// And the Unmatched list, once there, opens a conversation with one tap (there is no double tap on a phone).
import test from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";

const SCREENS = `[...document.querySelectorAll('[data-testid^="screen-"]')].map((e) => e.getAttribute("data-testid")).join(",")`;

test("phone: #main=meetings opens the Inbox on Meetings, not on the list of inboxes", async (t) => {
  const k = await bootNav({ width: 390, height: 844, scheme: "light", phone: true, tag: "phone-link-meetings" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page } = k;
  try {
    await page.goto(`${new URL(page.url()).origin}/inbox#main=meetings`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("mobile-shell").waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      `[...document.querySelectorAll('[role="heading"]')].some((e) => e.innerText.trim() === "Meetings")`,
      null,
      { timeout: 20_000 },
    );
    assert.equal(await page.getByTestId("inbox-sidebar").count(), 0, "not the list of inboxes");
  } finally {
    await k.close();
  }
});

test("phone: #screen=inbox.unmatched opens the Unmatched list, and one tap on a stranger opens the conversation", async (t) => {
  const k = await bootNav({ width: 390, height: 844, scheme: "light", phone: true, tag: "phone-link-unmatched" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, api } = k;
  try {
    const box = (
      await api("mail.mailbox.create", {
        kind: "shared",
        address: "hello@acme.test",
        title: "Hello",
        privacy: "space",
        idempotencyKey: "r41-box",
      })
    ).mailbox as { id: string };
    const ingested = (await api("mail.ingest", {
      source: "imap",
      mailboxId: box.id,
      providerId: "prov-r41",
      rfcMessageId: "<dana-r41@fox.test>",
      direction: "in",
      from: { address: "dana@fox.test", name: "Dana Fox" },
      to: [{ address: "hello@acme.test" }],
      subject: "Engagement papers",
      text: "Please find my papers attached.",
      receivedAt: Date.now(),
      idempotencyKey: "r41-ingest",
    })) as { linked: string };
    assert.equal(ingested.linked, "none", "a stranger stays unmatched");
    await page.goto(`${new URL(page.url()).origin}/inbox#screen=inbox.unmatched`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("inbox-unmatched").waitFor({ timeout: 30_000 });
    const row = page.getByText("Dana Fox").first();
    await row.waitFor({ timeout: 20_000 });
    const before = (await page.evaluate(SCREENS)) as string;
    await row.click();
    await page.waitForFunction(`(${SCREENS}) !== ${JSON.stringify(before)}`, null, { timeout: 10_000 });
  } finally {
    await k.close();
  }
});
