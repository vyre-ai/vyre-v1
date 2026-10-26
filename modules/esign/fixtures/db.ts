// A real SQLite database (in memory) behind the same table guard the host uses for ctx.db, a ctx that validates what the invoke pipeline validates
// (inputs, outputs, event payloads against the generated validators; a capability may emit only the events it declares), scripted neighbours
// (files, tasks, chat) that record every call, and a fake EsignProvider.
import { readFileSync } from "node:fs";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName } from "../../../packages/contracts/src/types.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { mintId } from "../../../lib/ids.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { ProviderPayloadError, configureEsign, fromBase64, toBase64 } from "../handlers/send.ts";
import type { EnvelopeRequest, EnvelopeStatus, EsignProvider, ProviderKey, ProviderStatus, SignedFiles, WebhookEvent } from "../handlers/send.ts";
import { handlers } from "../impl.ts";
import { strictGuard } from "../../../packages/contracts/src/contract-check.ts";
import { registry as strictRegistry } from "../../../generated/registry.ts";
import { validateInput as strictValidate } from "../../../generated/validators.ts";
const assertStrictInput = strictGuard(strictRegistry, strictValidate);

// Boundary B2 keeps the node:sqlite import out of modules; a test still needs a real SQL engine behind the host's table guard.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const migration = readFileSync(new URL("../migrations/0001_esign.sql", import.meta.url), "utf8");

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const FILE = "fil_contract1";
export const FOLDER = "fld_matter1";
export const RECORD = "rec_dana";
export const PDF = new TextEncoder().encode("%PDF-1.7 unsigned retainer");
export const SIGNED_PDF = new TextEncoder().encode("%PDF-1.7 signed retainer");
export const CERT_PDF = new TextEncoder().encode("%PDF-1.7 certificate");

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; id: string }
export interface CallLog { cap: string; input: Record<string, any> }   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; run?: string; thread?: string; actingFor?: string }
type Callee = (input: any) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

export const dana: Caller = { id: "usr_dana", kind: "person" };

/** A provider whose answers a test scripts. Every call is recorded. */
export class FakeProvider implements EsignProvider {
  created: EnvelopeRequest[] = [];
  cancelled: string[] = [];
  statusCalls: string[] = [];
  fetched: string[] = [];
  nextRef = 1;
  failCreate: string | null = null;
  failStatus: string | null = null;
  failCancel: string | null = null;
  failFetch: string | null = null;
  state: ProviderStatus = { state: "sent", signers: [] };
  files: SignedFiles = { pdf: SIGNED_PDF };
  healthy: { ok: boolean; detail?: string } | Error = { ok: true };
  /** webhook payloads are `{ ref, kind, recipients, id, reason? }` in tests, read back as they are */
  malformed = false;

  async create(req: EnvelopeRequest): Promise<{ ref: string }> {
    if (this.failCreate) throw new Error(this.failCreate);
    this.created.push(req);
    const ref = `doc_${this.nextRef++}`;
    this.state = { state: "sent", signers: req.signers.map((s) => ({ name: s.name, email: s.email, status: "sent" as EnvelopeStatus })) };
    return { ref };
  }

  async status(ref: string): Promise<ProviderStatus> {
    this.statusCalls.push(ref);
    if (this.failStatus) throw new Error(this.failStatus);
    return this.state;
  }

  async cancel(ref: string): Promise<void> {
    if (this.failCancel) throw new Error(this.failCancel);
    this.cancelled.push(ref);
  }

  async fetchSigned(ref: string): Promise<SignedFiles> {
    this.fetched.push(ref);
    if (this.failFetch) throw new Error(this.failFetch);
    return this.files;
  }

  webhook(payload: unknown): WebhookEvent | null {
    const p = payload as Partial<WebhookEvent> & { ignore?: boolean };
    if (this.malformed || typeof p !== "object" || p === null || typeof p.ref !== "string") throw new ProviderPayloadError("That is not a fake webhook.");
    return p.ignore ? null : (p as WebhookEvent);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    if (this.healthy instanceof Error) throw this.healthy;
    return this.healthy;
  }

  /** the provider's own state after every signer signed */
  allSigned(): void {
    this.state = { state: "signed", signers: this.state.signers.map((s) => ({ ...s, status: "signed" as EnvelopeStatus })) };
  }
}

export interface HarnessOptions { now?: number; providers?: Partial<Record<ProviderKey, EsignProvider>> | null }

export function harness(o: HarnessOptions = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  const norm = (a: unknown): unknown => (a === undefined ? null : a);
  const raw = {
    all: (sql: string, ...args: unknown[]): unknown[] => sqlite.prepare(sql).all(...(args.map(norm) as never[])),
    run: (sql: string, ...args: unknown[]): { changes: number } => ({ changes: Number(sqlite.prepare(sql).run(...(args.map(norm) as never[])).changes) }),
  };
  const provider = new FakeProvider();
  configureEsign(o.providers === null ? null : { providers: o.providers ?? { documenso: provider } });
  let clock = o.now ?? NOW;
  let events: Ev[] = [];
  const calls: CallLog[] = [];
  const warnings: string[] = [];
  const callees: Record<string, Callee> = {};
  let taskSeq = 0;
  const written: { fileId: string; base64: string; reason?: string }[] = [];
  const created: { folderId: string; name: string; base64: string }[] = [];
  const emitsOf = (cap: string): Set<string> => new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []);

  function ctxFor(cap: string | null, who: Caller): Ctx {
    const allowed = cap ? emitsOf(cap) : null;
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}), trace: { traceId: TRACE, spanId: "0123456789abcdef" },
      ...(who.run ? { run: who.run } : {}), ...(who.thread ? { thread: who.thread } : {}), origin: "user", depth: 0,
      now: () => clock,
      db: scopedDb("esign", raw, TRACE),
      emit<T>(name: EventName, subj: string, payload: T): EventEnvelope<T> {
        if (allowed && !allowed.has(name)) throw new Error(`${cap} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        const ev: Ev = { name, subject: subj, payload: payload as Record<string, unknown>, id: mintId("evt", clock) };
        events.push(ev);
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
      http: async () => { throw new Error("no network in esign tests"); },
      log: { debug() {}, info() {}, warn: (msg: string) => { warnings.push(msg); }, error() {} },
      schedule: async () => "sch_1",
      seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "b" }), unseal: () => new Uint8Array() },
    };
  }

  /** Calls a handler like the pipeline does: input and output are validated unless `check` is false (to test what the handler itself refuses). */
  async function call(cap: string, input: unknown, who: Caller = dana, check = true): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
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
  callees["files.get"] = (i: { fileId: string }) => ({ file: { fileId: i.fileId, folderId: FOLDER, name: "Retainer.pdf", kind: "pdf", mime: "application/pdf", size: PDF.length, version: 1 } });
  callees["files.read"] = () => ({ base64: toBase64(PDF), mime: "application/pdf", size: PDF.length, version: 1, truncated: false });
  callees["files.write"] = (i: { fileId: string; content: { base64: string }; reason?: string }) => {
    written.push({ fileId: i.fileId, base64: i.content.base64, ...(i.reason ? { reason: i.reason } : {}) });
    return { file: { fileId: i.fileId, version: 2 }, versionId: "ver_2" };
  };
  callees["files.create"] = (i: { folderId: string; name: string; content: { base64: string } }) => {
    created.push({ folderId: i.folderId, name: i.name, base64: i.content.base64 });
    return { file: { fileId: `fil_cert${created.length}`, folderId: i.folderId, name: i.name } };
  };
  callees["tasks.create"] = () => ({ task: { id: `tsk_sig${++taskSeq}` } });
  callees["tasks.transition"] = () => ({ task: {} });
  callees["chat.post"] = () => ({ message: { id: "msg_1" } });

  return {
    sqlite, db: raw, call, ctxFor, provider,
    get events(): Ev[] { return events; },
    calls, warnings, written, created,
    callee(cap: string, f: Callee): void { callees[cap] = f; },
    callsTo: (cap: string): CallLog[] => calls.filter((c) => c.cap === cap),
    advance(ms: number): void { clock += ms; },
    now: (): number => clock,
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

export { fromBase64, toBase64 };
