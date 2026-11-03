// A Files module over a real sqlite db (every migration, the Space seal) for the Redaction for AI tests: a personal injury claim folder in Projects, its files, and a ctx per caller.
// @reads /modules/files/migrations/0006_redaction.sql
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aesUnwrap, aesWrap } from "../../../kernel/src/seal/box.ts";
import type { Ctx, Sealed } from "../../../packages/contracts/src/ctx.ts";
import { configureFilesHost, handlers } from "../impl.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
type H = (ctx: Ctx, input: unknown) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Caller { kind: "person" | "agent" | "service" | "actor"; id: string; actingFor?: string; thread?: string; origin?: string }

/** The sqlite db the test opens (node:sqlite is for tests and the host only; boundaries B2). */
export interface SqlDb { exec(sql: string): void; prepare(q: string): { all(...a: never[]): unknown[]; run(...a: never[]): { changes: number | bigint } } }

export function redactWorld(sql: SqlDb) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) sql.exec(readFileSync(join(dir, f), "utf8"));
  configureFilesHost({ resources: { ensure: async () => {}, setLabel: async () => {} } });
  const key = new Uint8Array(32).fill(7);
  const events: { name: string; subject: string; payload: Obj }[] = [];
  let t = 1_790_000_000_000;
  const db = { all: (q: string, ...a: unknown[]) => sql.prepare(q).all(...(a as never[])) as unknown[], run: (q: string, ...a: unknown[]) => ({ changes: Number(sql.prepare(q).run(...(a as never[])).changes) }) };
  const ctxFor = (c: Caller): Ctx => {
    const ctx = {
      space: "spc_t", principal: { kind: c.kind, id: c.id }, ...(c.actingFor ? { actingFor: c.actingFor } : {}), ...(c.thread ? { thread: c.thread } : {}),
      trace: { traceId: "t".repeat(32), spanId: "s".repeat(16) }, origin: c.origin ?? "api", depth: 0, now: () => (t += 1000),
      db, emit: ((name: string, subject: string, payload: Obj) => { events.push({ name, subject, payload }); return { payload }; }) as never,
      // a nested call goes to the module's own handlers (previews.text and mounts.open are not here: plain text files need neither)
      call: (async (cap: string, input: unknown) => { const h = (handlers as unknown as Record<string, H>)[cap]; if (!h) throw Object.assign(new Error(`no ${cap} here`), { error: { code: "internal.not_implemented" } }); return h(ctx, input); }) as never,
      log: { debug() {}, info() {}, warn() {}, error() {} }, authorize: (() => ({ effect: "allow", reason: "", decisionId: "d" })) as never,
      seal: {
        seal: (v: Uint8Array, scope: string): Sealed => { const box = aesWrap(key, v, scope); return { keyId: "space-key", nonce: box.iv, bytes: JSON.stringify({ ct: box.ct, tag: box.tag, aad: scope }) }; },
        unseal: (s: Sealed): Uint8Array => { const b = JSON.parse(s.bytes) as { ct: string; tag: string; aad: string }; return aesUnwrap(key, { iv: s.nonce, ct: b.ct, tag: b.tag }, b.aad); },
      },
    } as unknown as Ctx;
    return ctx;
  };
  const irfad = ctxFor({ kind: "person", id: "usr_irfad" });
  const call = (ctx: Ctx, cap: string, input: unknown = {}): Promise<any> => (handlers as unknown as Record<string, H>)[cap]!(ctx, input);   // eslint-disable-line @typescript-eslint/no-explicit-any

  async function folder(parentId: string, name: string): Promise<string> { return (await call(irfad, "files.folder.create", { parentId, name, idempotencyKey: `f-${parentId}-${name}` })).folder.folderId; }
  async function file(folderId: string, name: string, text: string, mime = "text/plain"): Promise<string> {
    return (await call(irfad, "files.create", { folderId, name, mime, content: { text }, idempotencyKey: `c-${folderId}-${name}` })).file.fileId;
  }
  async function write(fileId: string, text: string): Promise<void> {
    const cur = (await call(irfad, "files.get", { fileId })).file.version;
    await call(irfad, "files.write", { fileId, content: { text }, baseVersion: cur, reason: "new version" });
  }
  async function roots(): Promise<Record<string, string>> {
    const tree = (await call(irfad, "files.tree", {})) as { roots: { key: string; folderId?: string }[] };
    return Object.fromEntries(tree.roots.filter((r) => r.folderId).map((r) => [r.key, r.folderId!]));
  }
  return { sql, db, events, ctxFor, irfad, call, folder, file, write, roots, done: () => configureFilesHost(null) };
}

export const INTAKE = [
  "Client intake. Matter CV-2026-04417.",
  "Name: Elena Rivera. Date of birth: 03/14/1986. SSN: 512-44-8391.",
  "Phone: (415) 555-0161. Email: elena.rivera@fastmail.example.",
  "Address: 2217 Alder Street, Apt 4, Oakland, CA 94612.",
  "Slipped on a wet floor near aisle 7 with no warning sign.",
  "Spouse: Marco Rivera, (415) 555-0178.",
].join("\n");
export const SECRETS = ["Elena Rivera", "03/14/1986", "512-44-8391", "(415) 555-0161", "2217 Alder Street, Apt 4"];
