// A real SQLite database (in memory) behind the host's table guard, a ctx that validates inputs, outputs and event payloads against the generated validators,
// scripted neighbours (schema, automations, settings, chat) that record every call, a fake Kit source and a fake fixture Space.
import { readFileSync } from "node:fs";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName } from "../../../packages/contracts/src/types.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { mintId } from "../../../lib/ids.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { configureKits } from "../handlers/install.ts";
import type { FixtureSpace, KitSource } from "../handlers/install.ts";
import { handlers } from "../impl.ts";
import { strictGuard } from "../../../packages/contracts/src/contract-check.ts";
import { registry as strictRegistry } from "../../../generated/registry.ts";
import { validateInput as strictValidate } from "../../../generated/validators.ts";
const assertStrictInput = strictGuard(strictRegistry, strictValidate);

// Boundary B2 keeps the node:sqlite import out of modules; a test still needs a real SQL engine behind the host's table guard.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const migration = readFileSync(new URL("../migrations/0001_kits.sql", import.meta.url), "utf8");

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; id: string }
export interface CallLog { cap: string; input: Record<string, any> }   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service" }
type Callee = (input: any) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

export const admin: Caller = { id: "usr_admin", kind: "person" };

type Obj = Record<string, unknown>;

/** A valid Kit manifest as it sits in a Kit folder. `over` replaces top-level fields. */
export function kitManifest(over: Obj = {}): Obj {
  return {
    key: "law-intake", title: "Law firm intake", version: "1.0.0", channel: "stable", description: "Intake for a law firm.",
    items: [
      { key: "rt.matter", content: "structure", type: "record_type", title: "Matter", recordType: "matter", apply: { cap: "schema.apply", input: { changes: [{ op: "create_type", name: "matter" }] } }, undo: { cap: "schema.apply", input: { changes: [{ op: "drop_type", name: "matter" }], confirm: ["matter"] } } },
      { key: "auto.new-matter", content: "steps", type: "automation", title: "Open a matter on new lead", apply: { cap: "automations.create", input: { name: "Open a matter" } }, undo: { cap: "automations.delete", input: { name: "Open a matter" } } },
      { key: "ui.words", content: "ui", type: "words", title: "Law firm words" },
      { key: "agent.clerk", content: "tools", type: "agent", title: "Intake clerk", tools: ["records.create", "mail.send"] },
      { key: "conn.stripe", content: "tools", type: "connector", title: "Stripe", networkDomains: ["api.stripe.com"], vaultNames: ["#Stripe_Key"] },
    ],
    scripts: [{ name: "fee", source: "return { fee: input.hours * 250 };", caps: [] }],
    tests: [{ name: "matter exists after install", kind: "space", expect: { events: [{ name: "schema.applied" }], views: [{ cap: "schema.types.list", rows: 1, contains: { name: "matter" } }] } }],
    ...over,
  };
}

export class FakeSource implements KitSource {
  builtins: unknown[] = [];
  folder = new Map<string, unknown>();
  workingCopies = new Map<string, unknown>();
  async catalog(): Promise<unknown[]> { return this.builtins; }
  async read(key: string, version: string): Promise<unknown | null> { return this.folder.get(`${key}@${version}`) ?? null; }
  async working(key: string): Promise<unknown | null> { return this.workingCopies.get(key) ?? null; }
}

/** A fixture Space whose neighbours answer from a table. `schema.apply` creates types and emits schema.applied, like the real one would. */
export class FakeSpace implements FixtureSpace {
  calls: { cap: string; input: any }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  log: { name: string; payload: unknown }[] = [];
  types: string[] = [];
  closed = false;
  answers = new Map<string, (input: any) => unknown>();   // eslint-disable-line @typescript-eslint/no-explicit-any
  failOn: string | null = null;

  async call(cap: string, input: unknown): Promise<unknown> {
    assertStrictInput(cap, input);
    this.calls.push({ cap, input });
    if (this.failOn === cap) throw Object.assign(new Error(`${cap} failed`), { error: { code: "validation.bad_input", message: `${cap} failed in the fixture` } });
    const answer = this.answers.get(cap);
    if (answer) return answer(input);
    if (cap === "schema.apply") {
      const changes = (input as { changes: { op: string; name: string }[] }).changes;
      for (const c of changes) if (c.op === "create_type") this.types.push(c.name);
      this.log.push({ name: "schema.applied", payload: { count: changes.length } });
      return { applied: changes.length };
    }
    if (cap === "schema.types.list") return { types: this.types.map((name) => ({ name })) };
    if (cap === "automations.create") return { automation: { name: (input as { name: string }).name } };
    return {};
  }

  events(): { name: string; payload: unknown }[] { return this.log; }
  async close(): Promise<void> { this.closed = true; }
}

export interface HarnessOptions { now?: number; fixture?: boolean | (() => FakeSpace); builder?: string | null }

export function harness(o: HarnessOptions = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  const norm = (a: unknown): unknown => (a === undefined ? null : a);
  const raw = {
    all: (sql: string, ...args: unknown[]): unknown[] => sqlite.prepare(sql).all(...(args.map(norm) as never[])),
    run: (sql: string, ...args: unknown[]): { changes: number } => ({ changes: Number(sqlite.prepare(sql).run(...(args.map(norm) as never[])).changes) }),
  };
  const source = new FakeSource();
  const spaces: FakeSpace[] = [];
  const makeSpace = typeof o.fixture === "function" ? o.fixture : () => new FakeSpace();
  configureKits({
    source,
    ...(o.fixture === false ? {} : { fixture: async () => { const s = makeSpace(); spaces.push(s); return s; } }),
    ...(o.builder === null ? {} : { builderAgentId: o.builder ?? "agt_builder" }),
  });
  let clock = o.now ?? NOW;
  let events: Ev[] = [];
  const calls: CallLog[] = [];
  const warnings: string[] = [];
  const callees: Record<string, Callee> = {};
  const emitsOf = (cap: string): Set<string> => new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []);

  function ctxFor(cap: string | null, who: Caller = admin): Ctx {
    const allowed = cap ? emitsOf(cap) : null;
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, trace: { traceId: TRACE, spanId: "0123456789abcdef" }, origin: "user", depth: 0,
      now: () => clock,
      db: scopedDb("kits", raw, TRACE),
      emit<T>(name: EventName, subj: string, payload: T): EventEnvelope<T> {
        if (allowed && !allowed.has(name)) throw new Error(`${cap} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        events.push({ name, subject: subj, payload: payload as Record<string, unknown>, id: mintId("evt", clock) });
        return {} as EventEnvelope<T>;
      },
      async call(c, input) {
        assertStrictInput(c, input);
        calls.push({ cap: c, input: input as CallLog["input"] });
        const f = callees[c];
        if (!f) throw new Error(`unexpected call to ${c}`);
        return f(input);
      },
      authorize: () => ({ effect: "allow", reason: "granted", decisionId: "dec_1" }),
      vault: { async fill() {}, use: (handle) => ({ handle }) },
      http: async () => { throw new Error("no network in kits tests"); },
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

  // the neighbours, with the answers the real modules give
  callees["schema.apply"] = () => ({ applied: 1 });
  callees["automations.create"] = () => ({ automation: {} });
  callees["automations.delete"] = () => ({ deleted: true });
  callees["settings.kit.set_space"] = (i: { kitId: string }) => ({ kit: { kitId: i.kitId } });
  callees["settings.kit.set_mine"] = (i: { kitId: string }) => ({ kit: { kitId: i.kitId } });
  callees["chat.start"] = () => ({ thread: { threadId: "thr_builder1" } });

  return {
    sqlite, db: raw, call, ctxFor, source, spaces,
    get events(): Ev[] { return events; },
    calls, warnings,
    callee(cap: string, f: Callee): void { callees[cap] = f; },
    callsTo: (cap: string): CallLog[] => calls.filter((c) => c.cap === cap),
    advance(ms: number): void { clock += ms; },
    rows: (table: string): Record<string, unknown>[] => raw.all(`SELECT * FROM ${table}`) as Record<string, unknown>[],
    /** Lists the shipped Kit and returns its id. */
    async shipped(manifest: Obj = kitManifest()): Promise<string> {
      source.builtins = [manifest];
      const out = await call("kits.list", {});
      return out.kits.find((k: { key: string }) => k.key === manifest.key).kitId;
    },
    /** Adds a later version of the shipped Kit and syncs it. */
    async ship(manifest: Obj): Promise<void> {
      source.builtins = [manifest];
      await call("kits.list", {});
    },
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
