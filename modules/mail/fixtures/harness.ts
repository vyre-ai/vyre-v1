// Test harness for the mail handlers: an in-memory database, a recording ctx, and a scripted stand-in for the capabilities mail calls
// (inbox.link_message, the connectors). The stand-in link step follows the rule in spec 2.18: one sure candidate links, several or a weak
// one are unsure and raise a Needs you task, none stays unmatched. The real step belongs to the inbox module (P-L5_08).
import { registry } from "../../../generated/registry.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { ingest } from "../handlers/ingest.ts";
import type { IngestIn } from "../handlers/ingest.ts";
import { memoryDb } from "./memory-db.ts";
import { ensure } from "../projections.ts";
import type { MailCtx, Party, Row } from "../projections.ts";

export const NOW = 1_760_000_000_000;

export interface Candidate { recordId: string; score: number }
export interface Emitted { name: string; subject: string; payload: Record<string, unknown>; vis?: string }
export interface Called { cap: string; input: Record<string, unknown> }

export interface HarnessOptions {
  principal?: MailCtx["principal"];
  /** address to the contact records the link step finds */
  contacts?: Record<string, Candidate[]>;
  /** the link step throws */
  linkFails?: boolean;
  /** mailbox ids the caller may not read or use */
  denied?: Set<string>;
  run?: string;
}

export function harness(opts: HarnessOptions = {}) {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const denied = opts.denied ?? new Set<string>();
  let clock = NOW;
  let linkFails = opts.linkFails === true;
  let tasks = 0;
  const contacts = opts.contacts ?? {};
  const ctx: MailCtx = {
    space: "spc_mailtest",
    principal: opts.principal ?? { kind: "person", id: "usr_maya01" },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    ...(opts.run ? { run: opts.run } : {}),
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload, o) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown>, ...(o?.vis ? { vis: o.vis } : {}) });
      return null;
    },
    async call(cap, input) {
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      if (cap === "mail.ingest") return ingest(ctx, input as IngestIn);
      if (cap === "inbox.link_message") {
        if (linkFails) throw new Error("inbox is down");
        const address = String(body.address);
        const found = contacts[address] ?? [];
        const sure = found.filter((c) => c.score >= 0.8);
        const conversationId = `cnv_${address.replace(/[^a-z0-9]/g, "")}`;
        if (found.length === 1 && sure.length === 1) return { conversationId, contactId: sure[0]!.recordId, linked: "sure" };
        if (found.length > 0) return { conversationId, linked: "unsure", taskId: `tsk_needsmatch${++tasks}` };
        return { conversationId, linked: "none" };
      }
      if (cap === "google.receive_push" || cap === "ms.receive_notification") return { accepted: true };
      throw new Error(`unexpected capability ${cap}`);
    },
    authorize(_action, resource) {
      if (resource.id && denied.has(resource.id)) return { effect: "deny", reason: "no_grant", decisionId: "dec_mailtest01" };
      return { effect: "allow", reason: "ok", decisionId: "dec_mailtest01" };
    },
    vault: {
      use(handle) {
        if (!handle.startsWith("#")) throw new Error("bad handle");
        return { handle };
      },
    },
    log: { info() {}, warn() {} },
  };
  return {
    ctx, emitted, called, denied,
    advance(ms: number) { clock += ms; },
    failLinks(on: boolean) { linkFails = on; },
    rows(sql: string, ...args: unknown[]): Row[] { return ctx.db.all(sql, ...args) as Row[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
  };
}

export type Harness = ReturnType<typeof harness>;

/** A mailbox row without going through mail.connect: shared, agent and service mailboxes are created by a later packet. */
export function seedMailbox(h: Harness, id: string, address: string, o: { kind?: string; provider?: string; privacy?: string; ownerId?: string | null } = {}): void {
  ensure(h.ctx);
  h.ctx.db.run(
    `INSERT INTO mail_mailbox (id, kind, address, title, "ownerId", "agentId", provider, privacy, state, "connectionId", "lastSyncAt", paused, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, o.kind ?? "shared", address, address, o.ownerId ?? null, null, o.provider ?? "inbound_only", o.privacy ?? "space", "pending", null, null, 0, 1, NOW, null,
  );
}

export function letter(from: string, rfcMessageId: string, providerId: string, extra: Partial<IngestIn> = {}): IngestIn {
  const sender: Party = { address: from };
  return {
    source: "google", providerId, rfcMessageId, from: sender, to: [{ address: "maya@vyre.test" }], subject: "Hello", text: "Hello there",
    receivedAt: NOW, ...extra,
  };
}

export const IMAP = { host: "replay.example", port: 993, secure: true, username: "sam@vyre.test", passwordHandle: "#Imap.Sam" };

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
