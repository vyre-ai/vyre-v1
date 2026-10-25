// Test harness for the governance handlers: an in-memory database, a recording ctx and a small world the handlers reach through scripted capabilities: Files (files, folders, Trash), records (with holds), the
// search index, the conversation, memory facts, the audit archive, settings and the principals' roles. Every call is checked against the callee's frozen input schema, every answer the script gives against
// its output schema, and every event a handler emits against the event's payload schema; a capability nobody scripted fails loudly.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { HostError } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { GovCtx } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const DAY = 86_400_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const OWNER = "usr_owner0001";
export const ADMIN = "usr_admin0002";
export const PAT = "rec_pat00001";
export const FOLDER = "fld_proj00001";
export const PARENT = "fld_root00001";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: Record<string, unknown> }
type Script = (input: Record<string, unknown>) => unknown;
type Rec = Record<string, unknown>;
interface FileRow { fileId: string; name: string; folderId: string; ownerId: string; deletedAt?: number }
interface RecRow { type: string; id: string; name: string; holds: number; gone: boolean }

export function harness() {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  let clock = NOW;
  let seq = 0;
  const scripts = new Map<string, Script>();
  const err = (code: string, message: string): HostError => fail(code as never, TRACE, { message });

  const world = {
    settings: new Map<string, unknown>(),
    files: new Map<string, FileRow>(),
    folders: new Map<string, string | null>([[PARENT, null], [FOLDER, PARENT]]),
    records: new Map<string, RecRow>(),
    sureByTerm: new Map<string, { type: string; id: string }>(),
    searchHits: new Map<string, Rec[]>(),
    thread: new Map<string, Rec[]>(),
    facts: new Map<string, string[]>(),         // subject to fact ids
    notes: new Map<string, Rec[]>(),
    erasedFacts: [] as string[],
    purged: [] as string[],
    archivedBefore: [] as number[],
    archiveReturns: 0,
    roles: new Map<string, string[]>([[OWNER, ["rol_owner"]], [ADMIN, ["rol_admin"]]]),
    channels: new Set<string>(),
    runs: new Map<string, { status: string; summary?: string; error?: Rec }>(),
  };

  const fileOut = (f: FileRow) => ({
    fileId: f.fileId, folderId: f.folderId, name: f.name, kind: "text", mime: "text/plain", size: 10, version: 1, label: 0, ownerId: f.ownerId, createdAt: NOW - 100 * DAY, updatedAt: NOW - 100 * DAY, updatedBy: f.ownerId,
    thumb: false, holds: 0, ...(f.deletedAt !== undefined ? { deletedAt: f.deletedAt } : {}),
  });
  const folderOut = (id: string) => {
    const parent = world.folders.get(id);
    return { folderId: id, name: `Folder ${id.slice(-4)}`, path: `Folder ${id.slice(-4)}`, fileCount: 0, folderCount: 0, scope: "space", label: 0, git: false, reviewChanges: false, ...(parent ? { parentId: parent } : {}) };
  };
  const recOut = (r: RecRow) => ({ id: r.id, type: r.type, fields: { name: r.name }, version: 1, label: 0, holds: r.holds, createdAt: NOW, updatedAt: NOW, ...(r.gone ? { deletedAt: NOW } : {}) });

  const defaults: Record<string, Script> = {
    "settings.get": (i) => {
      const k = String(i["key"]);
      if (!world.settings.has(k)) throw err("validation.not_found", "No such setting.");
      return { row: { key: k, title: k, page: "console.data", scope: "space", source: "space", default: {}, floorable: false, value: world.settings.get(k) } };
    },
    "settings.set_space": (i) => {
      const k = String(i["key"]);
      const previous = world.settings.get(k) ?? {};
      world.settings.set(k, i["value"]);
      return { previous, row: { key: k, title: k, page: "console.data", scope: "space", source: "space", default: {}, floorable: false, value: i["value"] } };
    },
    "files.get": (i) => {
      const f = world.files.get(String(i["fileId"]));
      if (!f) throw err("validation.not_found", "No such file.");
      return { file: fileOut(f) };
    },
    "files.folder.get": (i) => {
      if (!world.folders.has(String(i["folderId"]))) throw err("validation.not_found", "No such folder.");
      return { folder: folderOut(String(i["folderId"])) };
    },
    "files.trash.list": () => {
      const files = [...world.files.values()].filter((f) => f.deletedAt !== undefined).sort((a, b) => (b.deletedAt as number) - (a.deletedAt as number));
      return { files: files.map(fileOut), folders: [], total: files.length };
    },
    "files.delete": (i) => {
      const f = world.files.get(String(i["fileId"]));
      if (!f) throw err("validation.not_found", "No such file.");
      if (f.deletedAt === undefined) f.deletedAt = clock;
      return { deleted: true };
    },
    "files.purge": (i) => {
      const f = world.files.get(String(i["fileId"]));
      if (!f) throw err("validation.not_found", "No such file.");
      if (f.deletedAt === undefined) throw err("validation.precondition_failed", "Move the file to Trash before deleting it for good.");
      world.files.delete(f.fileId);
      world.purged.push(f.fileId);
      return { purged: true };
    },
    "channels.get": (i) => {
      if (!world.channels.has(String(i["channelId"]))) throw err("validation.not_found", "No such channel.");
      return { channel: { channelId: i["channelId"], name: "Intake", archived: false, createdAt: NOW, mainThreadId: "thr_main00001", members: [], agents: [], unread: 0, visibility: "invite" } };
    },
    "audit.archive": (i) => {
      world.archivedBefore.push(Number(i["before"]));
      return { archived: world.archiveReturns };
    },
    "records.get": (i) => {
      const r = world.records.get(String(i["recordId"]));
      if (!r || r.type !== i["type"] || r.gone) throw err("validation.not_found", "No such record.");
      return { record: recOut(r) };
    },
    "records.delete": (i) => {
      const r = world.records.get(String(i["recordId"]));
      if (!r) throw err("validation.not_found", "No such record.");
      r.gone = true;
      return { deleted: true };
    },
    "contacts.resolve": (i) => {
      const term = String(i["email"] ?? i["phone"] ?? i["name"] ?? "");
      const hit = world.sureByTerm.get(term);
      return { sure: hit ? [{ recordId: hit.id, type: hit.type, name: "Pat Lee", via: "address", score: 1 }] : [], unsure: [] };
    },
    "search.query": (i) => {
      const hits = (world.searchHits.get(String(i["q"])) ?? []).filter((h) => (i["types"] as string[]).includes(String(h["kind"])));
      return { hits: hits.map((h) => ({ id: h["id"], kind: h["kind"], title: h["title"] ?? h["id"], link: `/x/${String(h["id"])}`, score: 1 })), tookMs: 1 };
    },
    "inbox.thread": (i) => {
      const items = world.thread.get(String(i["contactId"])) ?? [];
      return {
        conversation: {
          id: "cnv_pat00001", address: "pat@client.example", displayName: "Pat Lee", lastChannel: "email", lastMessageAt: NOW, lastPreview: "", unreadCount: 0, followed: false, alertOnReplies: false, mailboxIds: [], needsMatch: false,
          contactId: i["contactId"],
        },
        items: items.map((it) => ({ at: NOW, ...it })),
      };
    },
    "memory.find_by_subject": (i) => {
      const ids = world.facts.get(String(i["subject"])) ?? [];
      return {
        facts: ids.map((id) => ({ factId: id, layer: "agent", ownerRef: "agt_intake01", text: "(not shown)", validFrom: NOW, learnedAt: NOW, sourceKind: "chat", sourceRef: "thr_x", status: "current" })),
        notes: (world.notes.get(String(i["subject"])) ?? []).map((n) => ({ layer: "agent", path: "x.md", title: "Note", updatedAt: NOW, ...n })),
      };
    },
    "memory.erase": (i) => {
      for (const f of (i["factIds"] as string[]) ?? []) world.erasedFacts.push(f);
      return { erased: ((i["factIds"] as string[]) ?? []).length };
    },
    "access.principals.get": (i) => {
      const id = String((i["principal"] as Rec)["id"]);
      return { principal: { id, kind: "person", name: "Someone", roles: world.roles.get(id) ?? [], groups: [], status: "active", createdAt: NOW } };
    },
    "runs.start": (i) => {
      const runId = `run_gov${(++seq).toString(36)}`;
      world.runs.set(runId, { status: "running" });
      void i;
      return { runId };
    },
    "runs.finish": (i) => {
      const r = world.runs.get(String(i["runId"]));
      if (r) { r.status = String(i["status"]); if (i["summary"]) r.summary = String(i["summary"]); if (i["error"]) r.error = i["error"] as Rec; }
      return { run: { id: i["runId"], kind: "other", owner: OWNER, startedBy: OWNER, status: i["status"], costMicros: 0, startedAt: NOW, traceId: TRACE, ...(i["summary"] ? { summary: i["summary"] } : {}) } };
    },
  };

  const scheduled: { at: number; cap: string; input: Rec }[] = [];
  const ctx: GovCtx = {
    space: "spc_gov",
    principal: { kind: "person", id: OWNER },
    trace: { traceId: TRACE },
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload) {
      const e = registry.events.find((x) => x.name === name);
      if (!e) throw new Error(`${name} is not in the registry`);
      const misfit = validate(e.payload, payload, "", registry.$defs);
      if (misfit.length) throw new Error(`${name} was emitted with a payload its contract refuses: ${misfit.join("; ")}`);
      emitted.push({ name, subject, payload: payload as Record<string, unknown> });
      return null;
    },
    async call(cap, input) {
      const body = (input ?? {}) as Record<string, unknown>;
      called.push({ cap, input: body });
      const d = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
      if (!d) throw new Error(`${cap} is not in the registry`);
      const misfit = validate(d.input, body, "", registry.$defs);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      const script = scripts.get(cap) ?? defaults[cap];
      if (!script) throw new Error(`unscripted capability ${cap}`);
      const out = script(body);
      const bad = validate(d.output, out, "", registry.$defs);
      if (bad.length) throw new Error(`the script for ${cap} answered something its contract refuses: ${bad.join("; ")}`);
      return out;
    },
    async schedule(at, cap, input) {
      scheduled.push({ at, cap, input: input as Rec });
      return `sch_${scheduled.length}`;
    },
    log: { info() {}, warn() {} },
  };

  return {
    ctx, emitted, called, world, scheduled,
    script(cap: string, fn: Script): void { scripts.set(cap, fn); },
    addFile(fileId: string, o: Partial<FileRow> = {}): FileRow {
      const f: FileRow = { fileId, name: `${fileId}.txt`, folderId: FOLDER, ownerId: OWNER, ...o };
      world.files.set(fileId, f);
      return f;
    },
    addRecord(id: string, o: Partial<RecRow> = {}): RecRow {
      const r: RecRow = { type: "contact", id, name: "Pat Lee", holds: 0, gone: false, ...o };
      world.records.set(id, r);
      return r;
    },
    actAs(kind: "person" | "agent" | "service", id: string) { ctx.principal = { kind, id }; },
    advance(ms: number) { clock += ms; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    err,
  };
}

export type Harness = ReturnType<typeof harness>;

export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const d = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!d) return [`${cap} is not in the registry`];
  return validate(side === "in" ? d.input : d.output, value, "", registry.$defs);
}

/** Errors of an event payload against the frozen contract of the event. */
export function eventErrors(name: string, payload: unknown): string[] {
  const e = registry.events.find((x) => x.name === name);
  if (!e) return [`${name} is not in the registry`];
  return validate(e.payload, payload, "", registry.$defs);
}

export const codeOf = (err: unknown): string => (err as { error?: { code?: string } } | null)?.error?.code ?? "";

export async function refusedWith(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return codeOf(e);
  }
  throw new Error("expected a refusal");
}
