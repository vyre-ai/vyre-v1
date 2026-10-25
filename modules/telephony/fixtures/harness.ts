// Test harness for the telephony handlers: an in-memory database, a recording ctx and the other modules telephony calls (twilio, contacts, inbox, files, tasks, settings, access) as scripted
// capabilities. Every call a handler makes is checked against the callee's frozen input schema, as the invoke pipeline would; every answer the script gives is checked against its output
// schema; every event a handler emits is checked against the event's payload schema. A capability nobody scripted fails loudly, so a test names every call the handler may make.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { HostError } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { TelCtx } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;   // a Tuesday, 2025-10-09 08:53 UTC
export const TRACE = "0123456789abcdef0123456789abcdef";
export const MAYA = "usr_maya0001";
export const ROB = "usr_rob00002";
export const AGENT = "agt_intake01";
export const NUM_E164 = "+14155550123";
export const CALLER = "+14155550177";
export const CALL_SID = "CA00000000000000000000000000000005";
export const REC_SID = "RE00000000000000000000000000000006";
export const NUM_SID = "PN00000000000000000000000000000003";
export const SMS_SID = "SM00000000000000000000000000000012";
export const VOICE_URL = "https://space.example.test/hooks/twilio/voice";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown>; vis?: string | undefined }
export interface Called { cap: string; input: Record<string, unknown> }
type Script = (input: Record<string, unknown>) => unknown;
type Rec = Record<string, unknown>;

export function harness() {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const scheduled: { at: number; cap: string; input: Record<string, unknown> }[] = [];
  let clock = NOW;
  const settings = new Map<string, unknown>();
  const contacts = new Map<string, string>();                 // phone to record id (a sure match)
  const prefs = new Map<string, Rec>();                       // contact id to preferences
  const suppressed = new Map<string, { address: string; reason: string }[]>();   // channel to rows
  const groups = new Map<string, { kind: string; id: string }[]>();
  const gone = new Set<string>();                             // record ids that no longer exist
  const scripts = new Map<string, Script>();
  const owned: Rec[] = [];
  let files = 0;

  const err = (code: string, message: string): HostError => fail(code as never, TRACE, { message });

  const defaults: Record<string, Script> = {
    "settings.get": (i) => {
      const key = String(i["key"]);
      if (!settings.has(key)) throw err("validation.not_found", "No such setting.");
      return { row: { key, title: key, page: "comms", scope: "space", source: "space", default: null, floorable: false, value: settings.get(key) } };
    },
    "contacts.resolve": (i) => {
      const id = contacts.get(String(i["phone"] ?? ""));
      return { sure: id ? [{ recordId: id, type: "contact", name: "Pat Lee", via: "phone", score: 1 }] : [], unsure: [] };
    },
    "contacts.suppression.check": (i) => {
      const rows = suppressed.get(String(i["channel"])) ?? [];
      return { suppressed: rows.filter((r) => (i["addresses"] as string[]).includes(r.address)) };
    },
    "contacts.suppression.add": (i) => {
      const rows = suppressed.get(String(i["channel"])) ?? [];
      for (const a of i["addresses"] as string[]) rows.push({ address: a, reason: String(i["reason"]) });
      suppressed.set(String(i["channel"]), rows);
      return { added: (i["addresses"] as string[]).length, rows: [] };
    },
    "contacts.preferences.get": (i) => {
      const id = String(i["contactId"]);
      if (gone.has(id)) throw err("validation.not_found", "No such record.");
      return { emailConsent: "unknown", smsConsent: "unknown", doNotContact: false, optedOut: [], ...(prefs.get(id) ?? {}) };
    },
    "contacts.apply_optout": (i) => {
      const rows = suppressed.get(String(i["channel"])) ?? [];
      rows.push({ address: String(i["address"]), reason: "stop" });
      suppressed.set(String(i["channel"]), rows);
      const id = contacts.get(String(i["address"]));
      return { suppressionId: "sup_1", ...(id ? { contactId: id } : {}) };
    },
    "inbox.link_message": (i) => {
      const id = contacts.get(String(i["address"]));
      return { conversationId: "cnv_1", ...(id ? { contactId: id, linked: "sure" } : { linked: "none" }) };
    },
    "tasks.create": (i) => ({
      task: {
        id: "tsk_call0001", kind: "work", title: i["title"], state: "todo", assigned: i["assigned"], actions: [], blocked: false, blocks: [], createdAt: NOW, createdBy: MAYA, dependsOn: [],
        fileIds: [], followers: [], reviewLoops: 0, updatedAt: NOW, workingNotes: {}, ...(i["recordId"] ? { recordId: i["recordId"] } : {}), ...(i["source"] ? { source: i["source"] } : {}),
      },
    }),
    "access.groups.get": (i) => {
      const members = groups.get(String(i["groupId"]));
      if (!members) throw err("validation.not_found", "No such group.");
      return { group: { id: i["groupId"], name: "Front desk", members, managers: [], builtIn: false }, roles: [], grants: [] };
    },
    "files.tree": () => ({ roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_personal", count: 0 }, { key: "shared_knowledge", title: "Shared knowledge", kind: "folder", folderId: "fld_knowledge1", count: 0 }] }),
    "files.folder.create": () => ({ folder: { folderId: "fld_calls0001", name: "Calls", path: "Shared knowledge/Calls", fileCount: 0, folderCount: 0, git: false, label: 0, reviewChanges: false, scope: "space" } }),
    "files.create": (i) => ({
      file: {
        fileId: `fil_rec${++files}`, folderId: i["folderId"], name: i["name"], kind: "audio", mime: "audio/mpeg", size: 2001, version: 1, label: 0, ownerId: MAYA, createdAt: NOW, updatedAt: NOW,
        updatedBy: MAYA, thumb: false, holds: 0,
      },
    }),
    "twilio.number.list_owned": () => ({ numbers: owned }),
    "twilio.number.search": () => ({ available: [{ e164: "+14155550199", locality: "San Francisco", region: "CA", capabilities: ["voice", "sms"] }] }),
    "twilio.number.buy": (i) => ({ number: { sid: NUM_SID, e164: i["e164"], friendlyName: i["friendlyName"], capabilities: ["voice", "sms", "mms"] } }),
    "twilio.number.configure": (i) => ({ number: { sid: i["sid"], e164: NUM_E164, capabilities: ["voice", "sms"] } }),
    "twilio.number.release": () => ({ released: true }),
    "twilio.call.create": () => ({ sid: CALL_SID }),
    "twilio.call.update": () => ({ status: "in-progress" }),
    "twilio.recording.start": () => ({ recordingSid: REC_SID }),
    "twilio.recording.stop": () => ({ stopped: true }),
    "twilio.recording.download": () => ({ blobId: "blb_00000000000000000000000000000001", size: 2001, durationSec: 17 }),
    "twilio.sms.send": () => ({ sid: SMS_SID, status: "queued" }),
    "twilio.access_token": () => ({ token: "token.not.real", expiresAt: NOW + 3_600_000 }),
    "twilio.a2p.create_brand": () => ({ brandSid: "BN00000000000000000000000000000007", status: "pending" }),
    "twilio.a2p.create_campaign": () => ({ campaignSid: "QE00000000000000000000000000000009", status: "pending" }),
    "twilio.a2p.status": () => ({ brand: "pending", campaign: "pending" }),
  };

  const ctx: TelCtx = {
    space: "spc_tel",
    principal: { kind: "person", id: MAYA },
    trace: { traceId: TRACE },
    origin: "user",
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload, opts) {
      const misfit = eventErrors(name, payload);
      if (misfit.length) throw new Error(`${name} was emitted with a payload its contract refuses: ${misfit.join("; ")}`);
      emitted.push({ name, subject, payload: payload as Record<string, unknown>, vis: opts?.vis });
      return null;
    },
    async call(cap, input) {
      const body = (input ?? {}) as Record<string, unknown>;
      called.push({ cap, input: body });
      const misfit = contractErrors(cap, "in", body);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      const script = scripts.get(cap) ?? defaults[cap];
      if (!script) throw new Error(`unscripted capability ${cap}`);
      const out = script(body);
      const bad = contractErrors(cap, "out", out);
      if (bad.length) throw new Error(`the script for ${cap} answered something its contract refuses: ${bad.join("; ")}`);
      return out;
    },
    async schedule(at, cap, input) {
      scheduled.push({ at, cap, input: input as Record<string, unknown> });
      return `sch_${scheduled.length}`;
    },
    log: { info() {}, warn() {} },
  };

  return {
    ctx, emitted, called, scheduled, settings, contacts, prefs, suppressed, groups, owned, gone,
    /** Replace what a capability answers. A thrown HostError is the callee refusing. */
    script(cap: string, fn: Script): void { scripts.set(cap, fn); },
    advance(ms: number) { clock += ms; },
    setNow(ms: number) { clock = ms; },
    actAs(kind: "person" | "agent" | "service", id: string, origin = "user") { ctx.principal = { kind, id }; ctx.origin = origin; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    err,
  };
}

export type Harness = ReturnType<typeof harness>;

function def(cap: string) {
  return registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
}

/** Errors of a value against the frozen contract of a capability (its input or output schema); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const d = def(cap);
  if (!d) return [`${cap} is not in the registry`];
  return validate(side === "in" ? d.input : d.output, value, "", registry.$defs);
}

/** Errors of an event payload against the frozen contract of the event. */
export function eventErrors(name: string, payload: unknown): string[] {
  const e = registry.events.find((x) => x.name === name);
  if (!e) return [`${name} is not in the registry`];
  return validate(e.payload, payload, "", registry.$defs);
}

export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}

/** Run a promise that must be refused and give the error code it was refused with. */
export async function refusedWith(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return codeOf(e);
  }
  throw new Error("expected a refusal");
}
