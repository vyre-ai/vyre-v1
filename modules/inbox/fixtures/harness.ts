// Test harness for the inbox handlers: an in-memory database, a recording ctx, and scripted stand-ins for the capabilities this module calls (contacts.resolve,
// contacts.route_owner, contacts.address.*, records.get/create/search, tasks.create, follows.toggle, mail.message.get, mail.mailbox.list, telephony.number.list,
// meetings.list, access.groups.list). Every call is checked against the frozen input schema of its capability, as the invoke pipeline would, and the stand-ins
// answer in the frozen output shape. Access is open unless a test denies a resource.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { InboxCtx } from "../projections.ts";
import { ensure } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const HOUR = 3_600_000;

export interface Contact {
  id: string;
  type: "contact" | "company";
  name: string;
  emails: string[];
  phones: string[];
  /** unsure matches: a sender on this domain is offered, never filed */
  domain?: string;
  owner?: string;
  /** the company record this contact belongs to */
  company?: string;
  /** Do not contact is set */
  dnd?: boolean;
  deliverability?: "good" | "risky" | "bounced" | "complained";
  /** a draft reply waits for this contact */
  draft?: boolean;
}
export interface Emitted { name: string; subject: string; payload: Record<string, unknown>; vis?: string | undefined }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Mailbox { id: string; kind: "personal" | "shared" | "agent" | "service"; address: string; title: string; provider: "google" | "microsoft" | "imap" | "inbound_only"; privacy: "private" | "space" | "people"; state: "pending" | "syncing" | "paused" | "error" | "disconnected" }
export interface Mail { id: string; threadId: string; subject: string; from: string; to: string[]; cc?: string[] }

export interface HarnessOptions {
  principal?: InboxCtx["principal"];
  contacts?: Contact[];
  mailboxes?: Mailbox[];
  numbers?: { id: string; e164: string; state: "pending" | "active" | "released"; capabilities: ("voice" | "sms" | "mms")[] }[];
  mail?: Mail[];
}

export function harness(opts: HarnessOptions = {}) {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const contacts = new Map<string, Contact>((opts.contacts ?? []).map((c) => [c.id, { ...c, emails: [...c.emails], phones: [...c.phones] }]));
  const campaigns = new Map<string, string>();   // campaign id -> owner
  const mailboxOwners = new Map<string, string>();
  const mail = new Map<string, Mail>((opts.mail ?? []).map((m) => [m.id, m]));
  const added = new Map<string, { contactId: string; value: string }>();
  const denied = new Set<string>();
  const meetings: Record<string, unknown>[] = [];
  const groups: { id: string; name: string }[] = [];
  let mailboxes: Mailbox[] = opts.mailboxes ?? [];
  let numbers = opts.numbers ?? [];
  let clock = NOW;
  let serial = 0;
  let taskFails = false;
  let mailGetFails = false;
  let meetingsFail = false;

  const record = (c: Contact) => ({
    id: c.id, type: c.type, version: 1, label: 0, fields: { name: c.name, ...(c.emails[0] ? { email: c.emails[0] } : {}), ...(c.phones[0] ? { phone: c.phones[0] } : {}),
      ...(c.company ? { company: c.company } : {}), ...(c.dnd ? { pref_do_not_contact: true } : {}), ...(c.deliverability ? { deliverability: c.deliverability } : {}) },
    createdAt: NOW, updatedAt: NOW, holds: 0,
  });
  const candidate = (c: Contact, via: "address" | "phone" | "name", score: number) => ({ recordId: c.id, type: c.type, name: c.name, via, score });

  const ctx: InboxCtx = {
    space: "spc_inbox",
    principal: opts.principal ?? { kind: "person", id: "usr_maya01" },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload, o) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown>, vis: o?.vis });
      return null;
    },
    authorize(_action, resource) {
      const effect = denied.has(`${resource.type}:${resource.id}`) ? "deny" : "allow";
      return { effect, reason: effect, decisionId: "dec_test" };
    },
    async call(cap, input) {
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      const misfit = contractErrors(cap, "in", body);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      const trace = ctx.trace.traceId;
      switch (cap) {
        case "contacts.resolve": {
          const email = typeof body.email === "string" ? body.email : undefined;
          const phone = typeof body.phone === "string" ? body.phone : undefined;
          const sure = [...contacts.values()].filter((c) => (email && c.emails.includes(email)) || (phone && c.phones.includes(phone))).map((c) => candidate(c, email ? "address" : "phone", 1));
          const domain = email?.split("@")[1];
          const unsure = [...contacts.values()]
            .filter((c) => !sure.some((s) => s.recordId === c.id) && ((domain && c.domain === domain) || (typeof body.name === "string" && c.name.toLowerCase() === body.name.toLowerCase())))
            .map((c) => candidate(c, domain && c.domain === domain ? "address" : "name", 0.5));
          return { sure, unsure };
        }
        case "contacts.route_owner": {
          const c = typeof body.contactId === "string" ? contacts.get(body.contactId) : undefined;
          if (c?.owner) return { ownerId: c.owner, via: "owner" };
          const campaignOwner = typeof body.campaignId === "string" ? campaigns.get(body.campaignId) : undefined;
          if (campaignOwner) return { ownerId: campaignOwner, via: "campaign_owner" };
          const boxOwner = typeof body.mailboxId === "string" ? mailboxOwners.get(body.mailboxId) : undefined;
          return boxOwner ? { ownerId: boxOwner, via: "shared_inbox", mailboxId: body.mailboxId } : { via: "shared_inbox" };
        }
        case "contacts.address.add": {
          const c = contacts.get(String(body.contactId));
          if (!c) throw fail("validation.not_found", trace);
          const v = String(body.value);
          if (c.emails.includes(v) || c.phones.includes(v)) throw fail("validation.duplicate", trace);
          const id = `adr_${++serial}`;
          if (body.kind === "email") c.emails.push(v);
          else if (body.kind === "phone") c.phones.push(v);
          added.set(id, { contactId: c.id, value: v });
          return { address: { id, contactId: c.id, kind: body.kind, value: v, primary: false, verified: false } };
        }
        case "contacts.address.remove": {
          const a = added.get(String(body.addressId));
          const c = a ? contacts.get(a.contactId) : undefined;
          if (!a || !c) throw fail("validation.not_found", trace);
          c.emails = c.emails.filter((e) => e !== a.value);
          c.phones = c.phones.filter((e) => e !== a.value);
          added.delete(String(body.addressId));
          return { removed: true };
        }
        case "contacts.address.list": {
          const c = contacts.get(String(body.contactId));
          return { addresses: [...(c?.emails ?? []).map((v) => ({ kind: "email", value: v })), ...(c?.phones ?? []).map((v) => ({ kind: "phone", value: v }))].map((a, i) => ({ id: `adr_x${i}`, contactId: c?.id, primary: i === 0, verified: true, ...a })) };
        }
        case "records.get": {
          const c = contacts.get(String(body.recordId));
          if (!c || c.type !== body.type) throw fail("validation.not_found", trace);
          return { record: record(c) };
        }
        case "records.create": {
          const f = (body.fields ?? {}) as Record<string, unknown>;
          const c: Contact = { id: `rec_new${++serial}`, type: body.type === "company" ? "company" : "contact", name: String(f.name), emails: typeof f.email === "string" ? [f.email] : [], phones: typeof f.phone === "string" ? [f.phone] : [] };
          contacts.set(c.id, c);
          return { record: record(c) };
        }
        case "records.search": {
          const q = String(body.q).toLowerCase();
          return { rows: [...contacts.values()].filter((c) => c.type === body.type && c.name.toLowerCase().includes(q)).map(record) };
        }
        case "tasks.create": {
          if (taskFails) throw fail("internal.unavailable", trace);
          return { task: { id: `tsk_${++serial}`, kind: "work", title: body.title, state: "todo", blocked: false, blocks: [], actions: [], assigned: body.assigned, fileIds: [], dependsOn: [], followers: [], workingNotes: {}, reviewLoops: 0, createdBy: ctx.principal.id, createdAt: NOW, updatedAt: NOW } };
        }
        case "follows.toggle": return { following: body.on === true };
        case "mail.message.get": {
          const m = mail.get(String(body.messageId));
          if (!m || mailGetFails) throw fail("validation.not_found", trace);
          return { message: { id: m.id, threadId: m.threadId, subject: m.subject, from: { address: m.from }, to: m.to.map((address) => ({ address })), cc: (m.cc ?? []).map((address) => ({ address })) }, attachments: [] };
        }
        case "mail.drafts.list": {
          const c = typeof body.contactId === "string" ? contacts.get(body.contactId) : undefined;
          return { drafts: c?.draft ? [{ id: "eml_draft1", status: "draft" }] : [] };
        }
        case "mail.mailbox.list": return { mailboxes };
        case "telephony.number.list": return { numbers };
        case "meetings.list": {
          if (meetingsFail) throw fail("internal.unavailable", trace);
          return { meetings };
        }
        case "access.groups.list": return { groups: groups.filter((g) => g.name.toLowerCase().includes(String(body.q ?? "").toLowerCase())).map((g) => ({ ...g, members: [], managers: [], builtIn: false })) };
        default: throw new Error(`unexpected capability ${cap}`);
      }
    },
    log: { info() {}, warn() {} },
  };
  ensure(ctx);

  return {
    ctx, emitted, called, contacts, campaigns, mailboxOwners, mail, denied, meetings, groups,
    advance(ms: number) { clock += ms; },
    setMailboxes(m: Mailbox[]) { mailboxes = m; },
    setNumbers(n: NonNullable<HarnessOptions["numbers"]>) { numbers = n; },
    failTasks(on: boolean) { taskFails = on; },
    failMailGet(on: boolean) { mailGetFails = on; },
    failMeetings(on: boolean) { meetingsFail = on; },
    as(principal: InboxCtx["principal"]): InboxCtx { return Object.assign(Object.create(ctx) as InboxCtx, { principal }); },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
  };
}

export type Harness = ReturnType<typeof harness>;

export const LEE: Contact = { id: "rec_lee01", type: "contact", name: "Pat Lee", emails: ["pat@acme.test"], phones: ["+14155550177"], domain: "acme.test", owner: "usr_maya01" };
export const DANA: Contact = { id: "rec_dana1", type: "contact", name: "Dana Fox", emails: ["dana@fox.test"], phones: [], domain: "fox.test" };

export interface Link {
  channel?: "email" | "sms" | "call";
  address: string;
  direction?: "in" | "out";
  at?: number;
  id?: string;
  mailboxId?: string;
  numberId?: string;
  campaignId?: string;
  preview?: string;
}
let seq = 0;
/** The input of one inbox.link_message call, with the reference kind that goes with the channel. */
export function link(o: Link) {
  const channel = o.channel ?? "email";
  const n = ++seq;
  const prefix = channel === "email" ? "eml" : channel === "sms" ? "sms" : "cal";
  return {
    channel, ref: { kind: channel === "email" ? ("mail_message" as const) : channel, id: o.id ?? `${prefix}_t${n}` }, address: o.address, direction: o.direction ?? ("in" as const), at: o.at ?? NOW + n * 1000,
    ...(o.mailboxId ? { mailboxId: o.mailboxId } : {}), ...(o.numberId ? { numberId: o.numberId } : {}), ...(o.campaignId ? { campaignId: o.campaignId } : {}), ...(o.preview !== undefined ? { preview: o.preview } : {}),
  };
}

/** Errors of a value against the frozen contract of a capability (its input or output schema); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

/** The error code of a thrown HostError, or "" for anything else. */
export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}
