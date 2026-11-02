// A person turns an Automation on and it can send: no hand-sharing, through the gateway with real tokens, Space and Personal. Resend is the only fake. Golden 5 walks the whole lead; this holds what Turn on owes.
import test from "node:test";
import assert from "node:assert/strict";
import { setDefaultDns } from "../../modules/mail/handlers/extra/dns.ts";
import { bootFlowSpace, expectStatus } from "./02-space.ts";
import { fakeDns, fakeNet } from "./05-lead-automation-reply-call.ts";
import type { Net } from "./05-lead-automation-reply-call.ts";

const DOMAIN = "send.acme.test";
const LIVE = ["automations", "runs", "steps-core", "gate", "mail", "resend", "contacts-link", "records", "schema", "tasks", "settings", "search", "devices", "access", "spaces"];

async function until<T>(what: string, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + 15_000;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("Turn on: a Space and a Personal Automation send with nothing shared by hand; with no sender it says so", async () => {
  const net: Net = { requests: [], emails: [] };
  const zone = new Map<string, string[]>();
  setDefaultDns(fakeDns(zone));
  const s = await bootFlowSpace(LIVE, { address: "space.acme.test", fetch: fakeNet(net, zone) as never, vault: { secret: (h: string) => Promise.resolve(`fake-${h.replace(/^#/, "")}`), signRs256: () => Promise.resolve("") } } as never);
  try {
    const admin = s.d.token;
    const make = async (name: string, input: Record<string, unknown>): Promise<string> => {
      const made = expectStatus(await s.call("automations.create", admin, { idempotencyKey: `s-${name}`, name }), 200, "automations.create");
      const automationId = (made.automation?.id ?? made.automationId) as string;
      expectStatus(await s.call("automations.update", admin, { automationId, definition: { triggers: [{ key: "manual" }], nodes: [{ id: "hello", key: "send_email", input }] } }), 200, "automations.update");
      return automationId;
    };
    const runs = async (automationId: string, key: string): Promise<void> => {
      const runId = expectStatus(await s.call("automations.run", admin, { automationId, idempotencyKey: key }), 200, "automations.run").runId as string;
      await until("the run to send", async () => {
        const run = expectStatus(await s.call("runs.get", admin, { runId }), 200, "runs.get").run as { status?: string };
        if (run.status === "failed" || run.status === "stopped") assert.fail(`the run ended ${run.status}: ${JSON.stringify(await s.call("runs.steps", admin, { runId }))}`);
        return run.status === "succeeded" ? true : undefined;
      });
    };
    const body = { to: ["pat@acme.test"], subject: "Hello", body: "Hi Pat" };

    // no mailbox anywhere: Turn on says what to do
    const none = await make("nothing", body);
    const first = await s.call("automations.set_enabled", admin, { automationId: none, enabled: true });
    assert.equal(first.status, 422, JSON.stringify(first.body));
    assert.match(first.body.error.message, /No mailbox is connected yet\. Connect one in Console, Comms/);

    // a mailbox with no sending domain cannot send, and Turn on says that too
    const box = expectStatus(await s.call("mail.mailbox.create", admin, { idempotencyKey: "s-box", kind: "shared", address: `hello@${DOMAIN}`, title: "Acme" }), 200, "mail.mailbox.create").mailbox;
    const mailboxId = (box.mailboxId ?? box.id) as string;
    const early = await make("early", { ...body, mailboxId });
    const refused = await s.call("automations.set_enabled", admin, { automationId: early, enabled: true });
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.match(refused.body.error.message, new RegExp(`hello@${DOMAIN} cannot send right now\\..*Console, Comms`));

    const added = expectStatus(await s.call("mail.domain.add", admin, { idempotencyKey: "s-domain", name: DOMAIN, provider: "resend" }), 200, "mail.domain.add");
    expectStatus(await s.call("mail.domain.check", admin, { domainId: (added.domain?.id ?? added.domainId ?? added.id) as string }), 200, "mail.domain.check");

    // Personal: it runs as its owner
    const personal = await make("mine", { ...body, mailboxId });
    expectStatus(await s.call("automations.set_enabled", admin, { automationId: personal, enabled: true }), 200, "automations.set_enabled");
    await runs(personal, "s-run-personal");
    assert.equal(net.emails.length, 1, "the Personal Automation sent");

    // Space: Promote then Turn on, and the Automation holds exactly what the press gave it
    const space = await make("ours", { ...body, mailboxId });
    expectStatus(await s.call("automations.promote", admin, { automationId: space, confirm: true }), 200, "automations.promote");
    expectStatus(await s.call("automations.set_enabled", admin, { automationId: space, enabled: true }), 200, "automations.set_enabled");
    const shares = expectStatus(await s.call("access.shares_of", admin, { resource: { type: "mailbox", id: mailboxId } }), 200, "access.shares_of").shares as { grant: { subject: { id: string }; level: string; source?: string; by?: string; resource?: { id?: string } } }[];
    const row = shares.map((x) => x.grant).find((g) => g.source === `automation:${space}` && g.resource?.id === mailboxId);
    assert.ok(row, `the press wrote a grant row: ${JSON.stringify(shares)}`);
    assert.deepEqual([row.subject.id, row.level], [`svc_${space.slice(4)}`, "use"]);
    await runs(space, "s-run-space");
    assert.equal(net.emails.length, 2, "the Space Automation sent");
    const senders = expectStatus(await s.call("automations.senders", admin, { automationId: space }), 200, "automations.senders").senders as { address: string; usable: boolean }[];
    assert.deepEqual(senders.map((x) => [x.address, x.usable]), [[`hello@${DOMAIN}`, true]]);

    // turned off and the step removed by a person, the row goes
    expectStatus(await s.call("automations.set_enabled", admin, { automationId: space, enabled: false }), 200, "automations.set_enabled");
    expectStatus(await s.call("automations.update", admin, { automationId: space, definition: { triggers: [{ key: "manual" }], nodes: [] } }), 200, "automations.update");
    const after = expectStatus(await s.call("access.shares_of", admin, { resource: { type: "mailbox", id: mailboxId } }), 200, "access.shares_of").shares as { grant: { source?: string } }[];
    assert.ok(!after.some((x) => x.grant.source === `automation:${space}`), "no step names it, so it no longer holds it");
  } finally { await s.stop(); }
});
