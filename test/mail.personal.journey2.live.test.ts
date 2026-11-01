// Personal mail journey 2 in the real app, with Google and Microsoft played by the fake providers (test/support/fake-mail-providers.ts). Team: the admin sets the app once, two members connect their own Gmail, neither sees the other's mail, the admin's assistant cannot read a member's mailbox.
// Needs Node 24, a Chromium and the production web export (VYRE_APP_DIST: the release-evidence job builds it); without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails
// instead. Screenshots of every step, light and dark at desktop width, then a phone pass at the end, go to shots-evidence/personal-mail/2-team/. One file per journey so each has its own time cap.
import test from "node:test";
import assert from "node:assert/strict";
import { ask, connectClaude, makeAgent, unlockVault } from "./support/mail-world.ts";
import { standIn } from "./memory-live-kit.ts";
import { bootScreens, browserOrSkip, open, phonePass, seat, shoot } from "./support/mail-browser.ts";
import { OUT, guidedSetup, signInThroughSheet } from "./support/mail-journey.ts";

test("journey 2, Team: the admin sets the app once, two members connect their own Gmail, neither sees the other's mail, an agent cannot read the other's mailbox", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team", engineOpenSession: standIn }, env);
  const dir = `${OUT}/2-team`;
  try {
    const w = s.world;
    await unlockVault(w);
    const account = await connectClaude(w);
    w.fake.open("google", "ana@gmail.test", [{ from: "pat@acme.test", subject: "Ana's contract", text: "Ana only." }]);
    w.fake.open("google", "bo@gmail.test", [{ from: "lee@acme.test", subject: "Bo's invoice", text: "Bo only." }]);
    const admin = await seat(s, w.owner, "Owner");
    await guidedSetup(s, admin, dir);

    const ana = await w.join("ana");
    const bo = await w.join("bo");
    const anaSeat = await seat(s, ana, "Member");
    const boSeat = await seat(s, bo, "Member");
    for (const [seatOf, email, step] of [[anaSeat, "ana@gmail.test", "ana"], [boSeat, "bo@gmail.test", "bo"]] as const) {
      await open(seatOf, s, "/mail");
      await seatOf.page.getByTestId("connect-gmail").click();
      await signInThroughSheet(seatOf, email, dir, step);
    }
    await anaSeat.page.getByText("Ana's contract").first().waitFor({ timeout: 30_000 });
    await boSeat.page.getByText("Bo's invoice").first().waitFor({ timeout: 30_000 });
    await shoot(anaSeat.page, dir, "ana-inbox");
    await shoot(boSeat.page, dir, "bo-inbox");
    assert.equal(await anaSeat.page.getByText("Bo's invoice").count(), 0, "Ana does not see Bo's mail");
    assert.equal(await boSeat.page.getByText("Ana's contract").count(), 0, "Bo does not see Ana's mail");
    await open(admin, s, "/mail");
    await admin.page.waitForTimeout(1500);
    assert.equal(await admin.page.getByText("Ana's contract").count() + await admin.page.getByText("Bo's invoice").count(), 0, "the admin sees neither");
    await shoot(admin.page, dir, "admin-inbox");

    // an assistant acts with the access of whoever asked
    const anaBox = ((await ana.ok("mail.mailbox.list", { scope: "all" })).mailboxes as { id: string }[])[0]!;
    const boBox = ((await bo.ok("mail.mailbox.list", { scope: "all" })).mailboxes as { id: string }[])[0]!;
    const list = (mailboxId: string) => `TOOL mail_message_list ${JSON.stringify({ mailboxId })}`;
    const anaHelper = await makeAgent(ana, "Ana helper", account);
    assert.ok((await ask(w, ana, anaHelper, list(anaBox.id))).includes("Ana's contract"), "Ana's assistant reads Ana's mailbox");
    assert.ok(!(await ask(w, ana, anaHelper, list(boBox.id))).includes("Bo's invoice"), "and not Bo's");
    const adminHelper = await makeAgent(w.owner, "Olivia helper", account);
    assert.ok(!(await ask(w, w.owner, adminHelper, list(anaBox.id))).includes("Ana's contract"), "the admin's assistant reads no member's mailbox");
    await open(admin, s, "/chat");
    await shoot(admin.page, dir, "admin-chat");
    await phonePass(anaSeat, s, dir, [{ name: "ana-inbox", route: "/mail" }, { name: "ana-home", route: "/home" }]);
    assert.deepEqual([...anaSeat.errors, ...boSeat.errors, ...admin.errors], [], "no page errors");
  } finally { await s.close(); }
});
