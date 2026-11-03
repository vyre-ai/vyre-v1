// A real SQLite database (node:sqlite, in memory) behind the host's module table guard, a blob store in memory, and a ctx that checks what the invoke pipeline checks: inputs, outputs
// and event payloads against the generated validators, and that a capability emits only the events it declares. Chats and channels are scripted so the audience rule can be driven.
import { readFileSync } from "node:fs";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { handlers } from "../impl.ts";
import type { BlobMeta, Db, NotesCtx } from "../projections.ts";

// Boundary B2 keeps node:sqlite out of module import lines; the fixture asks the runtime for the built-in, as modules/tasks/fixtures/db.ts does.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const migration = readFileSync(new URL("../migrations/0001_notes.sql", import.meta.url), "utf8");
const picture = readFileSync(new URL("../migrations/0002_link_picture.sql", import.meta.url), "utf8");
export const TRACE = "0123456789abcdef0123456789abcdef";
export const NOW = 1_762_160_000_000;
export const ME = "usr_irfad", ALIZA = "usr_aliza", ANDREY = "usr_andrey";

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; opts?: Record<string, unknown> | undefined }
export interface Who { id: string; kind?: "person" | "agent"; actingFor?: string; thread?: string }
type Callee = (input: any, who: Who) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** A chat: its starter and person members, or the channel it is in. */
export interface ThreadDef { starter?: string; members?: string[]; channelId?: string; kind?: string; parentThreadId?: string }
export interface ChannelDef { visibility: "public" | "invite"; members: string[] }

export function harness(o: { threads?: Record<string, ThreadDef>; channels?: Record<string, ChannelDef>; pages?: Record<string, string> } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  sqlite.exec(picture);
  const norm = (a: unknown): unknown => (a === undefined ? null : a);
  const raw: Db = {
    all: (sql, ...args) => sqlite.prepare(sql).all(...(args.map(norm) as never[])),
    run: (sql, ...args) => ({ changes: Number(sqlite.prepare(sql).run(...(args.map(norm) as never[])).changes) }),
  };
  const blobs = new Map<string, { meta: BlobMeta; bytes: Uint8Array; resource?: unknown }>();
  let n = 0;
  let clock = NOW;
  let events: Ev[] = [];
  const all: Ev[] = [];
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const threads = o.threads ?? {};
  const channels = o.channels ?? {};
  const pages = o.pages ?? {};
  const taskKeys: Record<string, string> = {};
  const callees: Record<string, Callee> = {
    "threads.get": (i: { threadId: string }) => {
      const t = threads[i.threadId];
      if (!t) throw new Error("no such thread");
      return { thread: { kind: t.kind ?? (t.channelId ? "channel" : "chat"), ...(t.starter ? { starter: t.starter } : {}), ...(t.channelId ? { channelId: t.channelId } : {}), ...(t.parentThreadId ? { parentThreadId: t.parentThreadId } : {}), members: (t.members ?? []).map((id) => ({ kind: "person", id })) } };
    },
    "channels.get": (i: { channelId: string }) => {
      const c = channels[i.channelId];
      if (!c) throw new Error("no such channel");
      return { channel: { visibility: c.visibility, members: c.members.map((id) => ({ kind: "person", id })) } };
    },
    // a page: its meta as JSON, and with "preview" the picture read_link fetched on the server (the stand-in passes it through as given)
    "automations.read_link": (i: { url: string; preview?: boolean }) => {
      const page = pages[i.url];
      if (page === undefined) return { ok: false, reason: "not reachable" };
      const { preview, ...meta } = JSON.parse(page) as Record<string, unknown>;
      return { ok: true, finalUrl: i.url, kind: "html", text: "", meta, ...(i.preview && preview ? { preview } : {}) };
    },
    "tasks.create": (i: { title: string; idempotencyKey: string }) => ({ task: { id: (taskKeys[i.idempotencyKey] ??= `tsk_${++n}`), title: i.title } }),   // the tasks module answers a key it has seen with the same task
    "records.create": () => ({ record: { id: `rec_${++n}` } }),
  };
  const emitsOf = (cap: string): Set<string> => new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []);

  function ctxFor(cap: string, who: Who): NotesCtx {
    const allowed = emitsOf(cap);
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}), ...(who.thread ? { thread: who.thread } : {}),
      trace: { traceId: TRACE }, now: () => clock, db: scopedDb("notes", raw, TRACE),
      emit(name, subject, payload, opts) {
        if (!allowed.has(name)) throw new Error(`${cap} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        events.push({ name, subject, payload: payload as Record<string, unknown>, opts: opts as Record<string, unknown> | undefined });
        return {};
      },
      async call(c, input) {
        if (c !== "threads.get" && c !== "channels.get") calls.push({ cap: c, input: input as Record<string, unknown> });
        const f = callees[c];
        if (!f) throw new Error(`unexpected call to ${c}`);
        return f(input, who);
      },
      blobs: {
        async put(bytes, contentType, opts) {
          const id = `blb_${(++n).toString(16).padStart(32, "0")}`;
          const meta = { id, contentType, size: bytes.byteLength };
          blobs.set(id, { meta, bytes, ...(opts?.resource ? { resource: opts.resource } : {}) });
          return meta;
        },
        async get(id) { return blobs.get(id) ?? null; },
      },
      log: { info: () => {}, warn: () => {} },
    };
  }

  let keys = 0;
  /** Call a capability the way the pipeline does: validate the input, run the handler, validate the output. Events of a failed call are dropped. */
  async function call(cap: string, raw0: Record<string, unknown>, who: Who | string = ME): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const w: Who = typeof who === "string" ? { id: who } : who;
    const needsKey = (registry.capabilities.find((c) => c.name === cap)?.input as { required?: string[] } | undefined)?.required?.includes("idempotencyKey");
    const input = needsKey && raw0["idempotencyKey"] === undefined ? { ...raw0, idempotencyKey: `key_${++keys}` } : raw0;
    const bad = validateInput(cap, 1, input);
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const h = (handlers as Record<string, (ctx: NotesCtx, input: unknown) => Promise<unknown>>)[cap];
    if (!h) throw new Error(`no handler for ${cap}`);
    events = [];
    const result = await h(ctxFor(cap, w), input);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    all.push(...events);
    return result;
  }

  return {
    call, db: raw, blobs, calls,
    get events(): Ev[] { return events; }, allEvents: all,
    advance(ms: number): void { clock += ms; },
    /** an agent of `person`, asking in `thread` */
    agent: (person: string, thread?: string): Who => ({ id: "agt_assistant", kind: "agent", actingFor: person, ...(thread ? { thread } : {}) }),
  };
}

export function codeOf(e: unknown): string | undefined {
  return (e as { error?: { code?: string } } | null)?.error?.code;
}
export const failed = (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e: unknown) => codeOf(e) ?? String(e));

/** The smallest PNG: one transparent pixel. */
export const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
