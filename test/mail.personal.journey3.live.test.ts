// Personal mail journey 3 in the real app, with Google and Microsoft played by the fake providers (test/support/fake-mail-providers.ts). A revoked sign-in: Needs you (Chats) shows one Fix item, its Sign in again button signs in again and clears it.
// Needs Node 24, a Chromium and the production web export (VYRE_APP_DIST: the release-evidence job builds it); without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails
// instead. Screenshots of every step, light and dark at desktop width, then a phone pass at the end, go to shots-evidence/personal-mail/3-revoked/. One file per journey so each has its own time cap.
import test from "node:test";
import assert from "node:assert/strict";
import { unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, phonePass, seat, shoot } from "./support/mail-browser.ts";
import { OUT, guidedSetup, signInThroughSheet } from "./support/mail-journey.ts";

test("journey 3, a revoked sign-in: Needs you shows one Fix item, its Sign in again button signs in again and clears it", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "personal" }, env);
  const dir = `${OUT}/3-revoked`;
  try {
    const w = s.world;
    await unlockVault(w);
    w.fake.open("google", "olivia@gmail.test", [{ from: "pat@acme.test", subject: "Before the break", text: "Hello before the break" }]);
    const me = await seat(s, w.owner, "Owner");
    await guidedSetup(s, me, dir);
    await open(me, s, "/mail");
    await me.page.getByTestId("connect-gmail").click();
    await signInThroughSheet(me, "olivia@gmail.test", dir, "connect");
    await me.page.getByText("Hello before the break").first().waitFor({ timeout: 30_000 });
    const [box] = (await w.owner.ok("mail.mailbox.list", { scope: "mine" })).mailboxes as { id: string }[];

    // Olivia removes the app's access in her Google account
    w.fake.revoke("olivia@gmail.test");
    w.clock.t += 2 * 3_600_000;
    await w.owner.ok("mail.sync_now", { mailboxId: box!.id });
    await until(async () => (((await w.owner.ok("tasks.needs_you", {})).items as unknown[]).length > 0 ? true : null), "the Needs you item");

    await open(me, s, "/chat");
    await me.page.getByText(/Sign in to olivia@gmail.test again/).first().waitFor({ timeout: 30_000 });
    assert.equal(await me.page.getByText(/Sign in to olivia@gmail.test again/).count(), 1, "one item");
    await shoot(me.page, dir, "home-fix-item");
    // the item's button repairs it where it is: Connect a mailbox opens on Gmail
    w.fake.restore("olivia@gmail.test");
    // Needs you is on the Chats landing now (Home is gone): its card opens the task, and the task's own button opens Connect a mailbox
    await me.page.getByRole("button", { name: "Sign in again" }).first().click();
    await me.page.waitForURL(/#subject=task/, { timeout: 15_000 });
    me.setEmail("olivia@gmail.test");
    await me.page.getByRole("button", { name: "Sign in again" }).first().click();
    // the provider accepts the account again (fake.restore above), so the task's button signs in without a window or sheet and the item clears; the check below waits for that
    await shoot(me.page, dir, "fix-signed-in");

    await until(async () => (((await w.owner.ok("tasks.needs_you", {})).items as unknown[]).length === 0 ? true : null), "the item is cleared");
    await open(me, s, "/chat");
    await me.page.waitForTimeout(1500);
    assert.equal(await me.page.getByText(/Sign in to olivia@gmail.test again/).count(), 0, "Needs you is clear");
    await shoot(me.page, dir, "home-clear");
    await phonePass(me, s, dir, [{ name: "chats", route: "/chat" }, { name: "inbox", route: "/mail" }]);
    assert.deepEqual(me.errors, [], "no page errors");
  } catch (e) {
    await s.debug(dir);
    throw e;
  } finally { await s.close(); }
});
