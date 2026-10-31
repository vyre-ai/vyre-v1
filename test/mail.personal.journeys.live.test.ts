// The real app, three lives of personal mail, with Google and Microsoft played by the fake providers (test/support/fake-mail-providers.ts). Needs Node 24, a Chromium and the production
// web export (VYRE_APP_DIST: the release-evidence job builds it); without them it skips and says why, and with VYRE_REQUIRE_CHROME=1 (CI) it fails instead. Screenshots of every step, light and dark, desktop
// and phone, go to shots-evidence/personal-mail/<journey>/.
//   1 Personal, the first hour: set up the sign-in app (guided), connect Gmail, mail appears, reply, quit, mail arrives while closed, open again, it catches up.
//   2 Team: the admin sets the app once; two members each connect their own Gmail; neither sees the other's mail; the admin's assistant cannot read a member's mailbox.
//   3 A revoked sign-in: Home shows one Fix item, Fix opens Connect a mailbox, signing in again clears it.
import test from "node:test";
import assert from "node:assert/strict";
import { ask, connectClaude, unlockVault, until } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";
import type { Screens, Seat } from "./support/mail-browser.ts";
import { standIn } from "./memory-live-kit.ts";

const OUT = "shots-evidence/personal-mail";
const CLIENT = { id: "e2e-client.apps.googleusercontent.com", secret: "e2e-client-secret-GOCSPX" };

/** Settings > Connections > Sign in with your own account: the guided panel, filled and saved. */
async function guidedSetup(s: Screens, who: Seat, dir: string): Promise<void> {
  await open(who, s, "/settings");
  await who.page.getByTestId("row-page-connections").click();
  await who.page.getByTestId("signin-google").click();
  await who.page.getByTestId("signin-google-redirect").waitFor({ timeout: 15_000 });
  assert.equal(await who.page.getByTestId("signin-google-redirect").innerText(), `${s.web.origin}/oauth/callback`, "the exact redirect address to register");
  await shoot(who.page, dir, "guided-setup");
  await who.page.getByTestId("signin-google-id").fill(CLIENT.id);
  await who.page.getByTestId("signin-google-id").press("Tab");
  await who.page.getByTestId("signin-google-secret").fill(CLIENT.secret);
  await who.page.getByTestId("signin-google-secret").press("Tab");
  await who.page.getByTestId("signin-google-save").click();
  await who.page.getByText(/Client e2e-client.* from #Google_Sign_In/).waitFor({ timeout: 15_000 });
  await shoot(who.page, dir, "app-saved");
}

/** The Connect a mailbox sheet on the Gmail tab, signed in as the account the fake Google is told about; returns once the sheet closes with the mailbox made. */
async function signInThroughSheet(who: Seat, email: string, dir: string, step: string): Promise<void> {
  who.setEmail(email);
  await who.page.getByTestId("connect-signin").waitFor({ timeout: 15_000 });
  await shoot(who.page, dir, `${step}-sheet`);
  const popup = who.ctx.waitForEvent("page");
  await who.page.getByTestId("connect-signin").click();
  const approved = await popup;
  await approved.getByText("Account connected").waitFor({ timeout: 30_000 });
  await approved.close();
  await who.page.getByTestId("connect-signed-in").click();
  await who.page.getByTestId("connect-mailbox").waitFor({ state: "detached", timeout: 30_000 });
}

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

    // reply
    const sent = await w.owner.ok("mail.send_as", { mailboxId: box!.id, to: [{ address: "pat@acme.test" }], subject: "Re: Lunch on Friday", text: "Yes, noon works." });
    assert.ok(sent.messageId);
    assert.deepEqual(w.fake.sent.map((m) => [m.email, m.to, m.subject]), [["olivia@gmail.test", ["pat@acme.test"], "Re: Lunch on Friday"]]);
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
    assert.deepEqual(me.errors.concat(again.errors), [], "no page errors");
  } finally { await s.close(); }
});

test("journey 2, Team: the admin sets the app once, two members connect their own Gmail, neither sees the other's mail, an agent cannot read the other's mailbox", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team", engineOpenSession: standIn }, env);
  const dir = `${OUT}/2-team`;
  try {
    const w = s.world;
    await unlockVault(w);
    await connectClaude(w);
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

    // an agent acts for whoever asked: the admin's assistant reads no member's mail
    const anaBox = ((await ana.ok("mail.mailbox.list", { scope: "all" })).mailboxes as { id: string }[])[0]!;
    const agent = (await w.owner.ok("agents.create", { name: "Olivia helper", role: "You help Olivia." })).agent.agentId as string;
    const reply = await ask(w, w.owner, agent, `TOOL mail_message_list ${JSON.stringify({ mailboxId: anaBox.id })}`);
    assert.ok(!reply.includes("Ana's contract"), `Ana's mailbox is closed to the assistant: ${reply.slice(0, 200)}`);
    await open(admin, s, "/chat");
    await shoot(admin.page, dir, "admin-chat");
    assert.deepEqual([...anaSeat.errors, ...boSeat.errors, ...admin.errors], [], "no page errors");
  } finally { await s.close(); }
});

test("journey 3, a revoked sign-in: Home shows one Fix item, Fix opens Connect a mailbox, signing in again clears it", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "personal" }, env);
  const dir = `${OUT}/3-revoked`;
  try {
    const w = s.world;
    await unlockVault(w);
    w.fake.open("google", "olivia@gmail.test", [{ from: "pat@acme.test", subject: "Before the break", text: "Hello" }]);
    const me = await seat(s, w.owner, "Owner");
    await guidedSetup(s, me, dir);
    await open(me, s, "/mail");
    await me.page.getByTestId("connect-gmail").click();
    await signInThroughSheet(me, "olivia@gmail.test", dir, "connect");
    await me.page.getByText("Before the break").first().waitFor({ timeout: 30_000 });
    const [box] = (await w.owner.ok("mail.mailbox.list", { scope: "mine" })).mailboxes as { id: string }[];

    // Olivia removes the app's access in her Google account
    w.fake.revoke("olivia@gmail.test");
    w.clock.t += 2 * 3_600_000;
    await w.owner.ok("mail.sync_now", { mailboxId: box!.id });
    await until(async () => (((await w.owner.ok("tasks.needs_you", {})).items as unknown[]).length > 0 ? true : null), "the Needs you item");

    await open(me, s, "/home");
    await me.page.getByText(/Sign in to olivia@gmail.test again/).first().waitFor({ timeout: 30_000 });
    assert.equal(await me.page.getByText(/Sign in to olivia@gmail.test again/).count(), 1, "one item");
    await shoot(me.page, dir, "home-fix-item");
    await me.page.getByText(/Sign in to olivia@gmail.test again/).first().click();
    await me.page.getByTestId("needs-mailfix").waitFor({ timeout: 20_000 });
    await shoot(me.page, dir, "needs-you-detail");
    w.fake.restore("olivia@gmail.test");
    await me.page.getByTestId("needs-mailfix").click();
    await signInThroughSheet(me, "olivia@gmail.test", dir, "fix");

    await until(async () => (((await w.owner.ok("tasks.needs_you", {})).items as unknown[]).length === 0 ? true : null), "the item is cleared");
    await open(me, s, "/home");
    await me.page.waitForTimeout(1500);
    assert.equal(await me.page.getByText(/Sign in to olivia@gmail.test again/).count(), 0, "Home is clear");
    await shoot(me.page, dir, "home-clear");
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
