// Personal mail journey 1 in the real app, with Google and Microsoft played by the fake providers (test/support/fake-mail-providers.ts). Personal, the first hour: guided setup, connect, mail appears, reply in the Inbox, quit, mail arrives while closed, open again, it catches up.
// Needs Node 24, a Chromium and the production web export (VYRE_APP_DIST: the release-evidence job builds it); without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails
// instead. Screenshots of every step, light and dark at desktop width, then a phone pass at the end, go to shots-evidence/personal-mail/1-personal-first-hour/. One file per journey so each has its own time cap.
import test from "node:test";
import assert from "node:assert/strict";
import { unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, phonePass, seat, shoot } from "./support/mail-browser.ts";
import { OUT, guidedSetup, signInThroughSheet } from "./support/mail-journey.ts";

test("journey 1, Personal first hour: guided setup, connect, mail appears, reply, quit, new mail while closed, reopen and catch up", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "personal" }, env);
  const dir = `${OUT}/1-personal-first-hour`;
  try {
    const w = s.world;
    await unlockVault(w);
    w.fake.open("google", "olivia@gmail.test", [{ from: "pat@acme.test", subject: "Lunch on Friday", text: "Are you free for lunch on Friday?" }]);
    const me = await seat(s, w.owner, "Owner");

    await open(me, s, "/mail");
    await me.page.getByTestId("connect-gmail").waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "inbox-empty");

    // no sign-in app yet: the sheet says so in one line and links to the guided setup
    await me.page.getByTestId("connect-gmail").click();
    await me.page.getByTestId("connect-unavailable").waitFor({ timeout: 15_000 });
    await shoot(me.page, dir, "connect-needs-app");
    await me.page.getByTestId("connect-setup").click();
    await guidedSetup(s, me, dir);

    // back to the Inbox: the tile now signs in
    await open(me, s, "/mail");
    await me.page.getByTestId("connect-gmail").click();
    await signInThroughSheet(me, "olivia@gmail.test", dir, "connect");
    await me.page.getByText("Lunch on Friday").first().waitFor({ timeout: 30_000 });
    await shoot(me.page, dir, "mail-appears");
    const [box] = (await w.owner.ok("mail.mailbox.list", { scope: "mine" })).mailboxes as { id: string; address: string }[];
    assert.equal(box!.address, "olivia@gmail.test");

    // reply, in the Inbox, as a person does: open the conversation, write, send
    await me.page.getByText("Lunch on Friday").first().click();
    await me.page.getByTestId("contact-composer-field").waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "conversation");
    await me.page.getByTestId("contact-composer-field").fill("Yes, noon works.");
    await shoot(me.page, dir, "reply-written");
    await me.page.getByTestId("composer-send").click();
    await until(async () => (w.fake.sent.length > 0 ? true : null), "the reply reaching Gmail");
    assert.deepEqual(w.fake.sent.map((m) => [m.email, m.to]), [["olivia@gmail.test", ["pat@acme.test"]]]);
    assert.match(w.fake.sent[0]!.text, /Yes, noon works\./);
    await me.page.waitForTimeout(800);
    await shoot(me.page, dir, "replied");

    // quit; mail arrives while nothing runs; open again hours later
    await me.ctx.close();
    const quiet = w.fake.seen.length;
    await w.restart();
    w.fake.deliver("olivia@gmail.test", { from: "sam@acme.test", subject: "Sent while you were away", text: "This arrived while Vyre was closed." });
    assert.equal(w.fake.seen.length, quiet, "nothing talked to Google while it was closed");
    w.clock.t += 3 * 3_600_000;
    await unlockVault(w);
    const again = await seat(s, w.owner, "Owner");
    await open(again, s, "/mail");
    await again.page.getByText("Sent while you were away").first().waitFor({ timeout: 45_000 });
    await shoot(again.page, dir, "caught-up");
    const mails = ((await w.owner.ok("mail.message.list", { mailboxId: box!.id })).messages as { subject: string }[]).map((m) => m.subject);
    assert.equal(mails.filter((x) => x === "Lunch on Friday").length, 1, "no mail doubled");
    await phonePass(again, s, dir, [{ name: "inbox", route: "/mail" }, { name: "home", route: "/home" }, { name: "settings", route: "/settings" }]);
    assert.deepEqual(me.errors.concat(again.errors), [], "no page errors");
  } finally { await s.close(); }
});
