// Test harness for the contacts-link handlers: an in-memory database, a recording ctx, and a scripted stand-in for the capabilities this module
// calls (records.get, records.query, records.update, campaigns.get, files.read). The records stand-in keeps contact and company rows in memory
// and answers filters with the RecordStore's own matcher (kernel/src/store/query.ts), so a filter that works here works against the real store.
// Every call is checked against the frozen input schema of its capability, as the invoke pipeline would.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { matches } from "../../../kernel/src/store/query.ts";
import type { Filter } from "../../../kernel/src/store/types.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { ContactsCtx, Row } from "../projections.ts";
import { ensure } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";
import type { WriteLog } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;

export interface Rec {
  id: string;
  type: "contact" | "company";
  fields: Record<string, unknown>;
}

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: Record<string, unknown> }

export interface HarnessOptions {
  principal?: ContactsCtx["principal"];
  /** page size of records.query, to prove the handlers page through it */
  pageSize?: number;
}

export function harness(opts: HarnessOptions = {}) {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const writes: WriteLog = { statements: [] };
  const records = new Map<string, Rec>();
  const files = new Map<string, string>();
  const campaigns = new Map<string, { owner: string }>();
  const pageSize = opts.pageSize ?? 500;
  let clock = NOW;
  const db = memoryDb(writes);

  const rowOf = (r: Rec) => ({ id: r.id, type: r.type, version: 1, label: 0, fields: { ...r.fields }, createdAt: NOW, updatedAt: NOW, holds: 0 });
  const stored = (r: Rec) => ({ id: r.id, version: 1, created_at: NOW, updated_at: NOW, type: r.type, data: r.fields });

  const ctx: ContactsCtx = {
    space: "spc_contacts",
    principal: opts.principal ?? { kind: "person", id: "usr_maya01" },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db,
    emit(name, subject, payload) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown> });
      return null;
    },
    async call(cap, input) {
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      const misfit = contractErrors(cap, "in", body);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      const trace = ctx.trace.traceId;
      switch (cap) {
        case "records.get": {
          const r = records.get(String(body.recordId));
          if (!r || r.type !== body.type) throw fail("validation.not_found", trace);
          return { record: rowOf(r) };
        }
        case "records.query": {
          const all = [...records.values()].filter((r) => r.type === body.type && matches(body.filter as Filter | undefined, stored(r))).sort((a, b) => a.id.localeCompare(b.id));
          const start = typeof body.cursor === "string" ? Number(body.cursor) : 0;
          const size = Math.min(pageSize, typeof body.limit === "number" ? body.limit : pageSize);
          const out: { rows: ReturnType<typeof rowOf>[]; next?: string } = { rows: all.slice(start, start + size).map(rowOf) };
          if (start + size < all.length) out.next = String(start + size);
          return out;
        }
        case "records.update": {
          const r = records.get(String(body.recordId));
          if (!r || r.type !== body.type) throw fail("validation.not_found", trace);
          Object.assign(r.fields, body.patch as Record<string, unknown>);
          return { record: rowOf(r) };
        }
        case "campaigns.get": {
          const c = campaigns.get(String(body.campaignId));
          if (!c) throw fail("validation.not_found", trace);
          return { campaign: { campaignId: body.campaignId, name: "Spring", owner: c.owner }, steps: [] };
        }
        case "files.read": {
          const t = files.get(String(body.fileId));
          if (t === undefined) throw fail("validation.not_found", trace);
          return { text: t, mime: "text/csv", size: t.length, version: 1, truncated: false };
        }
        default: throw new Error(`unexpected capability ${cap}`);
      }
    },
    log: { info() {}, warn() {} },
  };
  ensure(ctx);

  return {
    ctx, db, emitted, called, writes, records, files, campaigns,
    advance(ms: number) { clock += ms; },
    rows(sql: string, ...args: unknown[]): Row[] { return ctx.db.all(sql, ...args) as Row[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    /** a contact record */
    contact(id: string, fields: Record<string, unknown> = {}): Rec {
      const r: Rec = { id, type: "contact", fields: { name: id, ...fields } };
      records.set(id, r);
      return r;
    },
    /** a company record */
    company(id: string, fields: Record<string, unknown> = {}): Rec {
      const r: Rec = { id, type: "company", fields: { name: id, ...fields } };
      records.set(id, r);
      return r;
    },
  };
}

export type Harness = ReturnType<typeof harness>;

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
