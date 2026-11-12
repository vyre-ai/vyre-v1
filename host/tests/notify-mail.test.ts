// The notifications module's email through the Space's own mail (host/src/seams/notify-mail.ts): from the service mailbox with a verified sending domain, to the person's address (their accepted
// invitation), or nothing with the reason and one health line for admins. A stand-in for the mail module answers mail.mailbox.list, mail.domain.list and mail.send.
import test from "node:test";
import assert from "node:assert/strict";
import { HEALTH_NAME, NO_MAILBOX_LINE, createNotifyMailer } from "../src/seams/notify-mail.ts";

interface World { mailbox: boolean; verified: boolean; sendStatus: string; members: Array<{ userId: string; email: string }> }
function rig(w: Partial<World> = {}) {
  const world: World = { mailbox: true, verified: true, sendStatus: "queued", members: [{ userId: "usr_bob", email: "bob@northwind.test" }], ...w };
  const sent: Array<Record<string, unknown>> = [];
  const seeds: unknown[] = [];
  const health = new Map<string, string>();
  const mailer = createNotifyMailer({
    space: "spc_core", owner: () => "usr_olivia",
    emails: async () => world.members,
    health: (name, line) => { if (line) health.set(name, line.detail); else health.delete(name); },
    nameOf: async (p) => (p === "usr_bob" ? "Bob" : undefined),
    invoke: async (cap, input, seed) => {
      seeds.push(seed);
      if (cap === "mail.mailbox.list") return { status: "ok", output: { mailboxes: world.mailbox ? [{ id: "mbx_service" }] : [] } };
      if (cap === "mail.domain.list") return { status: "ok", output: { domains: [{ name: "northwind.test", verified: world.verified }] } };
      if (cap === "mail.send") { sent.push(input as Record<string, unknown>); return { status: "ok", output: { messageId: "eml_1", status: world.sendStatus, suppressed: [] } }; }
      throw new Error(`unexpected ${cap}`);
    },
  });
  return { mailer, sent, seeds, health, world };
}

test("with a service mailbox and a verified domain: one email from that mailbox to the person's address, with the subject and the link only; no health line", async () => {
  const r = rig();
  assert.equal(await r.mailer.email({ to: "usr_bob", subject: "The Space is scheduled for deletion on 18 November 2026.", deepLink: "vyre://console/spacedel", key: "ntf_1" }), "sent");
  assert.equal(r.sent.length, 1);
  assert.deepEqual(r.sent[0], { mailboxId: "mbx_service", route: "space_domain", to: [{ address: "bob@northwind.test" }], subject: "The Space is scheduled for deletion on 18 November 2026.", text: "The Space is scheduled for deletion on 18 November 2026.\n\nOpen it in Vyre: vyre://console/spacedel", idempotencyKey: "notify:usr_bob:ntf_1" });
  assert.deepEqual(r.seeds[0], { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, origin: "notify" }, "as the Space owner, an ordinary authorized call, the way portal links go");
  assert.equal(r.health.has(HEALTH_NAME), false);
});

test("no service mailbox, or no verified domain: nothing is sent, the answer is no_mailbox (never sent), and admins get the one health line", async () => {
  for (const w of [{ mailbox: false }, { verified: false }]) {
    const r = rig(w);
    assert.equal(await r.mailer.email({ to: "usr_bob", subject: "s", deepLink: "vyre://inbox", key: "k" }), "no_mailbox");
    assert.equal(r.sent.length, 0);
    assert.equal(r.health.get(HEALTH_NAME), NO_MAILBOX_LINE);
    assert.match(NO_MAILBOX_LINE, /^Email notices are off: this Space has no sending mailbox\. People see notices in the app only\./);
    // a mailbox made later: the next check clears it
    r.world.mailbox = true; r.world.verified = true;
    assert.equal(await r.mailer.check(), true);
    assert.equal(r.health.has(HEALTH_NAME), false);
  }
});

test("a person with no address in this Space (often the owner, who claimed it and was never invited), or one who left or was suspended (not in the active list): no_address, nothing sent", async () => {
  const r = rig({ members: [] });
  assert.equal(await r.mailer.email({ to: "usr_olivia", subject: "s", deepLink: "vyre://inbox", key: "k" }), "no_address");
  assert.equal(r.sent.length, 0);
});

test("a suppressed address and a held send are said as such, never as sent; any other answer is a failure to try again", async () => {
  assert.equal(await rig({ sendStatus: "suppressed" }).mailer.email({ to: "usr_bob", subject: "s", deepLink: "d", key: "k" }), "suppressed");
  assert.equal(await rig({ sendStatus: "held" }).mailer.email({ to: "usr_bob", subject: "s", deepLink: "d", key: "k" }), "held");
  await assert.rejects(() => rig({ sendStatus: "bounced" }).mailer.email({ to: "usr_bob", subject: "s", deepLink: "d", key: "k" }), /not sent/);
});

test("an email given up on after its tries: one health line that names the person", async () => {
  const r = rig();
  await r.mailer.gaveUp({ to: "usr_bob", kind: "space.deletion_scheduled" });
  assert.deepEqual([...r.health.values()], ["A notice about deleting this Space could not be emailed to Bob."]);
});
