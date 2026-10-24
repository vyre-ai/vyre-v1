// Test support for the P-L5_01c handlers (imported by tests/extra-*.test.ts only; the host never loads it).
// It adds to the shared mail harness: scripted answers for the capabilities these handlers call (providers, Files, suppression),
// a recorded DNS zone, row seeders, and a check that every emitted event conforms to its frozen payload schema.
import { registry } from "../../../../generated/registry.ts";
import { validate } from "../../../../packages/contracts/src/jsonschema.ts";
import { fail } from "../../../../host/src/routes/errors.ts";
import { NOW } from "../../fixtures/harness.ts";
import type { Harness } from "../../fixtures/harness.ts";
import type { DnsLookup } from "./dns.ts";
import { ensureAll } from "./common.ts";

export type Script = Record<string, (input: Record<string, unknown>) => unknown>;

/** Answer the named capabilities from `answers`; every other capability falls through to the harness. Calls are recorded like the harness's own. */
export function script(h: Harness, answers: Script): void {
  const base = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => {
    const answer = answers[cap];
    if (!answer) return base(cap, input);
    h.called.push({ cap, input: input as Record<string, unknown> });
    return answer(input as Record<string, unknown>);
  };
}

export const hostError = (h: Harness, code: Parameters<typeof fail>[0]): Error => fail(code, h.ctx.trace.traceId);

/** Errors for every emitted event whose payload does not match the frozen schema of its name. Empty means all conform. */
export function eventErrors(h: Harness): string[] {
  const out: string[] = [];
  for (const e of h.emitted) {
    const def = registry.events.find((d) => d.name === e.name);
    if (!def) { out.push(`${e.name} is not in the registry`); continue; }
    for (const err of validate(def.payload, e.payload, "", registry.$defs)) out.push(`${e.name}: ${err}`);
  }
  return out;
}

/** A DNS zone as the resolver would answer it: name to values per record type. A name listed in `broken` answers with a temporary failure. */
export interface Zone { txt?: Record<string, string[]>; cname?: Record<string, string[]>; mx?: Record<string, string[]>; broken?: string[] }

export function zone(z: Zone): DnsLookup {
  const answer = (table: Record<string, string[]> | undefined, name: string): string[] => {
    if (z.broken?.includes(name)) throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
    const hit = table?.[name];
    if (!hit) throw Object.assign(new Error("no record"), { code: "ENODATA" });
    return hit;
  };
  return {
    async txt(name) { return answer(z.txt, name); },
    async cname(name) { return answer(z.cname, name); },
    async mx(name) { return answer(z.mx, name); },
  };
}

export interface SentOpts {
  id: string;
  mailboxId: string;
  providerId: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  status?: string;
  from?: string;
}

/** A message that left the Space, as mail.send will store it: direction out, a provider id, a status on the ladder. */
export function seedSent(h: Harness, o: SentOpts): void {
  ensureAll(h.ctx);
  const party = (list: string[]): string => JSON.stringify(list.map((address) => ({ address })));
  h.ctx.db.run(
    `INSERT INTO mail_message (
      id, "mailboxId", "inboxIds", "providerId", "rfcMessageId", "threadId", direction, status,
      "fromAddress", "toAddresses", "ccAddresses", subject, snippet, body, "sentAt", "contactId",
      "isPrivate", "campaignId", attachments, "draftedByAgent", "traceId", version, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    o.id, o.mailboxId, JSON.stringify([o.mailboxId]), o.providerId, `<${o.id}@vyre.test>`, o.id, "out", o.status ?? "sent",
    o.from ?? "hello@vyre.test", party(o.to ?? ["pat@acme.test"]), party(o.cc ?? []), "Hello", "Hello", "Hello", NOW, null,
    0, null, "[]", null, h.ctx.trace.traceId, 1, NOW, null,
  );
  h.ctx.db.run(
    `INSERT INTO mail_body ("messageId", text, html, "fromName", bcc, headers) VALUES (?, ?, ?, ?, ?, ?)`,
    o.id, "Hello", null, null, party(o.bcc ?? []), null,
  );
}

export interface DomainOpts {
  id: string;
  name: string;
  provider?: "resend" | "mailgun";
  ref?: string;
  verified?: boolean;
  isDefault?: boolean;
  spf?: string;
  dkim?: string;
  dmarc?: string;
  records?: unknown[];
}

export function seedDomain(h: Harness, o: DomainOpts): void {
  ensureAll(h.ctx);
  h.ctx.db.run(
    `INSERT INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", records, "checkedAt", version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    o.id, o.name, o.provider ?? "resend", o.spf ?? "pending", o.dkim ?? "pending", o.dmarc ?? "pending", o.verified ? 1 : 0, o.isDefault ? 1 : 0,
    JSON.stringify({ ref: o.ref ?? "pdm_1", providerVerified: o.verified === true, records: o.records ?? [] }), null, 1, NOW, null,
  );
}
