// Test harness for the meetings handlers: an in-memory database, a recording ctx and the other modules meetings calls (records, contacts, calendar, zoom, files, runs, tasks) as scripted
// capabilities. Records is a small real store (create, get, update, delete, query) so a Meeting round trips. Every call is checked against the callee's frozen input schema, every answer the script
// gives against its output schema, and every event a handler emits against the event's payload schema; a capability nobody scripted fails loudly.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { HostError } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { MeetCtx } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;   // Thursday 2025-10-09 08:53 UTC
export const TRACE = "0123456789abcdef0123456789abcdef";
export const MAYA = "usr_maya0001";
export const AGENT = "agt_scribe01";
export const HOUR = 3_600_000;
export const START = NOW + 2 * HOUR;
export const PAT = "rec_pat00001";
export const ZOOM_ID = "81234567890";
export const JOIN = "https://us02web.zoom.us/j/81234567890?pwd=abc";
export const EVENT = "cev_evt00001";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: Record<string, unknown> }
type Script = (input: Record<string, unknown>) => unknown;
type Rec = Record<string, unknown>;
interface StoredRecord { id: string; type: string; fields: Rec; version: number; createdAt: number; updatedAt: number; deleted: boolean }

export function harness() {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  let clock = NOW;
  let seq = 0;
  const store = new Map<string, StoredRecord>();
  const byKey = new Map<string, string>();
  const contacts = new Map<string, string>();        // email to a sure record
  const unsure = new Set<string>();                  // emails with only unsure matches
  const runs = new Map<string, { kind: string; summary?: string; status: string; error?: Rec }>();
  const scripts = new Map<string, Script>();
  const runKeys = new Map<string, string>();
  const files = { n: 0, folders: new Map<string, string>() };
  const calendar = { events: new Map<string, Rec>(), deleted: [] as string[] };
  const err = (code: string, message: string): HostError => fail(code as never, TRACE, { message });

  const rowOf = (r: StoredRecord) => ({ id: r.id, type: r.type, fields: r.fields, version: r.version, label: 0, holds: 0, createdAt: r.createdAt, updatedAt: r.updatedAt, ...(r.deleted ? { deletedAt: r.updatedAt } : {}) });
  const runRow = (id: string, status: string, extra: Rec = {}) => ({ id, kind: runs.get(id)?.kind ?? "other", owner: MAYA, startedBy: MAYA, status, costMicros: 0, startedAt: NOW, traceId: TRACE, ...extra });

  const defaults: Record<string, Script> = {
    "records.create": (i) => {
      const key = String(i["idempotencyKey"]);
      const have = byKey.get(key);
      if (have) return { record: rowOf(store.get(have) as StoredRecord) };
      const id = `rec_mtg${(++seq).toString(36).padStart(5, "0")}`;
      const r: StoredRecord = { id, type: String(i["type"]), fields: { ...(i["fields"] as Rec) }, version: 1, createdAt: clock, updatedAt: clock, deleted: false };
      store.set(id, r);
      byKey.set(key, id);
      return { record: rowOf(r) };
    },
    "records.get": (i) => {
      const r = store.get(String(i["recordId"]));
      if (!r || r.type !== i["type"]) throw err("validation.not_found", "No such record.");
      return { record: rowOf(r) };
    },
    "records.update": (i) => {
      const r = store.get(String(i["recordId"]));
      if (!r || r.type !== i["type"] || r.deleted) throw err("validation.not_found", "No such record.");
      r.fields = { ...r.fields, ...(i["patch"] as Rec) };
      r.version += 1;
      r.updatedAt = clock;
      return { record: rowOf(r) };
    },
    "records.delete": (i) => {
      const r = store.get(String(i["recordId"]));
      if (!r) throw err("validation.not_found", "No such record.");
      r.deleted = true;
      return { deleted: true };
    },
    "records.query": (i) => {
      const rows = [...store.values()].filter((r) => r.type === i["type"] && !r.deleted).sort((a, b) => (Date.parse(String(b.fields["starts_at"] ?? "")) || 0) - (Date.parse(String(a.fields["starts_at"] ?? "")) || 0));
      return { rows: rows.map(rowOf), total: rows.length };
    },
    "contacts.resolve": (i) => {
      const email = String(i["email"] ?? "");
      const id = contacts.get(email);
      const cand = (rid: string, score: number) => ({ recordId: rid, type: "contact", name: "Pat Lee", via: "address", score });
      return { sure: id ? [cand(id, 1)] : [], unsure: unsure.has(email) ? [cand("rec_maybe0001", 0.5), cand("rec_maybe0002", 0.4)] : [] };
    },
    "calendar.list_calendars": () => ({ calendars: [{ id: "cld_work0001", title: "Work", color: "#4f6bed", provider: "google", ownerId: MAYA, personal: true, state: "syncing" }] }),
    "calendar.create_event": (i) => {
      const id = `cev_new${++seq}`;
      const ev = {
        id, calendarId: i["calendarId"], title: i["title"], startsAt: i["startsAt"], endsAt: i["endsAt"], allDay: false, attendees: i["attendees"] ?? [], joinProvider: i["joinProvider"] ?? "none",
        recordIds: [], status: "confirmed", version: 1,
      };
      calendar.events.set(id, ev);
      return { event: ev };
    },
    "calendar.get_event": (i) => {
      const ev = calendar.events.get(String(i["eventId"]));
      if (!ev) throw err("validation.not_found", "No such event.");
      return { event: ev };
    },
    "calendar.delete_event": (i) => {
      if (!calendar.events.has(String(i["eventId"]))) throw err("validation.not_found", "No such event.");
      calendar.deleted.push(String(i["eventId"]));
      calendar.events.delete(String(i["eventId"]));
      return { deleted: true };
    },
    "zoom.meetings.create": (i) => ({ meeting: { id: ZOOM_ID, topic: i["topic"], startTime: i["startTime"], joinUrl: JOIN } }),
    "zoom.meetings.delete": () => ({ deleted: true }),
    "zoom.recordings.get": () => ({ files: [{ id: "REC0000MP4", fileType: "MP4", recordingType: "shared_screen_with_speaker_view", status: "completed" }, { id: "REC0000VTT", fileType: "TRANSCRIPT", status: "completed" }] }),
    "zoom.recordings.download": (i) => {
      const runId = `run_zdl${++seq}`;
      runs.set(runId, { kind: "other", status: "succeeded", summary: `file:fil_zoomrec${++files.n}` });
      void i;
      return { runId };
    },
    "zoom.transcripts.get": () => ({ vtt: "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.500\nDana Wine: Thanks for joining.\n\n2\n00:00:05.000 --> 00:00:09.000\nPat Lee: Glad to be here." }),
    "files.tree": () => ({ roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_personal1", count: 0 }, { key: "shared_knowledge", title: "Shared knowledge", kind: "folder", folderId: "fld_knowledge1", count: 0 }] }),
    "files.folder.create": (i) => {
      const name = String(i["name"]);
      const id = `fld_mf${++seq}`;
      return { folder: { folderId: id, name, parentId: i["parentId"], path: `Shared knowledge/${name}`, fileCount: 0, folderCount: 0, git: false, label: 0, reviewChanges: false, scope: "space" } };
    },
    "runs.start": (i) => {
      const k = String(i["idempotencyKey"]);
      const had = runKeys.get(k);
      if (had) return { runId: had };
      const runId = `run_mrun${(++seq).toString(36)}`;
      runKeys.set(k, runId);
      runs.set(runId, { kind: String(i["kind"]), status: "running" });
      return { runId };
    },
    "runs.finish": (i) => {
      const r = runs.get(String(i["runId"]));
      if (r) { r.status = String(i["status"]); if (i["summary"]) r.summary = String(i["summary"]); if (i["error"]) r.error = i["error"] as Rec; }
      return { run: runRow(String(i["runId"]), String(i["status"]), i["summary"] ? { summary: i["summary"] } : {}) };
    },
    "runs.get": (i) => {
      const r = runs.get(String(i["runId"]));
      if (!r) throw err("validation.not_found", "No such run.");
      return { run: runRow(String(i["runId"]), r.status, r.summary ? { summary: r.summary } : {}) };
    },
    "tasks.create": (i) => ({
      task: {
        id: `tsk_m${++seq}`, kind: "work", title: i["title"], state: "todo", assigned: i["assigned"], actions: [], blocked: false, blocks: [], createdAt: NOW, createdBy: MAYA, dependsOn: [], fileIds: [],
        followers: [], reviewLoops: 0, updatedAt: NOW, workingNotes: {}, ...(i["recordId"] ? { recordId: i["recordId"] } : {}),
      },
    }),
  };

  const ctx: MeetCtx = {
    space: "spc_meet",
    principal: { kind: "person", id: MAYA },
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
    log: { info() {}, warn() {} },
  };

  return {
    ctx, emitted, called, store, contacts, unsure, runs, calendar,
    script(cap: string, fn: Script): void { scripts.set(cap, fn); },
    actAs(kind: "person" | "agent" | "service", id: string) { ctx.principal = { kind, id }; },
    advance(ms: number) { clock += ms; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    fields(id: string): Rec { return (store.get(id) as StoredRecord).fields; },
    err,
  };
}

export type Harness = ReturnType<typeof harness>;

export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const d = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!d) return [`${cap} is not in the registry`];
  return validate(side === "in" ? d.input : d.output, value, "", registry.$defs);
}

export const codeOf = (err: unknown): string => (err as { error?: { code?: string } } | null)?.error?.code ?? "";

/** Errors of an event payload against the frozen contract of the event. */
export function eventErrors(name: string, payload: unknown): string[] {
  const e = registry.events.find((x) => x.name === name);
  if (!e) return [`${name} is not in the registry`];
  return validate(e.payload, payload, "", registry.$defs);
}

export async function refusedWith(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return codeOf(e);
  }
  throw new Error("expected a refusal");
}
