// The daemon's access snapshot: the event log folded into the kernel's AccessSnapshot so `authorize` answers for the live Space. Booting reads the whole log once; every commit folds its own events.
// Only the access event types matter here (the same six the seeded Spaces use); the access module's own projections (L7a) can replace this fold without touching the daemon's callers.
import { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import type { GrantRow, PrincipalRoleRow, PrincipalRow, ResourceRow, RoleRow } from "../../../kernel/src/authorize/index.ts";

export interface FoldableEvent { type: string; payload: unknown }

function body<T>(e: FoldableEvent): T {
  const p = e.payload;
  if (p instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(p)) as T;
  return p as T;
}

export function foldEvent(snap: AccessSnapshot, e: FoldableEvent): void {
  switch (e.type) {
    case "role.defined": snap.putRole(body<RoleRow>(e)); return;
    case "principal.created": snap.putPrincipal(body<PrincipalRow>(e)); return;
    case "agent.privacy_set": { const b = body<{ agentId: string; private?: boolean; assistant?: boolean }>(e); snap.setAssistant(b.agentId, b.private === true && b.assistant === true); return; }
    case "principal.role_set": snap.addPrincipalRole(body<PrincipalRoleRow>(e)); return;
    case "group.member_added": snap.addMember(body<{ group: string; member: string }>(e)); return;
    case "space.ownership_transferred": {
      const {from,to}=body<{from:string;to:string}>(e);const resources=[...snap.allResources()].filter(row=>row.type==='space'&&row.owner_id===from);
      if(resources.length!==1||(snap.principal(to)?.status!=='active'||snap.principal(to)?.kind!=='person'))return;
      const pref=snap.info(from)?.keys.has('role:rol_owner')?'rol_':'';
      snap.removePrincipalRole({holder:from,role:'owner'});snap.removePrincipalRole({holder:from,role:'rol_owner'});
      snap.addPrincipalRole({holder:from,role:`${pref}admin`});snap.addPrincipalRole({holder:to,role:`${pref}owner`});snap.putResource({...resources[0]!,owner_id:to});
      // what the host registered in the Space owner's name (spaceOwned) follows the Space's owner, as the access module folds it; what a person made or was given stays theirs
      for (const t of [...snap.allResources()]) if ((t as { space_owned?: unknown }).space_owned === true && t.owner_id === from) snap.putResource({ ...t, owner_id: to });
      return;
    }
    case "resource.created": snap.putResource(body<ResourceRow>(e)); return;
    case "grant.created": snap.putGrant(body<GrantRow>(e)); return;
    case "grant.revoked": {
      const grantId = body<{ grantId?: unknown }>(e).grantId;
      if (typeof grantId === "string") snap.revokeGrant(grantId);
      return;
    }
    default: return;
  }
}

export function buildAccess(events: readonly FoldableEvent[]): AccessSnapshot {
  const snap = new AccessSnapshot();
  for (const e of events) foldEvent(snap, e);
  return snap;
}

/** The events the access module folds into its store (modules/access/consumers.ts ACCESS_EVENTS). */
const MODULE_EVENTS = new Set([
  "role.defined", "principal.created", "principal.role_set", "group.member_added", "resource.created", "grant.created", "grant.revoked",
  "principal.suspended", "principal.reactivated", "member.removed", "space.ownership_transferred", "agent.privacy_set",
]);
export const isAccessEvent = (type: string): boolean => MODULE_EVENTS.has(type);
/** Events after which the module's tables may differ from the snapshot the daemon holds: the ones it folds, plus what its own capabilities emit when a role, share, revoke or policy changes. */
export const touchesAccess = (type: string): boolean => MODULE_EVENTS.has(type) || type === "access.changed" || type === "policy.changed" || type.startsWith("grant.");

/** An event as the access module takes it: the payload decoded. */
export function toAccessEvent(e: { seq: number; type: string; payload: unknown }): { seq: number; type: string; payload: unknown } {
  return { seq: e.seq, type: e.type, payload: body<unknown>(e) };
}

/**
 * The live snapshot plus the Space's owner (from the Space resource), kept current by `fold`.
 * Ruling 70: `authorize` answers from the access module's snapshot. `fold` keeps the seed-shaped fold as the snapshot until the module's is adopted (boot, before the first call)
 * and as the answer if the module cannot be reached; `adopt` swaps the module's snapshot in, and `snap` is whichever is current.
 */
export function createAccess(): { readonly snap: AccessSnapshot; fold(e: FoldableEvent): void; mark(ids: readonly string[]): void; owner(): string | null; adopt(s: AccessSnapshot): void; adopted(): boolean } {
  const seeded = new AccessSnapshot();
  let current: AccessSnapshot = seeded, own = false;
  let owner: string | null = null;
  return {
    get snap() { return current; },
    fold(e) {
      foldEvent(seeded, e);
      if(e.type==='space.ownership_transferred'){const p=body<{from:string;to:string}>(e);if(p.from===owner&&typeof p.to==='string'&&[...seeded.allResources()].some(row=>row.type==='space'&&row.owner_id===p.to))owner=p.to;}
      if (e.type === "resource.created") { const r = body<ResourceRow>(e); if (r.type === "space" && r.owner_id) owner = r.owner_id; }
    },
    owner: () => owner,
    /** set the host's mark on resources that exist (hostOwnedMarks), as the access module does for its seq -1 marks */
    mark(ids) { for (const id of ids) { const r = seeded.resource(id); if (r && (r as { space_owned?: unknown }).space_owned !== true) seeded.putResource({ ...r, space_owned: true } as ResourceRow); } },
    adopt(s) { current = s; own = true; },
    adopted: () => own,
  };
}

/** A member or a guest: a person the Space knows who holds at least one role, or at least one grant (their own, through a group or through a role). The check behind capabilities at level 'member' (ruling 69). */
export function isMemberOrGuest(snap: AccessSnapshot, principalId: string): boolean {
  const me = snap.info(principalId);
  if (!me) return false;
  if (me.roleNames !== "no role") return true;
  for (const g of snap.allGrantRecs()) if (me.keys.has(g.key)) return true;
  return false;
}

/**
 * What the next access.sync folds, in the order of the log (issue #905 review, finding 1). The access store keeps a cursor, the highest seq it folded, and skips anything at or below it, so it
 * must be handed events in seq order across calls, not only within one. Events used to be handed over in the order their appends returned, and two appends in flight could return out of order:
 * a suspension at seq 41 handed over after a new record at seq 42 was skipped for good, also after a restart.
 * The log is the order: one writer commits, a seq is given at commit, and a read sees every commit before it, so an event can never appear in the log below one already read. So the events
 * after `fedTo` are read from the log itself; what was pushed is only the signal that there is something to read. Kept from what was pushed: the boot replay (at or below `fedTo`, already read
 * from the log in order) and the host's own boot-time objects (seq -1, never in the log), which go last. `upTo` is the last seq read: the next batch starts after it, once this one is folded.
 */
export async function accessBatch(o: {
  held: readonly { seq: number; type: string; payload: unknown }[];
  fedTo: number;
  /** A sync has been folded since the start: from then on nothing at or below `fedTo` is new, so a push of one is dropped (the store would skip it anyway). Before it, those are the boot replay. */
  booted: boolean;
  read(after: number, limit: number): Promise<readonly { seq: number; type: string; payload: unknown; enc?: number }[]>;
}): Promise<{ events: { seq: number; type: string; payload: unknown }[]; upTo: number; boot: { seq: number; type: string; payload: unknown }[] }> {
  const boot = o.held.filter((e) => e.seq < 0 || (!o.booted && e.seq <= o.fedTo));
  const fromLog: { seq: number; type: string; payload: unknown }[] = [];
  let upTo = o.fedTo;
  for (;;) {
    const page = await o.read(upTo, 2000);
    for (const e of page) { upTo = e.seq; if (isAccessEvent(e.type)) fromLog.push(toAccessEvent(e)); }
    if (page.length < 2000) break;
    await new Promise<void>((done) => setImmediate(done));   // a long catch-up reads on the main thread: let requests in between pages (review 3, N2)
  }
  const replay = boot.filter((e) => e.seq >= 0).sort((a, b) => a.seq - b.seq), own = boot.filter((e) => e.seq < 0);
  return { events: [...replay, ...fromLog, ...own], upTo, boot };
}

type Held = { seq: number; type: string; payload: unknown };
/**
 * One access sync of the daemon (daemon.ts runSync), apart so it can be tested. What was pushed is taken and cleared in the same tick, before anything waits: a push made while the log is read
 * stays for the next run (review 2, finding A). Reading the log is part of the attempt, so a read that fails is a sync failure like any other: tried once more, logged, the snapshot marked
 * stale (only the owner is answered) and a retry armed; after the module's snapshot was adopted, the call that asked for the sync does not throw (finding B).
 */
export function createAccessRun(o: {
  take(): Held[];
  putBack(es: Held[]): void;
  pending(): number;
  read(after: number, limit: number): Promise<readonly { seq: number; type: string; payload: unknown; enc?: number }[]>;
  call(events: Held[]): Promise<AccessSnapshot>;
  adopt(s: AccessSnapshot): void;
  adopted(): boolean;
  stale: { get(): boolean; set(v: boolean): void };
  fedTo: { get(): number; set(n: number): void };
  /** True when the error says the access module is not loaded at all: the run stops for good. */
  noModule(e: unknown): boolean;
  failed(error: string, adopted: boolean): void;
  healLater(): void;
}): (force?: boolean) => Promise<void> {
  let gone = false;
  return async (force) => {
    if (gone) return;
    if (!o.pending() && !force && o.adopted() && !o.stale.get()) return;
    const held = o.take();
    const booted = o.adopted(), fedTo = o.fedTo.get();
    let upTo = fedTo;
    const attempt = async (): Promise<void> => {
      const batch = await accessBatch({ held, fedTo, booted, read: (after, limit) => o.read(after, limit) });
      o.adopt(await o.call(batch.events));
      upTo = batch.upTo;
    };
    try { await attempt(); } catch (first) {
      if (o.noModule(first)) { gone = true; return; }
      try { await attempt(); } catch (e) {
        // the boot replay and the host's own objects are put back; the log is read again from fedTo
        o.putBack(held.filter((x) => x.seq < 0 || (!booted && x.seq <= fedTo)));
        o.failed(e instanceof Error ? e.message : String(e), o.adopted());
        if (!o.adopted()) throw e;   // a Space that never had the module's snapshot cannot answer
        o.stale.set(true);
        o.healLater();
        return;
      }
    }
    o.fedTo.set(upTo);
    o.stale.set(false);
  };
}

/**
 * The one mark of a resource the host registers in the Space owner's name (a connector, a Kit, the default site, the record types, a repaired conversation or mail message, a Space root
 * folder, a Space Vault folder). A Space ownership transfer moves every marked resource the former owner holds to the new owner, in the access module's fold and in foldEvent above; nothing
 * a person made, or was given by a per-resource transfer, carries it, so nothing of theirs moves (review 3, N1 and N3). host/tests/access.host-owned.test.ts fails on a registration in the
 * Space owner's name made without it.
 */
export const spaceOwned = <T extends object>(row: T): T & { space_owned: true } => ({ ...row, space_owned: true });
/** `spaceOwned(row)` when `when` (the owner is the Space owner because the host chose it), else the row as it is. */
export const hostOwned = <T extends object>(when: boolean, row: T): T | (T & { space_owned: true }) => (when ? spaceOwned(row) : row);

/**
 * The resources registered in the Space owner's name before the mark existed, from the log itself: the last registration of each was the host's own (`evt_res_...`, by svc_host), under the
 * Space, not an agent, and owned by whoever owned the Space at that moment. At every start the host hands these over as seq -1 marks, which only set the mark on a resource that exists.
 */
export function hostOwnedMarks(events: readonly { seq: number; id: string; type: string; actor: string; payload: unknown }[], space: string): { id: string; type: string }[] {
  let owner: string | null = null;
  const last = new Map<string, { type: string; marked: boolean }>();
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const p = body<Record<string, unknown>>(e);
    if (e.type === "space.ownership_transferred") { if (p["from"] === owner && typeof p["to"] === "string") owner = p["to"]; continue; }
    if (e.type !== "resource.created" || typeof p["id"] !== "string") continue;
    if (p["type"] === "space" && p["id"] === space) { if (typeof p["owner_id"] === "string") owner = p["owner_id"]; continue; }
    last.set(p["id"], { type: String(p["type"]), marked: e.actor === "svc_host" && e.id.startsWith("evt_res_") && p["type"] !== "agent" && p["parent_id"] === space && owner !== null && p["owner_id"] === owner });
  }
  return [...last].filter(([, v]) => v.marked).map(([id, v]) => ({ id, type: v.type }));
}

/**
 * The access sync's own read-only connection on the log (daemon.ts): opened on the first read, closed once at shutdown, and never opened again after that, so no handle on events.db outlives
 * the daemon (review 3, N4). A read after close throws, and the sync fails closed on it.
 */
export function createLogReader(open: () => { all(sql: string, ...a: unknown[]): unknown[]; close(): void }): { read(after: number, limit: number): { seq: number; type: string; payload: unknown }[]; close(): void; opened(): boolean } {
  let db: ReturnType<typeof open> | null = null, closed = false;
  return {
    read(after, limit) {
      if (closed) throw new Error("the server is stopping: the access log is closed");
      db ??= open();
      return (db.all("SELECT seq, event, payload FROM events WHERE seq > ? ORDER BY seq LIMIT ?", after, limit) as { seq: number; event: string; payload: Uint8Array }[])
        .map((r) => ({ ...(JSON.parse(r.event) as { type: string }), seq: Number(r.seq), payload: new Uint8Array(r.payload) }));
    },
    close() { closed = true; db?.close(); db = null; },
    opened: () => db !== null,
  };
}
