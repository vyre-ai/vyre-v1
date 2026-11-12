// Email notices through the Space's own mail on a booted daemon (host/src/seams/notify-mail.ts bound to the notifications module's email port in daemon.ts). The mail module is real except
// mail.send and mail.domain.list, which are stand-ins (a real send needs a DNS-verified domain and a provider key; no test reaches an outside service).
//   with a mailbox    scheduling the Space's deletion emails each admin who has an address in this Space once, from the service mailbox, to their address
//   without one       nothing is sent, the reason is recorded as no_mailbox, and each admin's Console gets one line that email notices are off
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, call, hostLog, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

interface Sent { mailboxId: string; route: string; to: { address: string }[]; subject: string; text: string; idempotencyKey: string }

function stubs(sent: Sent[], verified: boolean) {
  return {
    extra: {
      handlers: {
        "mail.send": async (_ctx: unknown, input: unknown) => { sent.push(input as Sent); return { messageId: `eml_${sent.length}`, status: "queued", suppressed: [] }; },
        "mail.domain.list": async () => ({ domains: [{ id: "dom_1", name: "northwind.test", provider: "resend", spf: verified, dkim: verified, dmarc: verified, verified, isDefault: true, checkedAt: 1 }] }),
      },
    },
  };
}
let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `ne-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
/** An admin's address in this Space: an accepted invitation (the only email a Space holds for a person, space-ports.ts createMembers). usr_adam holds the seeded Space's Admin role. */
function adminAddress(d: Daemon, email: string): void {
  const db = new DatabaseSync(d.paths.modules);
  db.prepare(`INSERT INTO members_invites (id, code_hash, role, groups, agents, projects, channels, email, expires_at, created_by, state, ai_key_handle, accepted_by, accepted_at, idem_key, created_at)
    VALUES ('inv_adam', 'x', 'rol_admin', '[]', '[]', '[]', '[]', ?, 0, 'usr_olivia', 'accepted', NULL, 'usr_adam', 1, 'ne-adam', 1)`).run(email);
  db.close();
}
const why = (d: Daemon) => (): string => { const db = new DatabaseSync(d.paths.modules, { readOnly: true }); return `items ${JSON.stringify(db.prepare("SELECT person, kind, level FROM notifications_items").all())} log ${JSON.stringify(db.prepare("SELECT * FROM notifications_email_log").all())} ${hostLog(d)}`; };
const settle = async (d: Daemon): Promise<void> => { for (let i = 0; i < 4; i++) await d.hooks!.pump(); };

test("with a service mailbox and a verified domain, scheduling the Space's deletion emails the admin once, from that mailbox, to their address", { timeout: 120_000 }, async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), undefined, undefined, stubs(sent, true));
  try {
    const box = await ok(d, "mail.mailbox.create", { kind: "service", address: "notices@northwind.test", title: "Northwind", provider: "inbound_only" });
    adminAddress(d, "adam@northwind.test");
    const space = await ok(d, "spaces.get", {});
    await ok(d, "spaces.delete", { confirmName: space.space.name, withoutExport: true });
    await waitFor(async () => { await settle(d); return sent.some((m) => m.to[0]?.address === "adam@northwind.test") ? true : null; }, 20_000, why(d));
    await settle(d);
    const mine = sent.filter((m) => m.to[0]?.address === "adam@northwind.test");
    assert.equal(mine.length, 1, "once");
    assert.equal(mine[0]!.mailboxId, box.mailbox.id);
    assert.equal(mine[0]!.route, "space_domain");
    assert.match(mine[0]!.subject, new RegExp(`^${space.space.name}: Scheduled for deletion on \\d{1,2} [A-Z][a-z]+ \\d{4}$`), "the Space's name and fixed copy with the date");
    assert.match(mine[0]!.text, /^Everything in this Space is removed on .+\n\nOpen (it in the Vyre app: vyre:\/\/open\?address=[^&\s]+&kind=place&id=console\n|Vyre to see it\.$)/);
    assert.doesNotMatch(mine[0]!.text, /sk-|secret/i);
    const health = new DatabaseSync(d.paths.modules, { readOnly: true }).prepare("SELECT title FROM notifications_items WHERE kind = 'health.degraded'").all();
    assert.deepEqual(health, [], "no Console line while email notices work");
    await ok(d, "spaces.delete_cancel", {});
  } finally { await d.stop(); }
});

test("with no sending mailbox nothing is sent, the reason is recorded as no_mailbox, and each admin's Console says so once", { timeout: 120_000 }, async () => {
  const sent: Sent[] = [];
  const d = await boot(seededDir(), undefined, undefined, stubs(sent, true));
  try {
    adminAddress(d, "adam@northwind.test");
    const space = await ok(d, "spaces.get", {});
    await ok(d, "spaces.delete", { confirmName: space.space.name, withoutExport: true });
    const db = (): DatabaseSync => new DatabaseSync(d.paths.modules, { readOnly: true });
    await waitFor(async () => { await settle(d); return (db().prepare("SELECT 1 AS x FROM notifications_email_log WHERE person = 'usr_adam' AND outcome = 'no_mailbox'").all().length > 0) ? true : null; }, 20_000, why(d));
    assert.equal(sent.length, 0, "nothing sent");
    await waitFor(async () => { await settle(d); return db().prepare("SELECT 1 AS x FROM notifications_items WHERE person = 'usr_adam' AND kind = 'health.degraded'").all().length > 0 ? true : null; }, 20_000, why(d));
    const lines = db().prepare("SELECT place, title FROM notifications_items WHERE person = 'usr_adam' AND kind = 'health.degraded'").all() as Array<{ place: string; title: string }>;
    assert.deepEqual(lines.map((l) => ({ ...l })), [{ place: "console", title: "Notice email is off: this Space has no sending mailbox, so people see notices in the app only. Set one up in Console, Comms, Sending domains." }], "what the admin's Console shows, once");
    assert.equal(db().prepare("SELECT COUNT(*) AS n FROM notifications_email_log WHERE outcome = 'sent'").get()!["n"], 0, "never counted as sent");
    await ok(d, "spaces.delete_cancel", {});
  } finally { await d.stop(); }
});
