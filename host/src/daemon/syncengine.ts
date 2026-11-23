// The connectors sync engine (packet P-H_09). The connectors module (modules/connectors) takes a `SyncEngine` through `setSyncEngine`; the engine itself is the library in modules/sources
// (runSync, flushOutbox, undoPush, confirmDeletes, resolveConflict), one engine over any two Stores. Modules are leaves (boundary B1) and host never imports a module, so the daemon
// takes the sources module's exports as `core` and builds the adapter here: the Space store on one side and, on the other, a Store made of one connection's actions.
//
// The remote Store. A connector exposes a synced object through its actions, by name: `list_<remote>` (and `list_<remote>_after` with `{ after }` for the next page), `create_<one>` and
// `update_<one>` taking `{ properties }` (and `{ id, properties }`), `delete_<one>` taking `{ id }`, where <one> is the object name without its trailing "s" (HubSpot: list_contacts,
// create_contact). A connector spec may override the names with an explicit per-object map, `objects: { contact: { list, listAfter, create, update, delete } }`, read from the connector
// row (`connectors.get`); any name it leaves out keeps the convention, so no connector is forced into HubSpot naming. A list answer is either `{ results: [{ id, properties, archived? }], paging: { next: { after } } }` (HubSpot's shape) or `{ rows: [{ id, data }], next }`. Every call goes
// through the capability API (`connectors.run`), so the Vault, the egress list, the rate limit and the audit apply as for any other call. Remote records carry no version, so a write
// never fails on one. A row the app marks archived reads as removed.
import { turns } from "../../../lib/yield-loop.ts";

import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import { hasWords } from "../../../lib/words.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { Page, QuerySpec, Store, StoredRecord } from "../../../kernel/src/store/types.ts";

/** Work between two turns while sealed values are kept: short, because each value waits for the Vault (a key derivation, a write) and the stretch before the loop is already one block. */
const SEAL_TURN_MS = 5;

// ---- what the engine takes from the connectors module (structural copies; the module's own types are not importable here)

export interface BindingRow {
  /** The account of an app the binding reads (several accounts of one app share a record type). */
  account?: string;
  syncTypeId: string;
  type: string;
  connector: string;
  connectionId: string;
  remote: string;
  fields: {
    key: string;
    remote: string;
    dir: "pull" | "push" | "both" | "off";
    transform?: string;
    relation?: string;
    inverse?: string;
    constant?: string;
    sealed?: boolean;
  }[];
  match: string[];
  createAtSource: boolean;
  deletes: "off" | "soft" | "travel";
  conflict: "newest" | "source" | "vyre" | "ask";
  /** The binding's polling: `sweepSec` is how often the whole list is read to find what the app deleted. */
  polling?: { sweepSec?: number };
}
export interface RunOut {
  summary: string;
  pulled: number;
  pushed: number;
  skipped: number;
  conflicts: number;
  dryRun: boolean;
  /** A big first pull goes a group of pages at a time: true while pages are left, so the caller runs the next group soon. */
  more?: boolean;
}
export interface EngineCtx {
  trace: { traceId: string };
  call(cap: string, input: unknown): Promise<unknown>;
  emit(name: string, subject: string, payload: Record<string, unknown>): unknown;
}
export interface PreviewOut {
  creates: number;
  updates: number;
  removes: number;
  skips: number;
  summary: string;
  matches?: { sure: number; unsure: number; none: number };
  samples: { recordId?: string; remoteId?: string; op: string; changes: Record<string, unknown> }[];
}
export interface SyncEngineLike {
  /** One pass over a synced type: pull, push what people changed, report. Mode backfill and reconcile are the same pass as incremental; the list the connector asks for is what differs. */
  run(
    ctx: EngineCtx,
    b: BindingRow,
    o: { mode: "incremental" | "reconcile" | "backfill" | "dry_run"; runAutomations?: boolean; by?: string },
  ): Promise<RunOut>;
  preview(ctx: EngineCtx, b: BindingRow, o: { direction?: "pull" | "push" | "both" }): Promise<PreviewOut>;
  confirmDeletes(ctx: EngineCtx, b: BindingRow, decision: "mark_removed" | "keep"): Promise<number>;
  resolveConflict(
    ctx: EngineCtx,
    b: BindingRow,
    conflictId: string,
    resolution: "ours" | "theirs" | "value",
    value?: unknown,
  ): Promise<{ recordId: string }>;
  replayConflict(
    ctx: EngineCtx,
    b: BindingRow,
    conflictId: string,
  ): Promise<{ rule: BindingRow["conflict"]; value: unknown }[]>;
  undoPush(ctx: EngineCtx, b: BindingRow, outboxId: string): Promise<{ undone: boolean; reason?: string }>;
  push(ctx: EngineCtx, b: BindingRow, outboxId: string): Promise<{ state: "sent" | "failed"; error?: string }>;
}

/** The sources module's engine functions, as the daemon finds them in its exports. */
export interface SyncDepsLike {
  local: Store;
  remote: Store;
  tx: Tx;
  now?: () => number;
  space?: string;
  emit?: (name: string, subject: string, payload: Record<string, unknown>) => unknown;
}
export interface SyncBindingLike {
  syncTypeId: string;
  type: string;
  remote: string;
  connector: string;
  label?: string;
  fields: {
    local: string;
    remote: string;
    direction: "pull" | "push" | "both" | "off";
    transform?: string;
    relation?: { syncTypeId: string; type: string; inverse?: string };
    constant?: string;
  }[];
  match: string[];
  createAtSource: boolean;
  deletes: boolean;
  conflict: BindingRow["conflict"];
}
export interface SyncReportLike {
  local: { created: number; updated: number };
  remote: { created: number; updated: number; removed: number };
  matched: number;
  ambiguous: number;
  conflicts: number;
  askedConflicts: number;
  removedAtSource: number;
  pausedDeletes: boolean;
  skipped?: number;
  summary: string;
}
export interface SyncCore {
  runSync(
    d: SyncDepsLike,
    b: SyncBindingLike,
    o?: {
      mode?: "pull" | "push" | "both";
      dryRun?: boolean;
      runAutomations?: boolean;
      traceId?: string;
      by?: string;
      partial?: StoredRecord[];
      pushLocalSince?: number;
      sweepSeen?: Set<string>;
    },
  ): Promise<SyncReportLike>;
  flushOutbox(d: SyncDepsLike, b: SyncBindingLike): Promise<number>;
  retryPush(d: SyncDepsLike, outboxId: string): boolean;
  undoPush(d: SyncDepsLike, b: SyncBindingLike, outboxId: string): Promise<{ undone: boolean; reason?: string }>;
  confirmDeletes(d: SyncDepsLike, b: SyncBindingLike, decision: "mark_removed" | "keep"): number;
  resolveConflict(
    d: SyncDepsLike,
    b: SyncBindingLike,
    conflictId: string,
    resolution: "ours" | "theirs" | "value",
    value?: unknown,
  ): Promise<{ recordId: string }>;
}

/** Reads the engine core out of a module namespace, or says what is missing. */
export function coreOf(ns: Record<string, unknown> | undefined): SyncCore {
  if (!ns) throw new Error("The sources module is not available, so there is no sync engine to build.");
  for (const n of ["runSync", "flushOutbox", "retryPush", "undoPush", "confirmDeletes", "resolveConflict"]) {
    if (typeof ns[n] !== "function")
      throw new Error(`The sources module does not export ${n}, so there is no sync engine to build.`);
  }
  return ns as unknown as SyncCore;
}

/** The Space store, opened when first needed (after boot, once every module has named its projections). */
export interface LocalSide {
  open(): { store: Store; tx: Tx };
  space?: string;
}

// ---- the remote Store over one connection

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = (remote: string): string => (remote.endsWith("s") && remote.length > 1 ? remote.slice(0, -1) : remote);
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x,
  );

interface RemoteRow {
  id: string;
  data: Record<string, unknown>;
  archived: boolean;
  updatedAt: number;
}

/** One page out of a list answer, in either shape. */
export function readRows(output: unknown): { rows: RemoteRow[]; next?: string; skipped?: string[] } {
  if (!isObj(output)) throw new Error("The app did not answer with a list.");
  const list = Array.isArray(output["results"])
    ? output["results"]
    : Array.isArray(output["rows"])
      ? output["rows"]
      : null;
  if (!list) throw new Error("The app did not answer with a list of results.");
  const rows = list.map((r, i): RemoteRow => {
    if (!isObj(r) || (typeof r["id"] !== "string" && typeof r["id"] !== "number"))
      throw new Error(`Result ${i} has no id.`);
    const data = isObj(r["properties"]) ? r["properties"] : isObj(r["data"]) ? r["data"] : null;
    if (!data) throw new Error(`Result ${i} has no properties.`);
    const stamp = r["updatedAt"] ?? data["hs_lastmodifieddate"];
    const at = typeof stamp === "string" ? Date.parse(stamp) : typeof stamp === "number" ? stamp : 0;
    return {
      id: String(r["id"]),
      data: { ...data },
      archived: r["archived"] === true,
      updatedAt: Number.isFinite(at) ? at : 0,
    };
  });
  const paging = output["paging"];
  const after = isObj(paging) && isObj(paging["next"]) ? paging["next"]["after"] : output["next"];
  const skipped = Array.isArray(output["skipped"])
    ? output["skipped"].filter((x): x is string => typeof x === "string")
    : [];
  return {
    rows,
    ...(typeof after === "string" && after !== "" ? { next: after } : {}),
    ...(skipped.length ? { skipped } : {}),
  };
}

export interface LinkDef {
  from: { type: string; at: string };
  to: { type: string; at: string };
  key: string;
  inverseKey: string;
}
/** A condition on a value (the =when: form): one of `e`, or matching the pattern `m`, turned round by `n`. */
export interface WhenCond {
  e?: string[];
  m?: string[];
  n?: boolean;
}
/** A per-parent list: read under each record of `remote`. `scoped` is on unless it is false: the child's id gets the parent's in front. `where` keeps only the parents that meet it. `changed` reads a parent's children again only when its version moved. */
export interface EachOf {
  remote: string;
  scoped?: boolean;
  where?: WhenCond & { path: string };
  changed?: { path: string } | { object: string; parentAt: string; at: string };
}
/** Does the value meet the condition (case and surrounding spaces do not matter; a masked value never does)? */
export function holdsWhen(have: unknown, c: WhenCond): boolean {
  const present = have !== undefined && have !== null && have !== "[sealed]";
  const text = present ? String(have).trim() : "";
  const hit =
    present &&
    (c.e !== undefined
      ? c.e.some((v) => v.trim().toLowerCase() === text.toLowerCase())
      : c.m !== undefined && hasWords(text, c.m));
  return c.n === true ? !hit : hit;
}
/** The next place of a list walk, or none when the walk is over: an empty page ends it whatever it says comes next, and so does a next that is the place just read. One rule for every list (flat, list_after, per parent). */
export function nextPlace(
  got: { rows: unknown[]; next?: string; skipped?: string[] },
  after: string | undefined,
): string | undefined {
  // a page whose items were all left out is not an empty page: there may be more
  if (got.next === undefined || (got.rows.length === 0 && !got.skipped?.length) || got.next === after) return undefined;
  return got.next;
}
export interface ObjectNames {
  list?: string;
  listAfter?: string;
  create?: string;
  update?: string;
  delete?: string;
  /** The list takes { since } and answers only what changed since. */ since?: boolean;
  /** The list opens inner arrays into rows: read as a delta list; an item left out for being too big keeps its records. */
  rows?: boolean;
  /** Each row also relates two already-synced records (a many-to-many made from join rows). */
  link?: LinkDef;
  /** The list sits under each record of this other object: it is read once per parent id, and every row carries the parent's id at /_parent. */
  eachOf?: EachOf;
}
export type ObjectMap = Record<string, ObjectNames>;

/** The names a connector spec gives one object (by the bound name, then by its singular), or none. */
export function namesFor(objects: unknown, remote: string): ObjectNames {
  if (!isObj(objects)) return {};
  const hit = objects[remote] ?? objects[oneOf(remote)];
  if (!isObj(hit)) return {};
  const out: ObjectNames = {};
  for (const k of ["list", "listAfter", "create", "update", "delete"] as const)
    if (typeof hit[k] === "string" && hit[k] !== "") out[k] = hit[k];
  if (hit["since"] === true) out.since = true;
  if (hit["rows"] === true) out.rows = true;
  const each = hit["eachOf"];
  if (isObj(each) && typeof each["remote"] === "string" && each["remote"] !== "") {
    const w = each["where"];
    const c = each["changed"];
    const cond: (WhenCond & { path: string }) | undefined =
      isObj(w) && typeof w["path"] === "string"
        ? {
            path: w["path"],
            ...(Array.isArray(w["e"]) ? { e: w["e"].map(String) } : {}),
            ...(Array.isArray(w["m"]) ? { m: w["m"].map(String) } : {}),
            ...(w["n"] === true ? { n: true } : {}),
          }
        : undefined;
    out.eachOf = {
      remote: each["remote"],
      ...(each["scoped"] === false ? { scoped: false } : {}),
      ...(cond ? { where: cond } : {}),
      ...(isObj(c) && typeof c["path"] === "string" ? { changed: { path: c["path"] } } : {}),
      ...(isObj(c) &&
      typeof c["object"] === "string" &&
      typeof c["parentAt"] === "string" &&
      typeof c["at"] === "string"
        ? { changed: { object: c["object"], parentAt: c["parentAt"], at: c["at"] } }
        : {}),
    };
  }
  const l = hit["link"];
  if (
    isObj(l) &&
    isObj(l["from"]) &&
    isObj(l["to"]) &&
    typeof l["key"] === "string" &&
    typeof l["inverseKey"] === "string" &&
    typeof l["from"]["type"] === "string" &&
    typeof l["from"]["at"] === "string" &&
    typeof l["to"]["type"] === "string" &&
    typeof l["to"]["at"] === "string"
  )
    out.link = l as unknown as LinkDef;
  return out;
}

const RATE_CODES = new Set(["rate_limit.exceeded", "provider.rate_limited"]);
/** A read that the app could not answer this time (a dropped connection, a service that is down for a moment): the same read is tried again a few times before the pass is given up. A pass over a list the app cannot filter by change is hundreds of pages; one dropped page must not lose it. */
const TRANSIENT_CODES = new Set(["provider.network", "provider.unavailable"]);
const TRANSIENT_TRIES = 4;
/** Waits in a row, with nothing answered between, before a pass gives up on an app that keeps saying slow down. */
const SLOW_DOWNS = 8;
const SLOW_DOWN_FIRST_MS = 30_000;
const SLOW_DOWN_CAP_MS = 480_000;
const pause = (ms: number): Promise<void> =>
  new Promise((ok) => {
    setTimeout(ok, ms);
  });

/** How long the connector's object names are kept before they are read again (a connector applied again is picked up within this time). */
const OBJECTS_KEPT_MS = 60_000;

/**
 * The connector's own names for its objects, read once a minute per connector (a connector row without them keeps the convention). An answer that failed is never kept: a read that failed once used to
 * leave the default names for as long as the server ran, and a connector applied again was never read again.
 */
export function objectNamesOf(
  now: () => number,
): (ctx: Pick<EngineCtx, "call">, connector: string) => Promise<unknown> {
  const maps = new Map<string, { at: number; p: Promise<unknown> }>();
  return (ctx, connector) => {
    const at = now();
    const kept = maps.get(connector);
    if (kept && at - kept.at < OBJECTS_KEPT_MS) return kept.p;
    const p = ctx.call("connectors.get", { key: connector }).then(
      (r) => {
        if (isObj(r) && isObj(r["connector"])) return r["connector"]["objects"];
        maps.delete(connector);
        return undefined;
      },
      () => {
        maps.delete(connector);
        return undefined;
      },
    );
    maps.set(connector, { at, p });
    return p;
  };
}

export interface ParentInfo {
  /** The parents whose children are read (met `where`, safe ids), sorted. */
  ids: string[];
  /** Every parent the app lists, met `where` or not: a parent that is not here any more was deleted at the app. */
  all?: string[];
  /** False when the feed that gives the versions may have been cut short: every parent is read. */
  versionsKnown?: boolean;
  ver: Record<string, string>;
}

export function remoteStore(
  ctx: Pick<EngineCtx, "call">,
  b: Pick<BindingRow, "connector" | "connectionId" | "remote">,
  objects?: unknown,
  opts: {
    sleep?: (ms: number) => Promise<void>;
    /** Tells one pass from the next: the same call in another pass is a new call, not a replay of the old answer. */ nonce?: string;
    /** The app asked Vyre to slow down: the wait in milliseconds, before it starts. */
    onSlow?: (waitMs: number) => void;
    /** A call went through again after a wait. */
    onResume?: () => void;
    /** Fields of this object that are sealed: their values are taken out of every row the moment it is read and handed to `held`, never left in the row's data. */
    sealed?: { remote: string; local: string }[];
    /** Remote keys of the form "=join:/first|/last": a title made of several parts of the row, joined with a space, empty parts left out. */
    joins?: string[];
    /** Remote keys of the form "=when:{p,w,e}": the value at p, only when the value at w is one of e (compared without case or spaces); otherwise empty. */
    whens?: string[];
    /** The process's own token that asks a list for the real values of sealed fields (nobody else has it). */
    unmaskToken?: string;
    /** The real values of sealed fields of a row, kept in this process by the connector (never in an answer). */
    heldOf?: (nonce: string, rowId: string) => Record<string, unknown> | undefined;
    heldDone?: (nonce: string) => void;
    /** The parent ids of a per-parent list kept from an earlier pass (and its versions), so a pass does not read the whole parent list again; `get` answers nothing when it is too old. */
    parentCache?: { get(): ParentInfo | undefined; set(info: ParentInfo): void };
    /** The version of a parent as it was when its children were last read (for `changed`). */
    versionOf?: (parent: string) => string | undefined;
  } = {},
): Store & {
  updatedAtOf(id: string): number;
  page(after?: string, since?: number): Promise<{ rows: StoredRecord[]; next?: string; done?: string[] }>;
  supportsSince: boolean;
  /** Said in plain words in the pass's summary: a list that stopped because it repeated itself, parents skipped. */
  notes: string[];
  skippedPrefixes: Set<string>;
  /** Versions of parents whose children were read to the end in this store's life: kept by the engine once the rows are in (for `changed`). */
  pendingVersions: Map<string, string>;
  eachOf: EachOf | undefined;
  /** The parents of a per-parent list (read once, kept between passes). */
  parentInfo(): Promise<ParentInfo>;
  lazy: boolean;
  held: Map<string, { at: number; values: Record<string, string | null> }>;
} {
  const one = oneOf(b.remote);
  const names = namesFor(objects, b.remote);
  const nameList = names.list ?? `list_${b.remote}`,
    nameAfter = names.listAfter ?? `list_${b.remote}_after`;
  const nameCreate = names.create ?? `create_${one}`,
    nameUpdate = names.update ?? `update_${one}`,
    nameDelete = names.delete ?? `delete_${one}`;
  const stamps = new Map<string, number>();
  // a pass without a nonce of its own still has one that no other pass has: what is kept for a pass (keys read from the Vault, sealed values held) is never shared between passes
  const passNonce = opts.nonce ?? `p_${globalThis.crypto.randomUUID()}`;
  const sleep = opts.sleep ?? pause;
  // A pass over thousands of records is many calls. An app (or the connection's own budget) that says slow down is waited for, not failed. The wait is what the app asked (Retry-After), or the connection's own
  // refill time; with no Retry-After the connection backs off from 30 s, doubling. Only after SLOW_DOWNS waits in a row with nothing answered does the pass give up (and then it counts as a failed pass).
  const waitOf = (e: unknown): { code?: string; ms?: number } => {
    const err = isObj(e) && isObj(e["error"]) ? e["error"] : undefined;
    const code = err && typeof err["code"] === "string" ? err["code"] : undefined;
    const details = err && isObj(err["details"]) ? err["details"] : undefined;
    const ms = details && typeof details["retryAfterMs"] === "number" ? details["retryAfterMs"] : undefined;
    return { ...(code !== undefined ? { code } : {}), ...(ms !== undefined ? { ms } : {}) };
  };
  // A per-parent list (names.eachOf) reads its parent object's list too, to learn the parent ids: those are reads like the list itself.
  const parentRemote = names.eachOf?.remote;
  const parentNames = parentRemote !== undefined ? namesFor(objects, parentRemote) : {};
  const parentList = parentNames.list ?? `list_${parentRemote}`;
  const parentAfter = parentNames.listAfter ?? `list_${parentRemote}_after`;
  const feed = names.eachOf?.changed && "object" in names.eachOf.changed ? names.eachOf.changed : undefined;
  const feedNames = feed ? namesFor(objects, feed.object) : {};
  const feedList = feedNames.list ?? `list_${feed?.object}`;
  const feedAfter = feedNames.listAfter ?? `list_${feed?.object}_after`;
  const parentReads = new Set(
    parentRemote !== undefined ? [parentList, parentAfter, ...(feed ? [feedList, feedAfter] : [])] : [],
  );
  const notes: string[] = [];
  /** Key prefixes of the items a page left out for holding too many inner items: the records under them are kept by a sweep. */
  const skippedPrefixes = new Set<string>();
  const leftOut = (ids: string[] | undefined, within: string): void => {
    for (const id of ids ?? []) {
      skippedPrefixes.add(`${within}${id}/`);
      notes.push(
        `An item (${id}) holds too many inner items and was left out; the records already held for it were kept.`,
      );
    }
  };
  const pendingVersions = new Map<string, string>();
  let slowedDowns = 0;
  const run = async (action: string, input: unknown): Promise<unknown> => {
    let transient = 0;
    for (let own = 0; ; own++) {
      try {
        // a list is a read: it does not wait at the Gate when the pass runs as an agent or the host; a write goes through connectors.run
        const reading = action === nameList || action === nameAfter || parentReads.has(action);
        const out = (await ctx.call(reading ? "connectors.read" : "connectors.run", {
          key: b.connector,
          action,
          connectionId: b.connectionId,
          input:
            opts.unmaskToken && reading
              ? {
                  ...(isObj(input) ? input : {}),
                  ...(opts.sealed?.length ? { __unmask: `${opts.unmaskToken}:${passNonce}` } : {}),
                  __keep: `${opts.unmaskToken}:${passNonce}`,
                }
              : input,
          idempotencyKey: `sync:${sha256Hex(`${b.connectionId}|${action}|${canon(input)}|${opts.nonce ?? ""}`).slice(0, 32)}`,
        })) as { output?: unknown };
        if (slowedDowns > 0) {
          slowedDowns = 0;
          opts.onResume?.();
        }
        return out.output;
      } catch (e) {
        const { code, ms } = waitOf(e);
        // only a read is repeated this way: a write that did not answer may have happened (it has its own retry through the outbox)
        if (code !== undefined && TRANSIENT_CODES.has(code) && (action === nameList || action === nameAfter)) {
          if (transient >= TRANSIENT_TRIES) throw e;
          transient++;
          await sleep(Math.min(8000, 1000 * 2 ** (transient - 1)));
          continue;
        }
        if (code === undefined || !RATE_CODES.has(code)) throw e;
        if (code === "provider.rate_limited") {
          // the app asked Vyre to slow down
          if (slowedDowns >= SLOW_DOWNS) throw e;
          slowedDowns++;
          const wait = ms ?? Math.min(SLOW_DOWN_CAP_MS, SLOW_DOWN_FIRST_MS * 2 ** (slowedDowns - 1));
          opts.onSlow?.(wait);
          await sleep(wait);
        } else {
          // the connection's own budget is spent: wait until it has room again
          if (own >= 400) throw e;
          await sleep(ms !== undefined ? Math.max(50, Math.min(ms, 60_000)) : Math.min(1500, 250 * (own + 1)));
        }
      }
    }
  };
  /** Sealed values read in this pass, by the app's id for the record: taken out of the row's data at once. */
  const held = new Map<string, { at: number; values: Record<string, string | null> }>();
  const takeSealed = (r: RemoteRow): RemoteRow["data"] => {
    const fields = opts.sealed ?? [];
    const joins = opts.joins ?? [];
    const whens = opts.whens ?? [];
    if ((!fields.length && !joins.length && !whens.length) || !isObj(r.data)) return r.data;
    const data = { ...r.data } as Record<string, unknown>;
    // the connector's answer carries "[sealed]" at sealed pointers; the real values are taken from the process's own keeping
    const real = opts.heldOf?.(passNonce, r.id);
    if (real) for (const [k, v] of Object.entries(real)) data[k] = v;
    for (const wk of whens) {
      const c = JSON.parse(wk.slice("=when:".length)) as WhenCond & { p: string; w: string };
      // a masked value ("[sealed]": the pass was not given the real one) is never taken as the plain value of a field
      data[wk] = holdsWhen(data[c.w], c) && data[c.p] !== "[sealed]" ? (data[c.p] ?? null) : null;
    }
    for (const j of joins) {
      const parts: string[] = [];
      for (const p of j.slice("=join:".length).split("|")) {
        const v = data[p];
        const t = typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
        if (t !== "") parts.push(t);
      }
      data[j] = parts.length ? parts.join(" ") : null;
    }
    if (!fields.length) return data as RemoteRow["data"];
    const values: Record<string, string | null> = {};
    // a sealed field that is conditional took its value from a pointer: that pointer's real value must not stay in the row (every conditional field at it has read it above)
    for (const f of fields)
      if (f.remote.startsWith("=when:")) delete data[(JSON.parse(f.remote.slice("=when:".length)) as { p: string }).p];
    for (const f of fields) {
      const v = data[f.remote];
      delete data[f.remote];
      // a masked value ("[sealed]": the pass was not given the real one) is left alone, never sealed
      if (v === "[sealed]") continue;
      values[f.local] =
        typeof v === "string" && v.trim() !== ""
          ? v.trim()
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : null;
    }
    held.set(r.id, { at: r.updatedAt, values });
    return data as RemoteRow["data"];
  };
  const toRecord = (r: RemoteRow, version = 1): StoredRecord => ({
    type: b.remote,
    id: r.id,
    version,
    data: takeSealed(r) as StoredRecord["data"],
    created_at: r.updatedAt,
    updated_at: r.updatedAt,
    ...(r.archived ? { deleted_at: r.updatedAt || 1 } : {}),
  });
  /** Every row of a list, page by page, ending by the one rule of nextPlace and when a page brings nothing new. */
  const walkAll = async (first: string, afterName: string): Promise<{ rows: RemoteRow[]; complete: boolean }> => {
    const out: RemoteRow[] = [];
    // complete: the app said there was no more. Any other end (a place seen again, a page that brought nothing new, an empty page that still had a next, the cap) leaves the list possibly cut short.
    let complete = false;
    const seen = new Set<string>();
    const places = new Set<string>();
    let after: string | undefined;
    do {
      const got = readRows(await run(after === undefined ? first : afterName, after === undefined ? {} : { after }));
      const fresh = got.rows.filter((r) => !seen.has(r.id));
      for (const r of fresh) seen.add(r.id);
      out.push(...fresh);
      const next = fresh.length === 0 ? undefined : nextPlace(got, after);
      if (got.next === undefined) complete = true;
      if (next !== undefined && places.has(next)) {
        notes.push("A list kept answering with a page it had given before, and was read no further.");
        break;
      }
      if (next !== undefined) places.add(next);
      after = next;
    } while (after !== undefined && out.length < 100_000);
    return { rows: out, complete };
  };
  // The parent ids of a per-parent list, in a fixed order (sorted), so a place kept between passes ("this parent, from this cursor") still means the same thing when the parents have changed.
  // Only the parents that meet `where` are listed. A parent whose id cannot go in an address (a slash, "..", ?, #) is skipped and said once.
  let parentInfo: ParentInfo | undefined;
  const parentsOf = async (): Promise<ParentInfo> => {
    if (parentInfo) return parentInfo;
    const cached = opts.parentCache?.get();
    if (cached) return (parentInfo = cached);
    const each = names.eachOf!;
    const ids: string[] = [];
    const everyone: string[] = [];
    const ver: Record<string, string> = {};
    let unsafe = 0;
    let versionsKnown = true;
    const walked = await walkAll(parentList, parentAfter);
    for (const r of walked.rows) {
      if (r.archived) continue;
      everyone.push(r.id);
      if (each.where && !holdsWhen(r.data[each.where.path], each.where)) continue;
      if (r.id === "" || r.id === "." || r.id === ".." || /[\\/?#]/.test(r.id)) {
        unsafe++;
        continue;
      }
      ids.push(r.id);
      if (each.changed && "path" in each.changed) ver[r.id] = String(r.data[each.changed.path] ?? "");
    }
    if (feed) {
      // the newest stamp the feed holds for each parent is its version
      const feedWalk = await walkAll(feedList, feedAfter);
      versionsKnown = feedWalk.complete;
      for (const r of feedWalk.rows) {
        const who = r.data[feed.parentAt];
        const at = r.data[feed.at];
        if (typeof who !== "string" || who === "") continue;
        const stamp = at === undefined || at === null ? "" : String(at);
        if (stamp > (ver[who] ?? "")) ver[who] = stamp;
      }
    }
    if (unsafe > 0) notes.push(`${unsafe} parent${unsafe === 1 ? "" : "s"} skipped: the id cannot go in an address.`);
    ids.sort();
    // a list that may have been cut short is not known: no parent counts as deleted (the sweep vouches for every child), no parent is skipped as unchanged, and nothing is kept for the next pass
    parentInfo = {
      ids,
      ...(walked.complete ? { all: everyone } : {}),
      ver,
      ...(versionsKnown ? {} : { versionsKnown: false }),
    };
    if (walked.complete && versionsKnown) opts.parentCache?.set(parentInfo);
    else notes.push("The list of parents may be cut short: nothing is removed under a parent because of it.");
    return parentInfo;
  };
  /** At most this many parents are asked for one page, so a run of parents with empty lists is not one endless call; the page then comes back empty with a place to go on from. */
  const PARENTS_PER_PAGE = 40;
  /** One page of the list. For a per-parent list the place kept is {"p": parent id, "c": the app's cursor inside that parent}; a page holds one parent's rows (or the next non-empty one's); `done` names the parents read to the end. */
  const listPage = async (
    after?: string,
    since?: number,
  ): Promise<{ rows: RemoteRow[]; next?: string; done?: string[] }> => {
    if (parentRemote === undefined) {
      const got = readRows(
        await run(after === undefined ? nameList : nameAfter, {
          ...(after === undefined ? {} : { after }),
          ...(since !== undefined ? { since } : {}),
        }),
      );
      leftOut(got.skipped, "");
      const next = nextPlace(got, after);
      if (got.next !== undefined && next === undefined && got.rows.length > 0)
        notes.push("A list answered with the place it had been asked from, and was read no further.");
      return { rows: got.rows, ...(next !== undefined ? { next } : {}) };
    }
    const info = await parentsOf();
    const parents = info.ids;
    let place: { p?: string; c?: string } = {};
    if (after !== undefined) {
      try {
        const j = JSON.parse(after) as unknown;
        if (isObj(j))
          place = {
            ...(typeof j["p"] === "string" ? { p: j["p"] } : {}),
            ...(typeof j["c"] === "string" ? { c: j["c"] } : {}),
          };
      } catch {
        /* not a place of ours: start over */
      }
    }
    let idx = 0;
    let cursor = place.c;
    if (place.p !== undefined) {
      idx = parents.indexOf(place.p);
      if (idx < 0) {
        // the parent is gone since the place was kept: go on with the next one after it
        idx = parents.findIndex((x) => x > place.p!);
        cursor = undefined;
        if (idx < 0) return { rows: [] };
      }
    }
    const changedOnly = since !== undefined && names.eachOf?.changed !== undefined && info.versionsKnown !== false;
    const here = (): string => JSON.stringify({ p: parents[idx]!, ...(cursor !== undefined ? { c: cursor } : {}) });
    const done: string[] = [];
    let asked = 0;
    while (idx < parents.length) {
      const parent = parents[idx]!;
      // a delta pass reads again only the parents whose version moved since their children were last read
      if (changedOnly && cursor === undefined && opts.versionOf?.(parent) === (info.ver[parent] ?? "")) {
        idx++;
        continue;
      }
      if (asked >= PARENTS_PER_PAGE) return { rows: [], next: here(), done };
      asked++;
      const got = readRows(
        await run(cursor === undefined ? nameList : nameAfter, {
          parent,
          ...(cursor === undefined ? {} : { after: cursor }),
        }),
      );
      // an app whose ids repeat from one parent to the next (a role id is the same on every matter) gets the parent's id in front, so one record is one row; `scoped: false` says they do not
      const rows = got.rows.map((r) => ({
        ...r,
        ...(names.eachOf?.scoped !== false ? { id: `${parent}/${r.id}` } : {}),
        data: { ...r.data, "/_parent": parent },
      }));
      leftOut(got.skipped, names.eachOf?.scoped !== false ? `${parent}/` : "");
      const more = nextPlace(got, cursor);
      if (got.next !== undefined && more === undefined && got.rows.length > 0)
        notes.push("A list answered with the place it had been asked from, and was read no further.");
      if (more === undefined) {
        done.push(parent);
        pendingVersions.set(parent, info.ver[parent] ?? "");
        idx++;
        cursor = undefined;
      } else cursor = more;
      if (rows.length > 0) return { rows, ...(idx < parents.length ? { next: here() } : {}), done };
    }
    return { rows: [], done };
  };
  // One pass reads the app's list once: a push that looks a record up uses that same listing instead of paging through the app again for every record.
  let listed: RemoteRow[] | undefined;
  async function all(): Promise<RemoteRow[]> {
    if (listed) return listed;
    const out: RemoteRow[] = [];
    let after: string | undefined;
    const seen = new Set<string>();
    const places = new Set<string>();
    do {
      const page = await listPage(after);
      // an app that ignores the page parameter answers the same page again: stop when a page brings nothing new (a per-parent list may have an empty page and more parents to go)
      const fresh = page.rows.filter((r) => !seen.has(r.id));
      for (const r of fresh) seen.add(r.id);
      out.push(...fresh);
      let next = fresh.length === 0 && (parentRemote === undefined || page.rows.length > 0) ? undefined : page.next;
      if (next !== undefined && places.has(next)) next = undefined;
      if (next !== undefined) places.add(next);
      after = next;
    } while (after !== undefined && out.length < 100_000);
    for (const r of out) stamps.set(r.id, r.updatedAt);
    listed = out;
    return out;
  }
  const unsupported = (what: string) => (): never => {
    throw new StoreError("unsupported", `A connection does not support ${what}.`);
  };
  const store: Partial<Store> = {
    async query(_type: string, spec: QuerySpec): Promise<Page<StoredRecord>> {
      const rows = (await all()).filter((r) => spec.include_deleted === true || !r.archived).map((r) => toRecord(r));
      return { rows };
    },
    async get(_type: string, id: string, opts?: { include_deleted?: boolean }): Promise<StoredRecord | null> {
      const r = (await all()).find((x) => x.id === id);
      if (!r || (r.archived && opts?.include_deleted !== true)) return null;
      return toRecord(r);
    },
    async create(_type: string, _id: string, data): Promise<StoredRecord> {
      const out = await run(nameCreate, { properties: data });
      const id =
        isObj(out) && (typeof out["id"] === "string" || typeof out["id"] === "number") ? String(out["id"]) : "";
      if (!id) throw new StoreError("unavailable", `The app did not return an id for the new ${one}.`);
      return { type: b.remote, id, version: 1, data, created_at: 0, updated_at: 0 };
    },
    async update(_type: string, id: string, patch): Promise<StoredRecord> {
      await run(nameUpdate, { id, properties: patch });
      return { type: b.remote, id, version: 1, data: patch, created_at: 0, updated_at: 0 };
    },
    async remove(_type: string, id: string): Promise<StoredRecord> {
      await run(nameDelete, { id });
      return { type: b.remote, id, version: 1, data: {}, created_at: 0, updated_at: 0, deleted_at: 1 };
    },
    restore: unsupported("restoring a removed record; the engine re-creates it from the snapshot instead") as never,
    types: async () => [],
    describe: async () => null,
    define: unsupported("changing types") as never,
    aggregate: unsupported("aggregates") as never,
    search: unsupported("search") as never,
    changes: unsupported("a change feed") as never,
    export: unsupported("export") as never,
    health: async () => ({ ok: true, checked_at: 0 }),
    version: async () => ({ store: "connection", version: "1" }),
    features: () => ({ aggregate: false, search: false, changes: false, cursor_paging: true as const }),
  };
  // One page of the app's list, for a big app pulled a page group at a time (the whole list is never held).
  const page = async (
    after?: string,
    since?: number,
  ): Promise<{ rows: StoredRecord[]; next?: string; done?: string[] }> => {
    const got = await listPage(after, since);
    for (const r of got.rows) stamps.set(r.id, r.updatedAt);
    return {
      rows: got.rows.filter((r) => !r.archived).map((r) => toRecord(r)),
      ...(got.next !== undefined ? { next: got.next } : {}),
      ...(got.done !== undefined ? { done: got.done } : {}),
    };
  };
  return Object.assign(store as Store, {
    updatedAtOf: (id: string) => stamps.get(id) ?? 0,
    page,
    // a per-parent list is read as a delta list: its checks add and change records, and only a sweep, which vouches parent by parent, removes any
    supportsSince: names.since === true || parentRemote !== undefined || names.rows === true,
    lazy: names.since === true,
    held,
    notes,
    skippedPrefixes,
    pendingVersions,
    eachOf: names.eachOf,
    parentInfo: parentsOf,
  });
}

// ---- the engine

const bindingOf = (b: BindingRow, relations: Map<string, string> = new Map()): SyncBindingLike => ({
  syncTypeId: b.syncTypeId,
  type: b.type,
  remote: b.remote,
  connector: b.connector,
  label: b.connector,
  fields: b.fields
    .filter((f) => f.sealed !== true)
    .map((f) => ({
      local: f.key,
      remote: f.remote,
      direction: f.dir,
      ...(f.transform !== undefined ? { transform: f.transform } : {}),
      ...(f.constant !== undefined ? { constant: f.constant } : {}),
      ...(f.relation !== undefined && relations.has(f.relation)
        ? {
            relation: {
              syncTypeId: relations.get(f.relation)!,
              type: f.relation,
              ...(f.inverse !== undefined ? { inverse: f.inverse } : {}),
            },
          }
        : {}),
    })),
  match: b.match,
  createAtSource: b.createAtSource,
  deletes: b.deletes !== "off",
  conflict: b.conflict,
});

/** Rows taken from the app per group, and the most pages one group reads. A group is one pass: pull, report, store the place, so a restart or a failure resumes there. */
const GROUP_ROWS = 2000;
const FIRST_GROUP_PAGES = 400;
/** Overlap when a poll asks for what changed since the last one, so a clock a little off loses nothing. */
const SINCE_OVERLAP_MS = 60_000;
/** A poll does not see what an app deleted; a sweep of the whole list, once a day and a group at a time, does. */
const SWEEP_EVERY_MS = 86_400_000;
/** How long a binding goes between deletion sweeps: what its polling says (a large table weekly), else a day. */
export const sweepEveryMs = (b: Pick<BindingRow, "polling">): number =>
  b.polling?.sweepSec !== undefined ? b.polling.sweepSec * 1000 : SWEEP_EVERY_MS;
interface Progress {
  after?: string;
  pulled: number;
  done: boolean;
  /** When the first pull began, kept across its groups. */
  began?: number;
  /** Polls read what changed since this time (ms). */
  hwm?: number;
  /** When a pass last began: what people changed here after it is pushed by the next poll. */
  lastStart?: number;
  /** A poll with more changes than one group holds: where it is, and the time the next poll will start from. */
  delta?: { since: number; after?: string; newHwm: number };
  sweepAt?: number;
  /** A deletion sweep under way. */
  sweep?: { after?: string };
}

// ---- links: a join object (who is on which deal) also relates two already-synced records through a many-to-many relation

const idText = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : undefined;
const urnList = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap((x) => (isObj(x) && typeof x["urn"] === "string" ? [x["urn"]] : [])) : [];

/** What one link pass did: links made, links taken away, and pairs still waiting for a record that is not pulled yet. */
export interface LinkReport {
  made: number;
  removed: number;
  waiting: number;
}

/**
 * Each pulled join row says "this record and that record belong together". The pairs are kept (sy_pairs, one per join row), the relations that stand are kept (sy_related, one per pair), and a pass only
 * touches the difference: a pair with a live join row and no relation is related (when both records are pulled, else it waits and is tried on a later pass, never linked by a bare id), a relation with
 * no live join row left is taken away. A row that changes its ends moves its relation; a row the app no longer returns (`seen` lists every id it still has) stops holding its pair up, and the relation goes
 * only when no other live join row holds the same pair. No call to the app is made here: it reads the rows the pass already pulled and writes records through the Space store.
 */
export async function applyLinks(o: {
  tx: Tx;
  local: Store;
  space: string;
  /** The join object's own synced type. */
  syncTypeId: string;
  link: LinkDef;
  /** The synced type that pulls each end's record type. */
  typeIds: Map<string, string>;
  rows: readonly StoredRecord[];
  /** Every id of the join object the app still has: a join row not in it is gone. */
  seen?: Set<string>;
}): Promise<LinkReport> {
  const { tx, local, link, syncTypeId: sid } = o;
  tx.exec(
    "CREATE TABLE IF NOT EXISTS sy_pairs (sync_type TEXT NOT NULL, remote_id TEXT NOT NULL, lft TEXT NOT NULL, rgt TEXT NOT NULL, live INTEGER NOT NULL, PRIMARY KEY (sync_type, remote_id))",
  );
  tx.exec("CREATE INDEX IF NOT EXISTS sy_pairs_ends ON sy_pairs (sync_type, lft, rgt)");
  tx.exec(
    "CREATE TABLE IF NOT EXISTS sy_related (sync_type TEXT NOT NULL, lft TEXT NOT NULL, rgt TEXT NOT NULL, PRIMARY KEY (sync_type, lft, rgt))",
  );
  for (const r of o.rows) {
    const l = idText(r.data[link.from.at]),
      g = idText(r.data[link.to.at]);
    if (l && g)
      tx.run(
        "INSERT INTO sy_pairs (sync_type, remote_id, lft, rgt, live) VALUES (?, ?, ?, ?, 1) ON CONFLICT(sync_type, remote_id) DO UPDATE SET lft = excluded.lft, rgt = excluded.rgt, live = 1",
        sid,
        r.id,
        l,
        g,
      );
    else tx.run("UPDATE sy_pairs SET live = 0 WHERE sync_type = ? AND remote_id = ?", sid, r.id);
  }
  if (o.seen)
    for (const p of tx.all<{ remote_id: string }>(
      "SELECT remote_id FROM sy_pairs WHERE sync_type = ? AND live = 1",
      sid,
    ))
      if (!o.seen.has(p.remote_id))
        tx.run("UPDATE sy_pairs SET live = 0 WHERE sync_type = ? AND remote_id = ?", sid, p.remote_id);

  const adds = tx.all<{ lft: string; rgt: string }>(
    "SELECT DISTINCT lft, rgt FROM sy_pairs p WHERE sync_type = ? AND live = 1 AND NOT EXISTS (SELECT 1 FROM sy_related r WHERE r.sync_type = p.sync_type AND r.lft = p.lft AND r.rgt = p.rgt)",
    sid,
  );
  const drops = tx.all<{ lft: string; rgt: string }>(
    "SELECT lft, rgt FROM sy_related r WHERE sync_type = ? AND NOT EXISTS (SELECT 1 FROM sy_pairs p WHERE p.sync_type = r.sync_type AND p.live = 1 AND p.lft = r.lft AND p.rgt = r.rgt)",
    sid,
  );
  if (!adds.length && !drops.length) return { made: 0, removed: 0, waiting: 0 };

  const localOf = (type: string, remote: string): string | undefined => {
    const st = o.typeIds.get(type);
    if (!st) return undefined;
    return tx.get<{ local_id: string }>(
      "SELECT local_id FROM sy_links WHERE sync_type = ? AND remote_id = ? AND (removed_at IS NULL OR removed_at = 0)",
      st,
      remote,
    )?.local_id;
  };
  const urn = (type: string, id: string): string => `vyre://${o.space}/${type}/${id}`;
  interface Edit {
    type: string;
    id: string;
    field: string;
    add: Set<string>;
    rem: Set<string>;
  }
  const edits = new Map<string, Edit>();
  const edit = (type: string, id: string, field: string): Edit => {
    const k = `${type}|${id}|${field}`;
    let e = edits.get(k);
    if (!e) edits.set(k, (e = { type, id, field, add: new Set(), rem: new Set() }));
    return e;
  };
  interface Pair {
    lft: string;
    rgt: string;
    /** The two records the pair touches, as "type|id". */
    ends: string[];
  }
  const toAdd: Pair[] = [],
    toDrop: Pair[] = [];
  let waiting = 0;
  for (const p of adds) {
    const a = localOf(link.from.type, p.lft),
      b = localOf(link.to.type, p.rgt);
    if (!a || !b) {
      waiting++;
      continue;
    }
    edit(link.from.type, a, link.key).add.add(urn(link.to.type, b));
    edit(link.to.type, b, link.inverseKey).add.add(urn(link.from.type, a));
    toAdd.push({ ...p, ends: [`${link.from.type}|${a}`, `${link.to.type}|${b}`] });
  }
  for (const p of drops) {
    const a = localOf(link.from.type, p.lft),
      b = localOf(link.to.type, p.rgt);
    if (a && b) {
      edit(link.from.type, a, link.key).rem.add(urn(link.to.type, b));
      edit(link.to.type, b, link.inverseKey).rem.add(urn(link.from.type, a));
    }
    toDrop.push({ ...p, ends: a && b ? [`${link.from.type}|${a}`, `${link.to.type}|${b}`] : [] });
  }
  const failed = new Set<string>();
  for (const e of edits.values()) {
    try {
      const rec = await local.get(e.type, e.id);
      if (!rec) {
        failed.add(`${e.type}|${e.id}`);
        continue;
      }
      const have = urnList(rec.data[e.field]);
      const next = have.filter((u) => !e.rem.has(u));
      for (const u of e.add) if (!next.includes(u)) next.push(u);
      if (next.length !== have.length || next.some((u, i) => u !== have[i]))
        await local.update(e.type, e.id, { [e.field]: next.map((u) => ({ urn: u })) }, rec.version);
    } catch {
      failed.add(`${e.type}|${e.id}`); // a record changed under the pass, or is gone: the pair stays as it was and is tried again
    }
  }
  const ok = (p: Pair): boolean => p.ends.every((x) => !failed.has(x));
  let made = 0,
    removed = 0;
  for (const p of toAdd)
    if (ok(p)) {
      tx.run("INSERT OR IGNORE INTO sy_related (sync_type, lft, rgt) VALUES (?, ?, ?)", sid, p.lft, p.rgt);
      made++;
    } else waiting++;
  for (const p of toDrop)
    if (ok(p)) {
      tx.run("DELETE FROM sy_related WHERE sync_type = ? AND lft = ? AND rgt = ?", sid, p.lft, p.rgt);
      removed++;
    }
  return { made, removed, waiting };
}

/** How long the parent list of a per-parent list is kept between passes: long enough that a run of passes reads it once, short enough that a new parent shows within minutes. */
const PARENT_CACHE_MS = 10 * 60_000;

export function createSyncEngine(o: {
  core: SyncCore;
  local: LocalSide;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  groupRows?: number;
  unmaskToken?: string;
  heldOf?: (nonce: string, rowId: string) => Record<string, unknown> | undefined;
  heldDone?: (nonce: string) => void;
}): SyncEngineLike {
  // Sealed values the Vault could not take yet, held in this process's memory only (never stored) and tried again at the next group or pass; a restart loses them, and the count left in sy_sealed_wait makes the next pass read the app again.
  const waiting = new Map<string, Map<string, Record<string, unknown>>>();
  const WAITING_MAX = 50_000;
  const objectsOf = objectNamesOf(() => (o.now ?? Date.now)());
  const depsOf = async (
    ctx: EngineCtx,
    b: BindingRow,
  ): Promise<{
    deps: SyncDepsLike;
    remote: ReturnType<typeof remoteStore>;
    tx: Tx;
    local: Store;
    binding: SyncBindingLike;
    link: LinkDef | undefined;
    typeIds: Map<string, string>;
  }> => {
    const { store, tx } = o.local.open();
    // what the Sync page says while the app has asked Vyre to slow down: that it did, and when the pull goes on
    const slow = {
      onSlow: (waitMs: number): void => {
        const at = (o.now ?? Date.now)();
        try {
          tx.exec(
            "CREATE TABLE IF NOT EXISTS sy_slow (sync_type TEXT PRIMARY KEY, since INTEGER NOT NULL, resume_at INTEGER NOT NULL)",
          );
          tx.run(
            "INSERT INTO sy_slow (sync_type, since, resume_at) VALUES (?, ?, ?) ON CONFLICT(sync_type) DO UPDATE SET resume_at = excluded.resume_at",
            b.syncTypeId,
            at,
            at + waitMs,
          );
        } catch {
          /* the note is for the Sync page only: the wait itself still happens */
        }
      },
      onResume: (): void => {
        try {
          tx.run("DELETE FROM sy_slow WHERE sync_type = ?", b.syncTypeId);
        } catch {
          /* no note was made */
        }
      },
    };
    // what a per-parent list keeps between passes: which parent each record sits under, which parents a sweep has read to the end, the version of each parent when its children were last read, and the parent list itself
    for (const q of [
      "CREATE TABLE IF NOT EXISTS sy_parent (sync_type TEXT NOT NULL, remote_id TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY (sync_type, remote_id))",
      "CREATE TABLE IF NOT EXISTS sy_parent_done (sync_type TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY (sync_type, parent))",
      "CREATE TABLE IF NOT EXISTS sy_parent_ver (sync_type TEXT NOT NULL, parent TEXT NOT NULL, ver TEXT NOT NULL, PRIMARY KEY (sync_type, parent))",
      "CREATE TABLE IF NOT EXISTS sy_skipped (sync_type TEXT NOT NULL, prefix TEXT NOT NULL, PRIMARY KEY (sync_type, prefix))",
      "CREATE TABLE IF NOT EXISTS sy_parent_ids (sync_type TEXT PRIMARY KEY, at INTEGER NOT NULL, info TEXT NOT NULL)",
    ])
      try {
        tx.exec(q);
      } catch {
        /* the tables are for a per-parent list only */
      }
    const remote = remoteStore(ctx, b, await objectsOf(ctx, b.connector), {
      parentCache: {
        get: (): ParentInfo | undefined => {
          try {
            const row = tx.get<{ at: number; info: string }>(
              "SELECT at, info FROM sy_parent_ids WHERE sync_type = ?",
              b.syncTypeId,
            );
            return row && (o.now ?? Date.now)() - row.at < PARENT_CACHE_MS
              ? (JSON.parse(row.info) as ParentInfo)
              : undefined;
          } catch {
            return undefined;
          }
        },
        set: (info: ParentInfo): void => {
          try {
            tx.run(
              "INSERT INTO sy_parent_ids (sync_type, at, info) VALUES (?, ?, ?) ON CONFLICT(sync_type) DO UPDATE SET at = excluded.at, info = excluded.info",
              b.syncTypeId,
              (o.now ?? Date.now)(),
              JSON.stringify(info),
            );
          } catch {
            /* a pass without the kept list reads it again */
          }
        },
      },
      versionOf: (parent: string): string | undefined => {
        try {
          return tx.get<{ ver: string }>(
            "SELECT ver FROM sy_parent_ver WHERE sync_type = ? AND parent = ?",
            b.syncTypeId,
            parent,
          )?.ver;
        } catch {
          return undefined;
        }
      },
      ...(o.sleep ? { sleep: o.sleep } : {}),
      nonce: ctx.trace.traceId,
      ...slow,
      sealed: b.fields.filter((f) => f.sealed === true).map((f) => ({ remote: f.remote, local: f.key })),
      ...(o.unmaskToken ? { unmaskToken: o.unmaskToken } : {}),
      ...(o.heldOf ? { heldOf: o.heldOf } : {}),
      whens: b.fields.filter((f) => f.remote.startsWith("=when:")).map((f) => f.remote),
      joins: b.fields.filter((f) => f.remote.startsWith("=join:")).map((f) => f.remote),
    });
    // a relation names a record type; the engine needs the synced type that pulls it, to turn the app's id into a link
    const relations = new Map<string, string>();
    for (const f of b.fields) {
      if (f.relation === undefined || relations.has(f.relation)) continue;
      const got = await ctx
        .call("sync_types.get", { type: f.relation, ...(b.account ? { account: b.account } : {}) })
        .catch(() => undefined);
      const id = isObj(got) && isObj(got["syncedType"]) ? got["syncedType"]["syncTypeId"] : undefined;
      if (typeof id === "string") relations.set(f.relation, id);
    }
    // a join object that also relates two records: the synced type that pulls each end, to turn the app's ids into links (an end that is not synced waits)
    const objects = await objectsOf(ctx, b.connector);
    const link = namesFor(objects, b.remote).link;
    const typeIds = new Map<string, string>();
    if (link)
      for (const type of new Set([link.from.type, link.to.type])) {
        const got = await ctx
          .call("sync_types.get", { type, ...(b.account ? { account: b.account } : {}) })
          .catch(() => undefined);
        const id = isObj(got) && isObj(got["syncedType"]) ? got["syncedType"]["syncTypeId"] : undefined;
        if (typeof id === "string") typeIds.set(type, id);
      }
    return {
      link,
      typeIds,
      deps: {
        local: store,
        remote,
        tx,
        ...(o.now ? { now: o.now } : {}),
        ...(o.local.space ? { space: o.local.space } : {}),
        emit: (n, s, p) => ctx.emit(n, s, p),
      },
      remote,
      tx,
      local: store,
      binding: bindingOf(b, relations),
    };
  };
  return {
    async run(ctx, b, opts) {
      const { deps, binding, remote, tx, local, link, typeIds } = await depsOf(ctx, b);
      const dry = opts.mode === "dry_run";
      /** The join rows of this pass also relate their two records; the words are added to the pass's summary. */
      const linkPass = async (rows: readonly StoredRecord[], seen?: Set<string>): Promise<string> => {
        if (!link || dry) return "";
        const rep = await applyLinks({
          tx,
          local,
          space: deps.space ?? "space",
          syncTypeId: b.syncTypeId,
          link,
          typeIds,
          rows,
          ...(seen ? { seen } : {}),
        });
        const said = [
          ...(rep.made ? [`${rep.made} link${rep.made === 1 ? "" : "s"} made`] : []),
          ...(rep.removed ? [`${rep.removed} taken away`] : []),
          ...(rep.waiting ? [`${rep.waiting} waiting for a record not in yet`] : []),
        ];
        return said.length ? ` ${said.join(", ")}.` : "";
      };
      // A pass over a type with sealed fields: after the engine has made or updated the records, each sealed value read in the pass is sealed into its record (Records puts it in the Vault and keeps a reference).
      // The value is never in the engine's own tables (base, conflicts, outbox): it was taken out of the row when the row was read. A value the app sent empty clears the field.
      const sealedIn = async (): Promise<void> => {
        if (!b.fields.some((f) => f.sealed === true)) return;
        const mine = waiting.get(b.syncTypeId) ?? new Map<string, Record<string, unknown>>();
        waiting.set(b.syncTypeId, mine);
        const note = (e: unknown): void => {
          // why, in the Vault's own words (never the value): shown in the type's log so a person can see what to fix
          const err = isObj(e) && isObj(e["error"]) ? e["error"] : undefined;
          const why =
            typeof err?.["message"] === "string"
              ? err["message"]
              : e instanceof Error
                ? e.message
                : "the Vault refused";
          try {
            tx.run(
              "INSERT INTO sy_log (sync_type, at, kind, summary, run_id, trace_id) VALUES (?, ?, 'error', ?, NULL, NULL)",
              b.syncTypeId,
              (o.now ?? Date.now)(),
              `A sealed value could not be kept yet: ${why}`.slice(0, 300),
            );
          } catch {
            /* the log is for the Sync page only */
          }
        };
        // The loops give the event loop a turn every 15 ms (lib/yield-loop.ts): a pass with hundreds of sealed values was one 79 ms stretch of a firm's server. `mine` can grow with the Space (every value
        // the Vault could not take yet), so the first loop is bounded by time, not by the size of a page.
        // The pull and the records it made are one stretch before this (about 17 ms for 600 rows on an idle server), and the first turn came 15 ms after that: a block of 36 ms idle, 252 ms on a loaded CI
        // runner (24 Nov). So the loop gives a turn first, and a turn every 5 ms of work: a value is a key derivation and a write, never more than a few ms.
        await new Promise<void>((done) => setImmediate(done));
        const turn = turns(SEAL_TURN_MS);
        // first the ones that could not be kept before (the record may be visible now, or the Vault open)
        for (const [recordId, patch] of [...mine]) {
          await turn();
          try {
            await ctx.call("records.update", { type: b.type, recordId, patch });
            mine.delete(recordId);
          } catch {
            /* still waiting */
          }
        }
        for (const [remoteId, got] of remote.held) {
          await turn();
          const link = tx.get<{ local_id: string }>(
            "SELECT local_id FROM sy_links WHERE sync_type = ? AND remote_id = ? AND (removed_at IS NULL OR removed_at = 0)",
            b.syncTypeId,
            remoteId,
          );
          if (!link) continue;
          const rec = await deps.local.get(b.type, link.local_id);
          if (!rec) continue;
          const patch: Record<string, unknown> = {};
          for (const [local, value] of Object.entries(got.values)) {
            const have = rec.data[local];
            const haveRef = isObj(have) && typeof have["ref"] === "string" ? have : undefined;
            if (value === null) {
              if (haveRef) patch[local] = null;
            } else if (
              !haveRef ||
              got.at === 0 ||
              got.at > (typeof haveRef["set_at"] === "number" ? haveRef["set_at"] : 0)
            )
              patch[local] = { sealed: true, value };
          }
          // through records.update: that is the one door that puts a sealed value in the Vault and keeps the reference (the Space store itself refuses a sealed value)
          if (Object.keys(patch).length) {
            // the Vault cannot take it (a Space nobody has signed in to, a locked Vault, a record not visible yet): the record stays without the field, the value is NOT stored anywhere, and it is tried again at the next group or pass
            try {
              await ctx.call("records.update", { type: b.type, recordId: link.local_id, patch });
              mine.delete(link.local_id);
            } catch (e) {
              note(e);
              if (mine.size < WAITING_MAX) mine.set(link.local_id, { ...(mine.get(link.local_id) ?? {}), ...patch });
            }
          }
        }
        const owed = [...mine.values()].reduce((n, p) => n + Object.values(p).filter((x) => x !== null).length, 0);
        remote.held.clear();
        o.heldDone?.(ctx.trace.traceId);
        try {
          tx.exec("CREATE TABLE IF NOT EXISTS sy_sealed_wait (sync_type TEXT PRIMARY KEY, n INTEGER NOT NULL)");
          if (owed > 0)
            tx.run(
              "INSERT INTO sy_sealed_wait (sync_type, n) VALUES (?, ?) ON CONFLICT(sync_type) DO UPDATE SET n = excluded.n",
              b.syncTypeId,
              owed,
            );
          else tx.run("DELETE FROM sy_sealed_wait WHERE sync_type = ?", b.syncTypeId);
        } catch {
          /* the note is for the Sync page only */
        }
      };
      const runSyncS: SyncCore["runSync"] = async (d, bnd, o2) => {
        const r = await o.core.runSync(d, bnd, o2);
        if (!o2?.dryRun && !dry) await sealedIn();
        return r;
      };
      // The first pull (and a backfill) reads the app a group of pages at a time and keeps its place; the next pass carries on from there. Newest first is the app's own order (the spec's list query sorts).
      // After it, an app that can answer "changed since" is polled for only that; what the app deleted is found by a sweep once a day. An app that cannot is listed whole every poll.
      // the sync tables are made by the first pass: before it there is no place kept, and this is the first pull
      let state: { cursor: string | null } | null | undefined;
      try {
        state = tx.get<{ cursor: string | null }>("SELECT cursor FROM sy_state WHERE sync_type = ?", b.syncTypeId);
      } catch {
        state = undefined;
      }
      let progress: Progress | undefined = state?.cursor ? (JSON.parse(state.cursor) as Progress) : undefined;
      // sealed values still waiting for the Vault: once a pull is whole, the app is read again from the start to fill them
      try {
        const owedRow = tx.get<{ n: number }>("SELECT n FROM sy_sealed_wait WHERE sync_type = ?", b.syncTypeId);
        // owed with nothing held in memory (the server restarted): read the app again; otherwise the held values are simply tried again
        if (
          owedRow &&
          owedRow.n > 0 &&
          !(waiting.get(b.syncTypeId)?.size ?? 0) &&
          progress &&
          (progress as { done?: boolean }).done !== false
        )
          progress = undefined;
      } catch {
        /* nothing owed */
      }
      const fresh = state === undefined || state === null;
      const startedAt = (o.now ?? Date.now)();
      const save = (p: Progress): void => {
        tx.run(
          "INSERT INTO sy_state (sync_type, cursor) VALUES (?, ?) ON CONFLICT(sync_type) DO UPDATE SET cursor = excluded.cursor",
          b.syncTypeId,
          JSON.stringify(p),
        );
      };
      const outOf = (r: SyncReportLike, summary: string, more: boolean): RunOut => ({
        summary: remote.notes.length ? `${summary} ${[...new Set(remote.notes)].join(" ")}`.slice(0, 600) : summary,
        pulled: r.local.created + r.local.updated,
        pushed: r.remote.created + r.remote.updated + r.remote.removed,
        skipped: r.skipped ?? 0,
        conflicts: r.conflicts,
        dryRun: false,
        ...(more ? { more: true } : {}),
      });
      const common = {
        ...(opts.runAutomations ? { runAutomations: true } : {}),
        ...(opts.by ? { by: opts.by } : {}),
        traceId: ctx.trace.traceId,
      };
      /** Pages from `from`, until a group is full or the app has no more. An app that ignores the page parameter answers the same page again: it has nothing new. */
      const group = async (
        from: string | undefined,
        since?: number,
      ): Promise<{ rows: StoredRecord[]; next?: string; done: string[] }> => {
        const rows: StoredRecord[] = [];
        const seen = new Set<string>();
        const done: string[] = [];
        let after = from;
        let next: string | undefined;
        for (let pages = 0; pages < FIRST_GROUP_PAGES && rows.length < (o.groupRows ?? GROUP_ROWS); pages++) {
          const got = await remote.page(after, since);
          const brought = got.rows.filter((r) => !seen.has(r.id));
          for (const r of brought) seen.add(r.id);
          rows.push(...brought);
          done.push(...(got.done ?? []));
          // the page's own `next` already ends at an empty page and at the place just read (nextPlace); a page that brought nothing new ends the walk too
          next = got.next;
          if (!next || (brought.length === 0 && got.rows.length > 0)) {
            next = undefined;
            break;
          }
          after = next;
        }
        for (const prefix of remote.skippedPrefixes)
          tx.run("INSERT OR IGNORE INTO sy_skipped (sync_type, prefix) VALUES (?, ?)", b.syncTypeId, prefix);
        remote.skippedPrefixes.clear();
        // which parent each record sits under: a sweep removes nothing under a parent it did not read to the end
        if (remote.eachOf)
          for (const r of rows) {
            const parent = (r.data as Record<string, unknown>)["/_parent"];
            if (typeof parent === "string")
              tx.run(
                "INSERT INTO sy_parent (sync_type, remote_id, parent) VALUES (?, ?, ?) ON CONFLICT(sync_type, remote_id) DO UPDATE SET parent = excluded.parent",
                b.syncTypeId,
                r.id,
                parent,
              );
          }
        return { rows, ...(next !== undefined ? { next } : {}), done };
      };
      /** The versions of the parents read to the end are kept once their rows are in, so a pass that failed half way reads them again. */
      const keepVersions = (skipped = 0): void => {
        if (!remote.eachOf?.changed) return;
        // a record that did not go in (a conflict, a failure) is read again at the next check: the versions of this step's parents are not kept
        if (skipped > 0) {
          remote.pendingVersions.clear();
          return;
        }
        for (const [parent, ver] of remote.pendingVersions)
          tx.run(
            "INSERT INTO sy_parent_ver (sync_type, parent, ver) VALUES (?, ?, ?) ON CONFLICT(sync_type, parent) DO UPDATE SET ver = excluded.ver",
            b.syncTypeId,
            parent,
            ver,
          );
        remote.pendingVersions.clear();
      };
      const sweepStep = async (p: Progress): Promise<RunOut> => {
        if (!p.sweep) {
          tx.run("DELETE FROM sy_seen WHERE sync_type = ?", b.syncTypeId);
          tx.run("DELETE FROM sy_parent_done WHERE sync_type = ?", b.syncTypeId);
          tx.run("DELETE FROM sy_skipped WHERE sync_type = ?", b.syncTypeId);
        }
        const g = await group(p.sweep?.after);
        for (const r of g.rows)
          tx.run("INSERT OR IGNORE INTO sy_seen (sync_type, remote_id) VALUES (?, ?)", b.syncTypeId, r.id);
        for (const parent of g.done)
          tx.run("INSERT OR IGNORE INTO sy_parent_done (sync_type, parent) VALUES (?, ?)", b.syncTypeId, parent);
        // a per-parent list's checks may skip parents (`changed`), so the sweep, which reads them all, also brings in what it finds new or changed
        if (remote.eachOf && (g.rows.length > 0 || g.done.length > 0)) {
          const applied =
            g.rows.length > 0 ? await runSyncS(deps, binding, { mode: "both", partial: g.rows, ...common }) : undefined;
          keepVersions(applied?.skipped ?? 0);
        }
        if (g.next !== undefined) {
          save({ ...p, sweep: { after: g.next } });
          return {
            summary: "Checking what the app removed.",
            pulled: 0,
            pushed: 0,
            skipped: 0,
            conflicts: 0,
            dryRun: false,
            more: true,
          };
        }
        const ids = new Set(
          tx
            .all<{ remote_id: string }>("SELECT remote_id FROM sy_seen WHERE sync_type = ?", b.syncTypeId)
            .map((x) => x.remote_id),
        );
        // a record under a parent this sweep did not read to the end is vouched for as it is (a parent made after the sweep began, one that did not meet `where`, one that was skipped): nothing under it is removed
        // the records of an item the app's page held too many inner items for are vouched for as they are: the item was left out, not removed
        for (const x of tx.all<{ prefix: string }>("SELECT prefix FROM sy_skipped WHERE sync_type = ?", b.syncTypeId))
          for (const l of tx.all<{ remote_id: string }>(
            "SELECT remote_id FROM sy_links WHERE sync_type = ? AND remote_id >= ? AND remote_id < ?",
            b.syncTypeId,
            x.prefix,
            x.prefix.slice(0, -1) + "0",
          ))
            ids.add(l.remote_id);
        // (a parent the app no longer lists was deleted there: its children are not vouched for and go)
        if (remote.eachOf) {
          const info = await remote.parentInfo();
          const exists = info.all ? new Set(info.all) : undefined;
          for (const x of tx.all<{ remote_id: string; parent: string }>(
            "SELECT remote_id, parent FROM sy_parent WHERE sync_type = ? AND parent NOT IN (SELECT parent FROM sy_parent_done WHERE sync_type = ?)",
            b.syncTypeId,
            b.syncTypeId,
          ))
            if (!exists || exists.has(x.parent)) ids.add(x.remote_id);
        }
        const r = await runSyncS(deps, binding, { mode: "both", partial: [], sweepSeen: ids, ...common });
        const said = await linkPass([], ids);
        tx.run("DELETE FROM sy_seen WHERE sync_type = ?", b.syncTypeId);
        tx.run("DELETE FROM sy_parent_done WHERE sync_type = ?", b.syncTypeId);
        tx.run("DELETE FROM sy_skipped WHERE sync_type = ?", b.syncTypeId);
        const { sweep: _done, ...rest } = p;
        save({ ...rest, sweepAt: startedAt });
        return outOf(r, r.summary + said, false);
      };
      const deltaStep = async (p: Progress): Promise<RunOut> => {
        const d = p.delta ?? { since: p.hwm ?? 0, newHwm: startedAt - SINCE_OVERLAP_MS };
        const g = await group(d.after, d.since);
        const r = await runSyncS(deps, binding, {
          mode: "both",
          partial: g.rows,
          pushLocalSince: p.lastStart ?? d.since,
          ...common,
        });
        keepVersions(r.skipped ?? 0);
        const said = await linkPass(g.rows);
        if (g.next !== undefined) {
          save({ ...p, done: false, delta: { ...d, after: g.next } });
          return outOf(r, r.summary + said, true);
        }
        const { delta: _d, ...rest } = p;
        save({ ...rest, done: true, hwm: d.newHwm, lastStart: startedAt });
        return outOf(r, r.summary + said, false);
      };
      if (!dry) {
        if (progress?.sweep) return sweepStep(progress);
        if (progress?.delta) return deltaStep(progress);
        if (opts.mode === "backfill" || fresh || (progress && !progress.done)) {
          if (opts.mode === "backfill" && (!progress || progress.done)) progress = { pulled: 0, done: false };
          progress ??= { pulled: 0, done: false };
          const began = progress.began ?? startedAt;
          const g = await group(progress.after);
          const r = await runSyncS(deps, binding, { mode: "both", partial: g.rows, ...common });
          keepVersions(r.skipped ?? 0);
          const said = await linkPass(g.rows);
          const total = progress.pulled + g.rows.length;
          const saved: Progress =
            g.next !== undefined
              ? { after: g.next, pulled: total, done: false, began }
              : { pulled: total, done: true, hwm: began - SINCE_OVERLAP_MS, lastStart: began, sweepAt: began };
          save(saved);
          return outOf(
            r,
            g.next === undefined
              ? `${r.summary} All ${total} are in.${said}`
              : `Catching up: ${total} read so far. ${r.summary}${said}`,
            g.next !== undefined,
          );
        }
        if (remote.supportsSince && progress?.hwm !== undefined) {
          if (startedAt - (progress.sweepAt ?? 0) > sweepEveryMs(b)) return sweepStep(progress);
          return deltaStep(progress);
        }
      }
      const r = await runSyncS(deps, binding, {
        mode: "both",
        dryRun: dry,
        ...(opts.runAutomations ? { runAutomations: true } : {}),
        ...(opts.by ? { by: opts.by } : {}),
        traceId: ctx.trace.traceId,
      });
      // the whole list was read by the pass (and kept by the remote store), so the join rows are at hand without another call to the app
      const everyRow = link && !dry ? (await remote.query(b.remote, {} as QuerySpec)).rows : [];
      const said = await linkPass(everyRow, new Set(everyRow.map((x) => x.id)));
      return {
        summary: r.summary + said,
        pulled: r.local.created + r.local.updated,
        pushed: r.remote.created + r.remote.updated + r.remote.removed,
        skipped: r.skipped ?? 0,
        conflicts: r.conflicts,
        dryRun: dry,
      };
    },
    async preview(ctx, b, opts) {
      const { deps, binding } = await depsOf(ctx, b);
      const r = await o.core.runSync(deps, binding, {
        mode: opts.direction ?? "both",
        dryRun: true,
        traceId: ctx.trace.traceId,
      });
      return {
        creates: r.local.created + r.remote.created,
        updates: r.local.updated + r.remote.updated,
        removes: r.remote.removed + r.removedAtSource,
        skips: r.conflicts,
        summary: r.summary,
        matches: { sure: r.matched, unsure: r.ambiguous, none: 0 },
        samples: [],
      };
    },
    async confirmDeletes(ctx, b, decision) {
      const { deps, binding } = await depsOf(ctx, b);
      return o.core.confirmDeletes(deps, binding, decision);
    },
    async resolveConflict(ctx, b, conflictId, resolution, value) {
      const { deps, binding } = await depsOf(ctx, b);
      return o.core.resolveConflict(deps, binding, conflictId, resolution, value);
    },
    async replayConflict(ctx, b, conflictId) {
      const { tx, local, remote } = await depsOf(ctx, b);
      const c = tx.get<{ local_id: string; field: string; ours: string | null; theirs: string | null }>(
        "SELECT local_id, field, ours, theirs FROM sy_conflicts WHERE conflict_id = ? AND sync_type = ?",
        conflictId,
        b.syncTypeId,
      );
      if (!c) throw new StoreError("not_found", "no conflict with that id");
      const ours: unknown = JSON.parse(c.ours ?? "null");
      const theirs: unknown = JSON.parse(c.theirs ?? "null");
      const rec = await local.get(b.type, c.local_id);
      const link = tx.get<{ remote_id: string }>(
        "SELECT remote_id FROM sy_links WHERE sync_type = ? AND local_id = ?",
        b.syncTypeId,
        c.local_id,
      );
      if (link) await remote.get(b.remote, link.remote_id); // reads the app once, so the newest rule compares real times
      const theirAt = link ? remote.updatedAtOf(link.remote_id) : 0;
      const newest = (rec?.updated_at ?? 0) >= theirAt ? ours : theirs;
      return [
        { rule: "newest", value: newest },
        { rule: "source", value: theirs },
        { rule: "vyre", value: ours },
        { rule: "ask", value: null },
      ];
    },
    async undoPush(ctx, b, outboxId) {
      const { deps, tx, local, remote, binding } = await depsOf(ctx, b);
      const row = tx.get<{
        op: string;
        status: string;
        undone_at: number | null;
        local_id: string;
        replaced: string | null;
      }>(
        "SELECT op, status, undone_at, local_id, replaced FROM sy_outbox WHERE outbox_id = ? AND sync_type = ?",
        outboxId,
        b.syncTypeId,
      );
      if (!row || row.op !== "remove" || row.status !== "done" || row.undone_at !== null)
        return o.core.undoPush(deps, binding, outboxId);
      // Undoing a removal: the app has no way to bring a deleted record back, so it is created again from the snapshot taken just before the delete. No snapshot: say so.
      if (!row.replaced)
        return {
          undone: false,
          reason: "The app record was not saved before it was removed, so it cannot be put back.",
        };
      const snapshot = JSON.parse(row.replaced) as Record<string, unknown>;
      const made = await remote.create(b.remote, "", snapshot as never);
      const rec = await local.get(b.type, row.local_id, { include_deleted: true });
      const base: Record<string, unknown> = {};
      for (const f of b.fields.filter((x) => x.dir !== "off")) base[f.key] = rec?.data[f.key] ?? null;
      tx.run(
        "DELETE FROM sy_links WHERE sync_type = ? AND (local_id = ? OR remote_id = ?)",
        b.syncTypeId,
        row.local_id,
        made.id,
      );
      tx.run(
        "INSERT INTO sy_links (sync_type, local_id, remote_id, base, removed_at) VALUES (?, ?, ?, ?, NULL)",
        b.syncTypeId,
        row.local_id,
        made.id,
        JSON.stringify(base),
      );
      tx.run(
        "UPDATE sy_outbox SET status = 'undone', undone_at = ? WHERE outbox_id = ?",
        (o.now ?? Date.now)(),
        outboxId,
      );
      deps.emit?.("sync.push_undone", `record/${row.local_id}`, {
        syncTypeId: b.syncTypeId,
        recordId: row.local_id,
        outboxId,
      });
      return { undone: true };
    },
    async push(ctx, b, outboxId) {
      const { deps, tx, binding } = await depsOf(ctx, b);
      o.core.retryPush(deps, outboxId); // a failed row goes back to pending; a pending one is untouched
      await o.core.flushOutbox(deps, binding);
      const row = tx.get<{ status: string; error: string | null }>(
        "SELECT status, error FROM sy_outbox WHERE outbox_id = ? AND sync_type = ?",
        outboxId,
        b.syncTypeId,
      );
      if (row?.status === "done") return { state: "sent" };
      return { state: "failed", ...(row?.error ? { error: row.error } : {}) };
    },
  };
}
