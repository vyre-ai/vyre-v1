// Test harness for the agents module: a real in-memory SQLite behind the host's ctx.db guard (agents_* tables only), a recording ctx, a clock the tests move, an in-memory Files (folders, files,
// versions, a lint that refuses an agent.toml that does not pass) standing in for the capabilities the module calls, and checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { checkToml } from "../projections.ts";
import type { AgentsCtx, Principal } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const SPACE = "spc_agentstest";
export const DANA = "usr_dana";
export const MAYA = "usr_maya";
export const LEO = "usr_leo";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }

type Handler = (input: any, opts?: { idempotencyKey?: string }) => unknown;
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { error: { code, message } }); };

interface FileVersion { versionId: string; n: number; text: string; by: string; at: number; reason?: string }
interface FakeFile { fileId: string; folderId: string; name: string; versions: FileVersion[]; deletedAt?: number }
interface FakeFolder { folderId: string; parentId?: string; name: string; deleted: boolean }

/** Files in memory: the capabilities agents calls, with the rules that matter to it (names unique in a folder, a version per save, a lint on agent.toml). */
export function fakeFiles(clock: { t: number }) {
  const folders = new Map<string, FakeFolder>();
  const files = new Map<string, FakeFile>();
  const keys = new Map<string, unknown>();
  const calls: Array<{ cap: string; input: unknown }> = [];
  const settings: Record<string, unknown> = {};
  let n = 0;
  const next = (prefix: string): string => `${prefix}_${(++n).toString(36).padStart(6, "0")}`;
  const path = (id: string): string => { const f = folders.get(id)!; return f.parentId ? `${path(f.parentId)}/${f.name}` : f.name; };
  const folderOut = (f: FakeFolder) => ({ folderId: f.folderId, ...(f.parentId ? { parentId: f.parentId } : {}), name: f.name, path: path(f.folderId) });
  const fileOut = (f: FakeFile) => ({ fileId: f.fileId, folderId: f.folderId, name: f.name, version: f.versions.length, ...(f.deletedAt !== undefined ? { deletedAt: f.deletedAt } : {}) });
  const addVersion = (f: FakeFile, text: string, by: string, reason?: string): FileVersion => {
    const v: FileVersion = { versionId: next("ver"), n: f.versions.length + 1, text, by, at: clock.t, ...(reason !== undefined ? { reason } : {}) };
    f.versions.push(v);
    return v;
  };
  const file = (id: string): FakeFile => files.get(id) ?? fail("validation.not_found", "no such file");
  const root = (name: string): string => { const id = next("fld"); folders.set(id, { folderId: id, name, deleted: false }); return id; };
  const agentsRoot = root("Agents");

  const handlers: Record<string, Handler> = {
    // agents.create shares the new folder to an owner who is not the asker (ruling 88): the share is recorded in `calls`
    "access.share": (i) => ({ grant: { id: "gnt_fake", subject: i["subject"], resource: i["resource"], level: i["level"] } }),
    "files.folder.search": (i) => ({ folders: [...folders.values()].filter((f) => !f.deleted && f.name.toLowerCase().includes(String(i.q).toLowerCase())).map(folderOut) }),
    "files.folder.create": (i, o) => {
      const k = o?.idempotencyKey ? `fc:${o.idempotencyKey}` : undefined;
      if (k && keys.has(k)) return keys.get(k);
      if (![...folders.values()].some((f) => f.folderId === i.parentId)) fail("validation.bad_input", "no such parent");
      if ([...folders.values()].some((f) => !f.deleted && f.parentId === i.parentId && f.name === i.name)) fail("validation.duplicate", "a folder with that name exists");
      const id = next("fld");
      folders.set(id, { folderId: id, parentId: i.parentId, name: i.name, deleted: false });
      const out = { folder: folderOut(folders.get(id)!) };
      if (k) keys.set(k, out);
      return out;
    },
    "files.folder.rename": (i) => {
      const f = folders.get(i.folderId) ?? fail("validation.not_found", "no such folder");
      if ([...folders.values()].some((x) => x.folderId !== f.folderId && !x.deleted && x.parentId === f.parentId && x.name === i.name)) fail("validation.duplicate", "a folder with that name exists");
      f.name = i.name;
      return { folder: folderOut(f) };
    },
    "files.folder.delete": (i) => { (folders.get(i.folderId) ?? fail("validation.not_found", "no such folder")).deleted = true; return { deleted: true }; },
    "files.folder.restore": (i) => { const f = folders.get(i.folderId) ?? fail("validation.not_found", "no such folder"); f.deleted = false; return { folder: folderOut(f) }; },
    "files.create": (i, o) => {
      const k = o?.idempotencyKey ? `fi:${o.idempotencyKey}` : undefined;
      if (k && keys.has(k)) return keys.get(k);
      if ([...files.values()].some((f) => f.deletedAt === undefined && f.folderId === i.folderId && f.name === i.name)) fail("validation.duplicate", "a file with that name exists");
      const f: FakeFile = { fileId: next("fil"), folderId: i.folderId, name: i.name, versions: [] };
      files.set(f.fileId, f);
      addVersion(f, i.content?.text ?? "", "usr_system", "Created");
      const out = { file: fileOut(f) };
      if (k) keys.set(k, out);
      return out;
    },
    "files.get": (i) => ({ file: fileOut(file(i.fileId)) }),
    "files.delete": (i) => { file(i.fileId).deletedAt = clock.t; return { deleted: true }; },
    "files.restore": (i) => { const f = file(i.fileId); delete f.deletedAt; if (i.toFolderId) f.folderId = i.toFolderId; return { file: fileOut(f) }; },
    "files.move": (i) => {
      const f = file(i.fileId);
      const name = i.name ?? f.name;
      if ([...files.values()].some((x) => x.fileId !== f.fileId && x.deletedAt === undefined && x.folderId === i.toFolderId && x.name === name)) fail("validation.duplicate", "a file with that name exists");
      f.folderId = i.toFolderId;
      f.name = name;
      return { file: fileOut(f) };
    },
    "files.list": (i) => {
      const parent = i.folder as string | undefined;
      return {
        files: parent === undefined ? [] : [...files.values()].filter((f) => f.folderId === parent && f.deletedAt === undefined).map(fileOut),
        folders: [...folders.values()].filter((f) => !f.deleted && (parent === undefined ? f.parentId === undefined : f.parentId === parent)).map(folderOut),
      };
    },
    "files.read": (i) => {
      const f = file(i.fileId);
      const v = i.versionId ? f.versions.find((x) => x.versionId === i.versionId) ?? fail("validation.not_found", "no such version") : f.versions[f.versions.length - 1]!;
      return { text: v.text, mime: "text/plain", size: v.text.length, version: v.n, truncated: false };
    },
    "files.save": (i) => {
      const f = file(i.fileId);
      if (f.name === "agent.toml") {
        const c = checkToml(i.text);
        if (!c.ok) fail("validation.precondition_failed", `Not saved: ${c.errors[0]?.message ?? "the lint found an error."}`);
      }
      if (!["AGENT.md", "agent.toml", "VYRE.md"].includes(f.name)) fail("validation.precondition_failed", "files.save is for guidance files");
      const v = addVersion(f, i.text, "usr_saver", i.reason);
      return { versionId: v.versionId, n: v.n, lint: { file: "other", lines: 0, state: "ok", overrides: [], secrets: [], problems: [] }, added: 0, removed: 0 };
    },
    "files.write": (i) => { const f = file(i.fileId); const v = addVersion(f, i.content?.text ?? "", "usr_writer", i.reason); return { file: fileOut(f), versionId: v.versionId }; },
    "files.versions": (i) => ({ versions: [...file(i.fileId).versions].reverse().map((v) => ({ versionId: v.versionId, n: v.n, by: v.by, at: v.at, ...(v.reason !== undefined ? { reason: v.reason } : {}) })) }),
    "files.restore_version": (i) => {
      const f = file(i.fileId);
      const old = f.versions.find((x) => x.versionId === i.versionId) ?? fail("validation.not_found", "no such version");
      const v = addVersion(f, old.text, "usr_restorer", `Restored version ${old.n}`);
      return { file: fileOut(f), versionId: v.versionId };
    },
    "settings.get": (i) => ({ row: { key: i.key, value: settings[i.key] ?? "suggest" } }),
    "tasks.create": (i) => ({ task: { id: next("tsk"), title: i.title } }),
  };

  return {
    root: agentsRoot, folders, files, calls, handlers,
    answer(cap: string, f: Handler) { handlers[cap] = f; },
    setting(key: string, value: unknown) { settings[key] = value; },
    folderNamed(name: string, parent?: string): FakeFolder | undefined { return [...folders.values()].find((f) => !f.deleted && f.name === name && f.parentId === parent); },
    /** Everything under a folder as relative paths (files and folders). */
    tree(folderId: string): string[] {
      const out: string[] = [];
      const walk = (id: string, prefix: string): void => {
        for (const f of folders.values()) if (!f.deleted && f.parentId === id) { out.push(`${prefix}${f.name}/`); walk(f.folderId, `${prefix}${f.name}/`); }
        for (const f of files.values()) if (f.folderId === id) out.push(`${prefix}${f.name}`);
      };
      walk(folderId, "");
      return out.sort();
    },
    fileIn(folderId: string, name: string): FakeFile | undefined { return [...files.values()].find((f) => f.folderId === folderId && f.name === name); },
    text(fileId: string): string { const f = file(fileId); return f.versions[f.versions.length - 1]!.text; },
    /** A person saves a file in Files, outside the module. Returns the event the host would then raise. */
    edit(fileId: string, text: string, by = DANA): { payload: { fileId: string; versionId: string; n: number; by: string } } {
      const f = file(fileId);
      const v = addVersion(f, text, by, "Edited by hand");
      return { payload: { fileId, versionId: v.versionId, n: v.n, by } };
    },
    /** A template file in the Space's Agent template folder. */
    templateFile(path: string, text: string): void {
      let home = [...folders.values()].find((f) => !f.deleted && f.name === "Agent template" && f.parentId === undefined)?.folderId;
      if (!home) home = root("Agent template");
      const parts = path.split("/");
      let parent = home;
      for (const part of parts.slice(0, -1)) {
        const found = [...folders.values()].find((f) => f.parentId === parent && f.name === part);
        parent = found ? found.folderId : (() => { const id = next("fld"); folders.set(id, { folderId: id, parentId: parent, name: part, deleted: false }); return id; })();
      }
      const name = parts[parts.length - 1] as string;
      const old = [...files.values()].find((f) => f.folderId === parent && f.name === name);
      if (old) { addVersion(old, text, "usr_admin", "Changed"); return; }
      const f: FakeFile = { fileId: next("fil"), folderId: parent, name, versions: [] };
      files.set(f.fileId, f);
      addVersion(f, text, "usr_admin", "Created");
    },
  };
}
export type FakeFiles = ReturnType<typeof fakeFiles>;

/** A real in-memory SQLite, opened through the kernel's projection host (modules never import node:sqlite, boundary B2). */
export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: SPACE, projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

export interface HarnessOptions {
  raw?: RawDb;
  principal?: Principal;
  actingFor?: string;
  clock?: { t: number };
  files?: FakeFiles;
  /** Permissions the caller holds, by action and resource. Default: everything. */
  allow?: (action: { perm: string | null; level: string }, resource: { type: string; id: string | null }) => boolean;
}

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const emitted: Emitted[] = [];
  const warned: string[] = [];
  const world = o.files ?? fakeFiles(clock);
  let allow = o.allow ?? (() => true);
  const db = scopedDb("agents", raw, TRACE);
  const ctx: AgentsCtx = {
    space: SPACE,
    principal: o.principal ?? { kind: "person", id: DANA },
    ...(o.actingFor === undefined ? {} : { actingFor: o.actingFor }),
    trace: { traceId: TRACE },
    now: () => clock.t,
    db,
    emit(name, subject, payload) { emitted.push({ name, subject, payload: payload as Record<string, unknown> }); return null; },
    async call(cap, input, opts) {
      world.calls.push({ cap, input });
      const f = world.handlers[cap];
      if (!f) throw Object.assign(new Error(`${cap} is not available`), { error: { code: "internal.unavailable", message: `${cap} is not available` } });
      return f(input, opts);
    },
    authorize: (action, resource) => ({ effect: allow(action, resource) ? "allow" : "deny" }),
    log: { warn(msg) { warned.push(msg); } },
  };
  const h = {
    ctx, raw, db, emitted, clock, world, warned,
    advance(ms: number) { clock.t += ms; },
    allowOnly(f: NonNullable<HarnessOptions["allow"]>) { allow = f; },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    names(): string[] { return emitted.map((e) => e.name); },
    clear() { emitted.length = 0; world.calls.length = 0; },
    /** The same database as another principal. */
    as(principal: Principal, actingFor?: string): AgentsCtx { return { ...ctx, principal, ...(actingFor === undefined ? {} : { actingFor }) }; },
    person(id: string): AgentsCtx { return h.as({ kind: "person", id }); },
  };
  return h;
}
export type Harness = ReturnType<typeof harness>;

export function eventErrors(name: string, payload: unknown): string[] {
  const def = registry.events.find((e) => e.name === name);
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}
/** Errors of a value against the frozen input or output of a capability. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}
export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}
export function codeOf(err: unknown): string {
  const e = err as { error?: { code?: string }; code?: string };
  return e?.error?.code ?? e?.code ?? "unknown";
}
export async function failure(f: () => unknown): Promise<string> {
  try { await f(); } catch (e) { return codeOf(e); }
  return "none";
}
