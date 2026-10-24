// The rig the send tests share: the mail harness plus scripted stand-ins for every capability the single send API calls
// (settings.get, the suppression list and contact preferences, Resend, Mailgun, Gmail, Graph, Files). Nothing leaves the process.
// Also holds the one test of the rig itself. The test files send.test.ts, send.window.test.ts and send.gate.test.ts import from here.
import test from "node:test";
import assert from "node:assert/strict";
import { fail } from "../../../host/src/routes/errors.ts";
import { harness, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness, HarnessOptions } from "../fixtures/harness.ts";
import type { SendCtx, SendIn } from "../handlers/send.ts";

export { NOW };

export interface RigOptions extends HarnessOptions {
  /** setting key to value; a key that is absent answers not found, so the manifest default stands */
  settings?: Record<string, unknown>;
  /** address to the reason the suppression list gives */
  suppressed?: Record<string, string>;
  /** contact id to its Contact preferences */
  prefs?: Record<string, Record<string, unknown>>;
  origin?: string;
  /** permission keys the caller lacks */
  deniedPerms?: string[];
  /** leave the Space without a verified sending domain */
  noDomain?: boolean;
}

export interface Seen { cap: string; input: Record<string, unknown> }
export interface Scheduled { at: number; cap: string; input: Record<string, unknown> }

export function seedDomain(h: Harness, name: string, provider: "resend" | "mailgun", o: { verified?: boolean; isDefault?: boolean } = {}): void {
  h.ctx.db.run(
    `INSERT INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", records, "checkedAt", version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `dom_${name.replace(/[^a-z0-9]/g, "")}`, name, provider, "pass", "pass", "pass", o.verified === false ? 0 : 1, o.isDefault ? 1 : 0, "[]", NOW, 1, NOW, null,
  );
}

/** A mailbox row with a connection, as mail.connect leaves it. */
function connected(h: Harness, id: string, address: string, provider: "google" | "microsoft" | "imap", connectionId: string): void {
  seedMailbox(h, id, address, { kind: "personal", provider, ownerId: "usr_maya01" });
  h.ctx.db.run(`UPDATE mail_mailbox SET "connectionId" = ?, state = ? WHERE id = ?`, connectionId, "syncing", id);
}

export function rig(o: RigOptions = {}) {
  const h = harness(o);
  const ctx: SendCtx = h.ctx;
  const seen: Seen[] = [];
  const scheduled: Scheduled[] = [];
  const settings: Record<string, unknown> = { ...o.settings };
  const suppressed: Record<string, string> = { ...o.suppressed };
  const prefs: Record<string, Record<string, unknown>> = { ...o.prefs };
  const lacking = new Set(o.deniedPerms ?? []);
  const state: { failNext: "provider.rate_limited" | "provider.auth_failed" | null; n: number } = { failNext: null, n: 0 };

  connected(h, "mbx_maya", "maya@vyre.test", "google", "con_g1");
  connected(h, "mbx_sam", "sam@vyre.test", "microsoft", "con_m1");
  connected(h, "mbx_pat", "pat@vyre.test", "imap", "con_i1");
  seedMailbox(h, "mbx_hello", "hello@vyre.test", { kind: "shared", provider: "inbound_only" });
  if (!o.noDomain) {
    seedDomain(h, "vyre.test", "resend", { isDefault: true });
    seedDomain(h, "mail.other.test", "mailgun");
    seedDomain(h, "pending.test", "resend", { verified: false });
  }

  if (o.origin) ctx.origin = o.origin;
  ctx.schedule = async (at, cap, input) => {
    scheduled.push({ at, cap, input: input as Record<string, unknown> });
    return `sch_${scheduled.length}`;
  };
  const base = ctx.authorize.bind(ctx);
  ctx.authorize = (action, resource) => {
    if (action.perm && lacking.has(action.perm)) return { effect: "deny", reason: "role_lacks_permission", decisionId: "dec_mailtest01" };
    return base(action, resource);
  };
  ctx.call = async (cap, input) => {
    const body = input as Record<string, unknown>;
    seen.push({ cap, input: body });
    const trace = ctx.trace.traceId;
    switch (cap) {
      case "settings.get": {
        const key = String(body.key);
        if (key in settings) return { row: { key, value: settings[key] } };
        throw fail("validation.not_found", trace);
      }
      case "contacts.suppression.check": {
        const hits = (body.addresses as string[]).filter((a) => a in suppressed).map((address) => ({ address, reason: suppressed[address] }));
        return { suppressed: hits };
      }
      case "contacts.preferences.get": {
        const found = prefs[String(body.contactId)];
        if (!found) throw fail("validation.not_found", trace);
        return found;
      }
      case "resend.send_email":
      case "mailgun.send_email": {
        if (state.failNext) {
          const code = state.failNext;
          state.failNext = null;
          throw fail(code, trace);
        }
        return { providerId: `${cap.split(".")[0]}_${++state.n}` };
      }
      case "google.gmail.send_message": return { id: `gm_${++state.n}`, threadId: "thr_g" };
      case "ms.mail.send_message": return { sent: true };
      case "files.get": return { file: { name: `${String(body.fileId)}.pdf` } };
      default: throw new Error(`unexpected capability ${cap}`);
    }
  };

  return {
    h, ctx, seen, scheduled, settings, suppressed, prefs, state,
    calls: (cap: string): Seen[] => seen.filter((s) => s.cap === cap),
    /** move the clock to an absolute instant */
    goto(ms: number): void { h.advance(ms - ctx.now()); },
    sent: (): Seen[] => seen.filter((s) => ["resend.send_email", "mailgun.send_email", "google.gmail.send_message", "ms.mail.send_message"].includes(s.cap)),
  };
}

export type Rig = ReturnType<typeof rig>;

let keys = 0;
/** A Space send from the shared inbox, which has no member mailbox and so goes out through the Space domain. */
export function sendIn(over: Partial<SendIn> = {}): SendIn {
  return { mailboxId: "mbx_hello", to: [{ address: "pat@acme.test" }], subject: "Hello", text: "Hi Pat", idempotencyKey: `idem-${++keys}`, ...over };
}

export const row = (r: Rig, id: string) => r.h.rows(`SELECT * FROM mail_message WHERE id = ?`, id)[0];

test("the rig starts with one verified default Resend domain, a mailbox per provider and no settings", () => {
  const r = rig();
  assert.deepEqual(r.h.rows(`SELECT name FROM mail_domain WHERE verified = ?`, 1).map((d) => d.name).sort(), ["mail.other.test", "vyre.test"]);
  assert.deepEqual(r.h.rows(`SELECT provider FROM mail_mailbox`).map((m) => m.provider).sort(), ["google", "imap", "inbound_only", "microsoft"]);
  assert.equal(Object.keys(r.settings).length, 0);
  assert.equal(r.ctx.now(), NOW);
});
