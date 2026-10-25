// A real SQLite database (in memory) behind the host's table guard, a ctx that validates inputs, outputs and event payloads against the generated validators, and scripted
// neighbours (the kits module, schema, automations) that record every call. The kits neighbour keeps a small catalogue like the real one: list, install sheet, preview, install.
import { readFileSync } from "node:fs";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName } from "../../../packages/contracts/src/types.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { mintId } from "../../../lib/ids.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { handlers } from "../impl.ts";

// Boundary B2 keeps the node:sqlite import out of modules; a test still needs a real SQL engine behind the host's table guard.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const migration = readFileSync(new URL("../migrations/0001_templates.sql", import.meta.url), "utf8");

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; id: string }
export interface CallLog { cap: string; input: Record<string, any> }   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service" }
type Callee = (input: any) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

export const admin: Caller = { id: "usr_admin", kind: "person" };

/** One Kit as the kits module knows it: its item list decides what kits.preview says it adds. */
export interface FakeKit {
  kitId: string;
  key: string;
  title: string;
  version: string;
  installed: boolean;
  items: { type: string; title: string; recordType?: string; tools?: string[]; networkDomains?: string[]; vaultNames?: string[] }[];
}

export function kit(key: string, title: string, items: FakeKit["items"], over: Partial<FakeKit> = {}): FakeKit {
  return { kitId: `kit_${key.replaceAll("-", "")}`, key, title, version: "1.0.0", installed: false, items, ...over };
}

export interface HarnessOptions { now?: number }

export function harness(o: HarnessOptions = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  const norm = (a: unknown): unknown => (a === undefined ? null : a);
  const raw = {
    all: (sql: string, ...args: unknown[]): unknown[] => sqlite.prepare(sql).all(...(args.map(norm) as never[])),
    run: (sql: string, ...args: unknown[]): { changes: number } => ({ changes: Number(sqlite.prepare(sql).run(...(args.map(norm) as never[])).changes) }),
  };
  let clock = o.now ?? NOW;
  let events: Ev[] = [];
  const calls: CallLog[] = [];
  const warnings: string[] = [];
  const callees: Record<string, Callee> = {};
  const kits: FakeKit[] = [];
  const emitsOf = (cap: string): Set<string> => new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []);

  function ctxFor(cap: string | null, who: Caller = admin): Ctx {
    const allowed = cap ? emitsOf(cap) : null;
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, trace: { traceId: TRACE, spanId: "0123456789abcdef" }, origin: "user", depth: 0,
      now: () => clock,
      db: scopedDb("templates", raw, TRACE),
      emit<T>(name: EventName, subj: string, payload: T): EventEnvelope<T> {
        if (allowed && !allowed.has(name)) throw new Error(`${cap} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        events.push({ name, subject: subj, payload: payload as Record<string, unknown>, id: mintId("evt", clock) });
        return {} as EventEnvelope<T>;
      },
      async call(c, input) {
        calls.push({ cap: c, input: input as CallLog["input"] });
        const f = callees[c];
        if (!f) throw new Error(`unexpected call to ${c}`);
        return f(input);
      },
      authorize: () => ({ effect: "allow", reason: "granted", decisionId: "dec_1" }),
      vault: { async fill() {}, use: (handle) => ({ handle }) },
      http: async () => { throw new Error("no network in templates tests"); },
      log: { debug() {}, info() {}, warn: (msg: string) => { warnings.push(msg); }, error() {} },
      schedule: async () => "sch_1",
      seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "b" }), unseal: () => new Uint8Array() },
    };
  }

  /** Calls a handler like the pipeline does: input and output are validated unless `check` is false. */
  async function call(cap: string, input: unknown, who: Caller = admin, check = true): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const bad = check ? validateInput(cap, 1, input) : [];
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const h = (handlers as Record<string, (ctx: Ctx, input: unknown) => Promise<unknown>>)[cap];
    if (!h) throw new Error(`no handler for ${cap}`);
    events = [];
    const result = await h(ctxFor(cap, who), input);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    return result;
  }

  const byId = (kitId: string): FakeKit => {
    const k = kits.find((x) => x.kitId === kitId);
    if (!k) throw Object.assign(new Error("no such Kit"), { error: { code: "validation.not_found", message: "That Kit does not exist." } });
    return k;
  };

  // the kits module, with the answers the real one gives
  callees["kits.list"] = (i: { cursor?: string; limit?: number }) => {
    const offset = i.cursor ? Number(i.cursor) : 0, limit = i.limit ?? 100;
    const rows = [...kits].sort((a, b) => a.title.localeCompare(b.title));
    const out: Record<string, unknown> = {
      kits: rows.slice(offset, offset + limit).map((k) => ({ kitId: k.kitId, key: k.key, title: k.title, version: k.version, channel: "stable", installed: k.installed, contents: ["structure"] })),
      total: rows.length,
    };
    if (offset + limit < rows.length) out.next = String(offset + limit);
    return out;
  };
  callees["kits.install_sheet"] = (i: { kitId: string }) => {
    const k = byId(i.kitId);
    const uniq = (xs: string[]): string[] => [...new Set(xs)].sort();
    return { sheet: {
      tools: uniq(k.items.flatMap((x) => x.tools ?? [])), recordTypes: uniq(k.items.filter((x) => x.type === "record_type").map((x) => x.recordType ?? x.title)),
      networkDomains: uniq(k.items.flatMap((x) => x.networkDomains ?? [])), vaultNames: uniq(k.items.flatMap((x) => x.vaultNames ?? [])), scripts: 0,
    } };
  };
  callees["kits.preview"] = (i: { kitId: string }) => {
    const k = byId(i.kitId);
    return { changes: k.installed ? [] : k.items.map((x) => ({ kind: x.type, title: `Add ${x.title}` })) };
  };
  callees["kits.install"] = (i: { kitId: string; accepted: boolean }) => {
    const k = byId(i.kitId);
    if (k.installed) throw Object.assign(new Error("installed"), { error: { code: "validation.precondition_failed", message: `${k.title} is already installed.` } });
    k.installed = true;
    return { kit: { kitId: k.kitId, key: k.key, title: k.title, version: k.version, channel: "stable", installed: true, contents: ["structure"] } };
  };
  // neighbours a saved template reads and applies through
  callees["schema.apply"] = () => ({ applied: 1 });
  callees["automations.create"] = () => ({ automation: { id: "aut_new1" } });

  return {
    sqlite, db: raw, call, ctxFor, kits,
    get events(): Ev[] { return events; },
    calls, warnings,
    callee(cap: string, f: Callee): void { callees[cap] = f; },
    callsTo: (cap: string): CallLog[] => calls.filter((c) => c.cap === cap),
    advance(ms: number): void { clock += ms; },
    rows: (table: string): Record<string, unknown>[] => raw.all(`SELECT * FROM ${table}`) as Record<string, unknown>[],
  };
}
export type Harness = ReturnType<typeof harness>;

export function codeOf(e: unknown): string | undefined { return (e as { error?: { code?: string } } | null)?.error?.code; }

export async function refused(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (codeOf(e) === code) return;
    throw e;
  }
  throw new Error(`expected ${code}, the call succeeded`);
}
