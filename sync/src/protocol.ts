// The sync protocol, frozen (ARCH 5.1 to 5.9, F8). Server-authoritative op log sync on the event log; this file is the wire contract both sides compile against: the types, a validator for
// every message that crosses the network, and `decideMode`, the one function that answers a hello. Nothing here touches a database or a socket.
// Changing a shape here is a protocol change: bump PROTOCOL_VERSION and the registry hash rules (5.2) decide who must update.
import { parseHlc } from "../../lib/hlc.ts";

export const PROTOCOL_VERSION = 1;
/** Most ops in one push (5.4). */
export const MAX_PUSH_OPS = 200;
/** Default and largest page of a pull (5.3). */
export const DEFAULT_PULL_LIMIT = 2000;
export const MAX_PULL_LIMIT = 5000;
/** Most rows in one snapshot page (5.8). */
export const MAX_SNAPSHOT_PAGE = 5000;
/** Heartbeat every 15 s; a client missing them for 40 s marks the endpoint unhealthy (5.9). */
export const HEARTBEAT_MS = 15_000;
export const HEARTBEAT_DEAD_MS = 40_000;

// ---- terms ----

export type DeviceClass = "desktop" | "phone" | "web";
export const DEVICE_CLASSES: readonly DeviceClass[] = Object.freeze(["desktop", "phone", "web"] as const);
export type CapName = string;

/** The error a rejected op carries (the full VyreError lives in contracts; sync needs only these). */
export interface SyncError { code: string; message: string; details?: unknown }

// ---- handshake (5.2) ----

export interface Hello {
  deviceId: string;
  deviceClass: DeviceClass;
  appVersion: string;
  registryHash: string;
  cursor: number;
  epoch: number;
  /** Schema versions of the entities this replica holds. */
  replica: { entities: Record<string, number> };
}
/** `update_required` makes the client read-only; `resync` drops the replica and takes a snapshot; `purge` is revocation (5.7). */
export type Mode = "live" | "update_required" | "resync" | "purge";
export const MODES: readonly Mode[] = Object.freeze(["live", "update_required", "resync", "purge"] as const);
export interface HelloOk { serverVersion: string; epoch: number; serverHlc: string; mode: Mode; head: number; entityVersions: Record<string, number> }

// ---- pull (5.3) ----

export interface PullReq { cursor: number; epoch: number; limit?: number; entities?: string[] }
/** `v` is ciphertext when `enc` is set. */
export interface FieldVal { v: unknown; hlc: string; actor: string; enc?: { key: string; nonce: string } }
export type ChangeOp = "upsert" | "patch" | "delete";
export interface Change { seq: number; entity: string; id: string; op: ChangeOp; fields: Record<string, FieldVal>; trace?: string }
/** A row left the person's view: delete locally, FTS and docs included. */
export interface Hide { entity: string; id: string; seq: number }
export interface ConflictNotice { id: string; entity: string; rowId: string; field: string; state: "open" | "resolved"; opId?: string }
export interface RejectedOp { opId: string; error: SyncError; /** the values, so the person can copy them out */ copyOut: unknown }
export interface PullRes {
  epoch: number;
  changes: Change[];
  hide: Hide[];
  /** The seq of the last item scanned, not only the last returned. */
  next: number;
  more: boolean;
  serverHlc: string;
  conflicts?: ConflictNotice[];
  rejected?: RejectedOp[];
  /** Present when the client must discard its replica (5.7). */
  reset?: "purge";
}

// ---- push (5.4) ----

export interface Op {
  /** uuidv7: the idempotency key, also the capability's idempotencyKey. */
  opId: string;
  /** Created when the user acted. */
  traceId: string;
  hlc: string;
  cap: CapName;
  v: number;
  entity?: string;
  id?: string;
  /** For `patch`: `{ fields: { f: value }, base: { f: seq } }`. */
  input: unknown;
  /** Per field: the seq of the field version the client saw. */
  baseSeq: Record<string, number>;
  /** Per field: opId of this device's previous queued op on that field (no self-conflict). */
  after?: Record<string, string>;
  enc?: { key: string; nonce: string };
}
export interface PushReq { deviceId: string; epoch: number; ops: Op[] }
export interface PushRes {
  applied: { opId: string; seq: number }[];
  rejected: RejectedOp[];
  conflicts: ConflictNotice[];
  held: { opId: string; taskId: string }[];
  serverHlc: string;
}

// ---- snapshots (5.8) ----

export interface SnapshotBeginReq { entities: string[]; deviceClass: DeviceClass }
export interface SnapshotBeginRes { asOfSeq: number; plan: { entity: string; estimatedRows: number }[] }

// ---- live frames (5.9) ----

export type Frame =
  | { t: "hello"; hello: Hello }
  | { t: "hello_ok"; ok: HelloOk }
  | { t: "hb"; seq: number }
  /** Numbered, filtered change or event items; the client acks cumulatively. */
  | { t: "ev"; seq: number; items: Change[]; hide?: Hide[] }
  | { t: "ack"; seq: number }
  | { t: "pull_hint"; seq: number }
  | { t: "turn"; turn: string; delta: unknown }
  | { t: "presence" | "typing" | "computer.frame"; data: unknown }
  | { t: "ydoc.sync1" | "ydoc.sync2" | "ydoc.update" | "ydoc.awareness"; doc: string; data: unknown }
  | { t: "purge"; epoch: number }
  | { t: "op"; op: Op };
export type FrameType = Frame["t"];
export const FRAME_TYPES: readonly FrameType[] = Object.freeze([
  "hello", "hello_ok", "hb", "ev", "ack", "pull_hint", "turn", "presence", "typing", "computer.frame", "ydoc.sync1", "ydoc.sync2", "ydoc.update", "ydoc.awareness", "purge", "op",
] as const);

// ---- validation ----

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isHlc = (v: unknown): v is string => typeof v === "string" && parseHlc(v) !== null;
const isEnc = (v: unknown): v is { key: string; nonce: string } => isObj(v) && isStr(v["key"]) && isStr(v["nonce"]);
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);
const intMap = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every(isInt);

export function parseHello(x: unknown): Parsed<Hello> {
  if (!isObj(x)) return fail("hello is an object");
  if (!isStr(x["deviceId"])) return fail("deviceId is text");
  if (!DEVICE_CLASSES.includes(x["deviceClass"] as DeviceClass)) return fail("deviceClass is desktop, phone or web");
  if (!isStr(x["appVersion"])) return fail("appVersion is text");
  if (!isStr(x["registryHash"])) return fail("registryHash is text");
  if (!isInt(x["cursor"])) return fail("cursor is a whole number");
  if (!isInt(x["epoch"])) return fail("epoch is a whole number");
  const replica = x["replica"];
  if (!isObj(replica) || !intMap(replica["entities"])) return fail("replica.entities maps entity names to schema versions");
  return { ok: true, value: { deviceId: x["deviceId"], deviceClass: x["deviceClass"] as DeviceClass, appVersion: x["appVersion"], registryHash: x["registryHash"], cursor: x["cursor"], epoch: x["epoch"], replica: { entities: replica["entities"] } } };
}

export function parseHelloOk(x: unknown): Parsed<HelloOk> {
  if (!isObj(x)) return fail("hello_ok is an object");
  if (!isStr(x["serverVersion"])) return fail("serverVersion is text");
  if (!isInt(x["epoch"])) return fail("epoch is a whole number");
  if (!isHlc(x["serverHlc"])) return fail("serverHlc is an hlc");
  if (!MODES.includes(x["mode"] as Mode)) return fail("mode is live, update_required, resync or purge");
  if (!isInt(x["head"])) return fail("head is a whole number");
  if (!intMap(x["entityVersions"])) return fail("entityVersions maps entity names to schema versions");
  return { ok: true, value: { serverVersion: x["serverVersion"], epoch: x["epoch"], serverHlc: x["serverHlc"], mode: x["mode"] as Mode, head: x["head"], entityVersions: x["entityVersions"] } };
}

/** A pull request with its defaults applied: `limit` is DEFAULT_PULL_LIMIT when absent and may not exceed MAX_PULL_LIMIT. */
export function parsePullReq(x: unknown): Parsed<PullReq & { limit: number }> {
  if (!isObj(x)) return fail("pull is an object");
  if (!isInt(x["cursor"])) return fail("cursor is a whole number");
  if (!isInt(x["epoch"])) return fail("epoch is a whole number");
  let limit = DEFAULT_PULL_LIMIT;
  if (x["limit"] !== undefined) {
    if (!isInt(x["limit"]) || x["limit"] < 1 || x["limit"] > MAX_PULL_LIMIT) return fail(`limit is 1 to ${MAX_PULL_LIMIT}`);
    limit = x["limit"];
  }
  if (x["entities"] !== undefined && !strList(x["entities"])) return fail("entities is a list of entity names");
  return { ok: true, value: { cursor: x["cursor"], epoch: x["epoch"], limit, ...(x["entities"] !== undefined ? { entities: x["entities"] as string[] } : {}) } };
}

function parseFieldVal(x: unknown, where: string): string | null {
  if (!isObj(x)) return `${where} is an object`;
  if (!("v" in x)) return `${where} has a value (v)`;
  if (!isHlc(x["hlc"])) return `${where}.hlc is an hlc`;
  if (!isStr(x["actor"])) return `${where}.actor is text`;
  if (x["enc"] !== undefined && !isEnc(x["enc"])) return `${where}.enc is { key, nonce }`;
  return null;
}

export function parseChange(x: unknown): Parsed<Change> {
  if (!isObj(x)) return fail("a change is an object");
  if (!isInt(x["seq"])) return fail("seq is a whole number");
  if (!isStr(x["entity"]) || !isStr(x["id"])) return fail("a change names its entity and id");
  if (x["op"] !== "upsert" && x["op"] !== "patch" && x["op"] !== "delete") return fail("op is upsert, patch or delete");
  if (!isObj(x["fields"])) return fail("fields is an object");
  for (const [k, v] of Object.entries(x["fields"])) { const e = parseFieldVal(v, `fields.${k}`); if (e) return fail(e); }
  if (x["op"] === "delete" && Object.keys(x["fields"]).length) return fail("a delete carries no fields");
  if (x["trace"] !== undefined && !isStr(x["trace"])) return fail("trace is text");
  return { ok: true, value: x as unknown as Change };
}

const parseHide = (x: unknown): string | null => (isObj(x) && isStr(x["entity"]) && isStr(x["id"]) && isInt(x["seq"]) ? null : "a hide names entity, id and seq");
const parseRejected = (x: unknown): string | null => (isObj(x) && isStr(x["opId"]) && isObj(x["error"]) && isStr(x["error"]["code"]) && typeof x["error"]["message"] === "string" && "copyOut" in x ? null : "a rejected op has opId, error and copyOut");
const parseConflict = (x: unknown): string | null => (isObj(x) && isStr(x["id"]) && isStr(x["entity"]) && isStr(x["rowId"]) && isStr(x["field"]) && (x["state"] === "open" || x["state"] === "resolved") ? null : "a conflict notice has id, entity, rowId, field and state");

export function parsePullRes(x: unknown): Parsed<PullRes> {
  if (!isObj(x)) return fail("pull result is an object");
  if (!isInt(x["epoch"])) return fail("epoch is a whole number");
  if (!Array.isArray(x["changes"])) return fail("changes is a list");
  let last = -1;
  for (const c of x["changes"]) {
    const p = parseChange(c);
    if (!p.ok) return fail(`changes: ${p.error}`);
    if (p.value.seq < last) return fail("changes are ordered by seq");
    last = p.value.seq;
  }
  if (!Array.isArray(x["hide"])) return fail("hide is a list");
  for (const h of x["hide"]) { const e = parseHide(h); if (e) return fail(e); }
  if (!isInt(x["next"])) return fail("next is a whole number");
  if (last > x["next"]) return fail("next is at least the seq of the last change returned");
  if (typeof x["more"] !== "boolean") return fail("more is true or false");
  if (!isHlc(x["serverHlc"])) return fail("serverHlc is an hlc");
  if (x["conflicts"] !== undefined) { if (!Array.isArray(x["conflicts"])) return fail("conflicts is a list"); for (const c of x["conflicts"]) { const e = parseConflict(c); if (e) return fail(e); } }
  if (x["rejected"] !== undefined) { if (!Array.isArray(x["rejected"])) return fail("rejected is a list"); for (const r of x["rejected"]) { const e = parseRejected(r); if (e) return fail(e); } }
  if (x["reset"] !== undefined && x["reset"] !== "purge") return fail("reset is purge");
  return { ok: true, value: x as unknown as PullRes };
}

export function parseOp(x: unknown): Parsed<Op> {
  if (!isObj(x)) return fail("an op is an object");
  if (!isStr(x["opId"])) return fail("opId is text");
  if (!isStr(x["traceId"])) return fail("traceId is text");
  if (!isHlc(x["hlc"])) return fail("hlc is an hlc");
  if (!isStr(x["cap"])) return fail("cap names a capability");
  if (!isInt(x["v"]) || x["v"] < 1) return fail("v is the capability version");
  if (x["entity"] !== undefined && !isStr(x["entity"])) return fail("entity is text");
  if (x["id"] !== undefined && !isStr(x["id"])) return fail("id is text");
  if (!("input" in x)) return fail("an op has an input");
  if (!intMap(x["baseSeq"])) return fail("baseSeq maps fields to seqs");
  if (x["after"] !== undefined && !(isObj(x["after"]) && Object.values(x["after"]).every(isStr))) return fail("after maps fields to opIds");
  if (x["enc"] !== undefined && !isEnc(x["enc"])) return fail("enc is { key, nonce }");
  return { ok: true, value: x as unknown as Op };
}

export function parsePushReq(x: unknown): Parsed<PushReq> {
  if (!isObj(x)) return fail("push is an object");
  if (!isStr(x["deviceId"])) return fail("deviceId is text");
  if (!isInt(x["epoch"])) return fail("epoch is a whole number");
  if (!Array.isArray(x["ops"])) return fail("ops is a list");
  if (x["ops"].length > MAX_PUSH_OPS) return fail(`a push carries at most ${MAX_PUSH_OPS} ops`);
  const seen = new Set<string>();
  for (const o of x["ops"]) {
    const p = parseOp(o);
    if (!p.ok) return fail(`ops: ${p.error}`);
    if (seen.has(p.value.opId)) return fail("an opId appears once in a push");
    seen.add(p.value.opId);
  }
  return { ok: true, value: x as unknown as PushReq };
}

export function parsePushRes(x: unknown): Parsed<PushRes> {
  if (!isObj(x)) return fail("push result is an object");
  if (!Array.isArray(x["applied"]) || !x["applied"].every((a) => isObj(a) && isStr(a["opId"]) && isInt(a["seq"]))) return fail("applied is a list of { opId, seq }");
  if (!Array.isArray(x["rejected"])) return fail("rejected is a list");
  for (const r of x["rejected"]) { const e = parseRejected(r); if (e) return fail(e); }
  if (!Array.isArray(x["conflicts"])) return fail("conflicts is a list");
  for (const c of x["conflicts"]) { const e = parseConflict(c); if (e) return fail(e); }
  if (!Array.isArray(x["held"]) || !x["held"].every((h) => isObj(h) && isStr(h["opId"]) && isStr(h["taskId"]))) return fail("held is a list of { opId, taskId }");
  if (!isHlc(x["serverHlc"])) return fail("serverHlc is an hlc");
  return { ok: true, value: x as unknown as PushRes };
}

/** Any frame of the live socket. Checks the discriminator and the fields every frame of that type needs; the payload of ephemeral frames is opaque. */
export function parseFrame(x: unknown): Parsed<Frame> {
  if (!isObj(x) || typeof x["t"] !== "string") return fail("a frame is an object with a type (t)");
  const t = x["t"] as FrameType;
  if (!FRAME_TYPES.includes(t)) return fail(`unknown frame ${String(x["t"])}`);
  switch (t) {
    case "hello": { const p = parseHello(x["hello"]); return p.ok ? { ok: true, value: { t, hello: p.value } } : p; }
    case "hello_ok": { const p = parseHelloOk(x["ok"]); return p.ok ? { ok: true, value: { t, ok: p.value } } : p; }
    case "hb": case "ack": case "pull_hint": return isInt(x["seq"]) ? { ok: true, value: { t, seq: x["seq"] } } : fail(`${t} carries seq`);
    case "ev": {
      if (!isInt(x["seq"]) || !Array.isArray(x["items"])) return fail("ev carries seq and items");
      for (const c of x["items"]) { const p = parseChange(c); if (!p.ok) return fail(`ev items: ${p.error}`); }
      if (x["hide"] !== undefined) { if (!Array.isArray(x["hide"])) return fail("hide is a list"); for (const h of x["hide"]) { const e = parseHide(h); if (e) return fail(e); } }
      return { ok: true, value: x as unknown as Frame };
    }
    case "turn": return isStr(x["turn"]) ? { ok: true, value: x as unknown as Frame } : fail("turn names the turn");
    case "presence": case "typing": case "computer.frame": return { ok: true, value: x as unknown as Frame };
    case "ydoc.sync1": case "ydoc.sync2": case "ydoc.update": case "ydoc.awareness": return isStr(x["doc"]) ? { ok: true, value: x as unknown as Frame } : fail("ydoc frames name the doc");
    case "purge": return isInt(x["epoch"]) ? { ok: true, value: { t, epoch: x["epoch"] } } : fail("purge carries the epoch");
    case "op": { const p = parseOp(x["op"]); return p.ok ? { ok: true, value: { t, op: p.value } } : p; }
  }
}

// ---- the handshake decision (5.2, 5.7) ----

export interface ServerState {
  serverVersion: string;
  epoch: number;
  head: number;
  serverHlc: string;
  /** The registry hash the server runs. */
  registryHash: string;
  /** Registry hashes of releases a client may still run in `live` mode (the server keeps the ones its incremental DDL events can bridge). Anything else older is update_required. */
  compatibleRegistryHashes: readonly string[];
  /** Hashes the server has seen and knows are older than its own: these get update_required rather than resync. */
  olderRegistryHashes: readonly string[];
  entityVersions: Record<string, number>;
  /** Entities whose schema moved in a way incremental DDL events cannot bridge since the client's version. */
  breakingEntities?: readonly string[];
}

/**
 * Answer a hello. Order matters: a lower epoch is revocation and beats everything (purge); an older client registry hash makes the client read-only (update_required);
 * schema drift beyond incremental DDL, or a cursor ahead of the server's head, means start over (resync); otherwise live.
 */
export function decideMode(hello: Hello, s: ServerState): HelloOk {
  const hashOk = hello.registryHash === s.registryHash || s.compatibleRegistryHashes.includes(hello.registryHash);
  let mode: Mode = "live";
  if (hello.epoch < s.epoch) mode = "purge";
  else if (!hashOk && s.olderRegistryHashes.includes(hello.registryHash)) mode = "update_required";
  else if (!hashOk || hello.cursor > s.head) mode = "resync";
  else {
    const broken = new Set(s.breakingEntities ?? []);
    for (const [entity, v] of Object.entries(hello.replica.entities)) {
      const now = s.entityVersions[entity];
      if (now === undefined || v > now || (v < now && broken.has(entity))) { mode = "resync"; break; }
    }
  }
  return { serverVersion: s.serverVersion, epoch: s.epoch, serverHlc: s.serverHlc, mode, head: s.head, entityVersions: s.entityVersions };
}
