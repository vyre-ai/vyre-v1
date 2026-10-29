// Folders and sharing (ARCH 4.12, spec 2.4 and 4.9): one mechanism for every list of things.
// A folder is a resource of type folder; an item placed in it takes the folder as its parent, so the grants on the folder reach the item
// through the ancestry walk authorize already does. Nothing is copied. Moving an item out restores its previous parent, which removes the
// inherited access. my_access (the synced entity access_view) is rebuilt from authorize's own inputs, so the three sections, the counts and the
// share sheet agree with authorize row by row (property test: tests/share.property.test.ts).
// Project roles reuse the 0.6 idea in kernel/gateway/project-members.js@dbd2dfb: a team role is a grant tagged with source 'project:<id>' and
// removing the member revokes by source. Role to level: Lead manage, Member edit, Reviewer view, Guest view (spec 2.4).
// Path mapping: this packet owns handlers/share.ts; the capability table in handlers/index.ts is wired to these functions (one edit, no logic).
import { authorize, evalExpr } from "../../../kernel/src/authorize/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { ladderFor, levelIncludes } from "../../../packages/contracts/src/levels.ts";
import type { ResourceType } from "../../../packages/contracts/src/types.ts";
import type { AccessCtx, AccessStore, Cond, Db, GrantRec, Level, Ref, ResourceRec, ResourceRef, SubjectRef } from "../projections.ts";
import { changed, EVERYONE, fnv, grantView, isExpr, labelRank, nid, page, pkey, raise, storeOf } from "../projections.ts";

export type Via = "owner" | "grant" | "folder" | "space";
export type Section = "personal" | "shared" | "space" | "starred" | "following";

export interface FolderRec {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  scope: "personal" | "space";
  owner: string;
  createdAt: number;
}
export interface AccessRow { person: string; type: string; id: string; level: Level; via: Via }

/** Starred and Following belong to the spaces module. The host may hand the marks in; without them both lists are empty. */
export interface ShareCtx extends AccessCtx {
  actingFor?: Ref;
  marks?: (person: string, type: string) => { starred: ReadonlySet<string>; following: ReadonlySet<string> };
}

/** Project team roles write grants through access.share with source 'project:<id>' (spec 2.4). */
export const PROJECT_LEVELS: Readonly<Record<"lead" | "member" | "reviewer" | "guest", Level>> = Object.freeze({
  lead: "manage", member: "edit", reviewer: "view", guest: "view",
});

const SPACE_FOLDER_SOURCE = "space-folder:";
const LINK_DEFAULT_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_MAX_MS = 90 * 24 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const PERSON_KINDS = new Set(["person", "agent", "actor", "service"]);

type Info = NonNullable<ReturnType<AccessSnapshot["info"]>>;
type GRec = NonNullable<ReturnType<AccessSnapshot["grantsOn"]>>[number];

// ---- the share store: folders, placement, previous parents and the my_access cache --------------------------------

export class ShareStore {
  folders = new Map<string, FolderRec>();
  /** `type:id` of an item -> the folder it sits in */
  placement = new Map<string, string>();
  /** `type:id` of an item -> the parent it had before it was placed (restored on unplace) */
  prev = new Map<string, string | null>();
  /** `person\ntype\nid` -> the cached row */
  access = new Map<string, AccessRow>();
  /** the access epoch the cache was built for */
  fresh = -1;
  /** the first moment a grant expires or a window opens or closes; the cache is stale from then on */
  until = Infinity;
  idem = new Map<string, unknown>();
}

const SHARES = new WeakMap<Db, ShareStore>();
const pk = (type: string, id: string): string => `${type}:${id}`;
const ak = (person: string, type: string, id: string): string => `${person}\n${type}\n${id}`;

export function dropShare(db: Db): void { SHARES.delete(db); }

function tryAll(db: Db, sql: string): Record<string, unknown>[] {
  try { return db.all(sql) as Record<string, unknown>[]; } catch { return []; }
}

export function shareOf(ctx: AccessCtx): ShareStore {
  const hit = SHARES.get(ctx.db);
  if (hit) return hit;
  storeOf(ctx);
  const ss = new ShareStore();
  for (const f of tryAll(ctx.db, "SELECT * FROM access_folders")) {
    ss.folders.set(String(f.id), {
      id: String(f.id), type: String(f.resourceType), name: String(f.name), parentId: f.parentId == null ? null : String(f.parentId),
      scope: f.scope === "space" ? "space" : "personal", owner: String(f.owner), createdAt: Number(f.createdAt),
    });
  }
  for (const p of tryAll(ctx.db, "SELECT * FROM access_placement")) ss.placement.set(pk(String(p.resourceType), String(p.resourceId)), String(p.folderId));
  for (const p of tryAll(ctx.db, "SELECT * FROM access_placement_prev")) ss.prev.set(pk(String(p.resourceType), String(p.resourceId)), p.prevParent == null ? null : String(p.prevParent));
  for (const a of tryAll(ctx.db, "SELECT * FROM access_my_access")) {
    const row: AccessRow = { person: String(a.person), type: String(a.resourceType), id: String(a.resourceId), level: a.level as Level, via: a.via as Via };
    ss.access.set(ak(row.person, row.type, row.id), row);
  }
  SHARES.set(ctx.db, ss);
  return ss;
}

function persistFolders(ctx: AccessCtx, ss: ShareStore): void {
  const db = ctx.db;
  db.run("DELETE FROM access_folders");
  for (const f of ss.folders.values()) {
    db.run(
      "INSERT INTO access_folders (id,resourceType,name,parentId,scope,owner,createdAt,version) VALUES (?,?,?,?,?,?,?,?)",
      f.id, f.type, f.name, f.parentId, f.scope, f.owner, f.createdAt, 1,
    );
  }
  db.run("DELETE FROM access_placement");
  db.run("DELETE FROM access_placement_prev");
  for (const [key, folderId] of ss.placement) {
    const cut = key.indexOf(":");
    const type = key.slice(0, cut);
    const id = key.slice(cut + 1);
    db.run("INSERT INTO access_placement (id,resourceType,resourceId,folderId,version) VALUES (?,?,?,?,?)", `plc_${fnv(key)}${fnv(id)}`, type, id, folderId, 1);
    db.run("INSERT INTO access_placement_prev (resourceType,resourceId,prevParent) VALUES (?,?,?)", type, id, ss.prev.get(key) ?? null);
  }
}

const accessId = (person: string, type: string, id: string): string => `acc_${fnv(person)}${fnv(`${type}:${id}`)}${fnv(`${id}:${person}`)}`;

// ---- levels: who may do what to a resource ---------------------------------------------------------------------------

const rank = (type: string, l: Level): number => ladderFor(type as ResourceType).indexOf(l);
function atLeast(type: string, have: Level | null, need: Level): boolean {
  return have !== null && levelIncludes(type as ResourceType, have, need);
}
function higher(type: string, a: Level | null, b: Level): Level { return a === null || rank(type, b) > rank(type, a) ? b : a; }
function lower(type: string, a: Level | null, b: Level | null): Level | null {
  if (a === null || b === null) return null;
  return rank(type, a) <= rank(type, b) ? a : b;
}

/** Grants that reach this subject on the resource: its own, its ancestors' and the whole type's. Same tests as the kernel's `collect`. */
function matched(snap: AccessSnapshot, store: AccessStore, s: Info, res: ResourceRec, now: number): GRec[] {
  const out: GRec[] = [];
  const chain = snap.chain(res.id);
  if (!chain) return out;
  const row = store.resourceRow(res.id);
  const lists: (readonly GRec[] | undefined)[] = chain.map((c) => snap.grantsOn(c.id));
  lists.push(snap.typeWide(res.type));
  for (const l of lists) {
    if (!l) continue;
    for (const g of l) {
      if (!s.keys.has(g.key) || g.exp <= now || now < g.nb || now > g.na) continue;
      if (g.filter !== null && (!row || !evalExpr(g.filter, row, res.ownerId, s.p.id))) continue;
      out.push(g);
    }
  }
  return out;
}

function levelOfInfo(snap: AccessSnapshot, store: AccessStore, s: Info, res: ResourceRec, now: number): Level | null {
  if (res.ownerId === s.p.id) return "manage";
  let best: Level | null = null;
  for (const g of matched(snap, store, s, res, now)) best = higher(res.type, best, g.row.level);
  return best;
}

/** The effective level one principal holds on a resource, or null when authorize would deny a view. Agents and services are capped like authorize caps them. */
export function levelFor(store: AccessStore, principal: string, res: ResourceRec, now: number, actingFor?: string): Level | null {
  const snap = store.snapshot();
  const row = store.resourceRow(res.id);
  const d = authorize(snap, {
    principal, ...(actingFor && actingFor !== principal ? { actingFor } : {}),
    action: { perm: null, level: "view" }, resource: { type: res.type, id: res.id }, ...(row ? { row } : {}), now,
  });
  if (d.effect !== "allow") return null;
  const me = snap.info(principal);
  if (!me) return null;
  const subjects: Info[] = [me];
  const add = (id: string | null | undefined): void => {
    const i = id ? snap.info(id) : null;
    if (i && !subjects.includes(i)) subjects.push(i);
  };
  if (me.p.kind === "svc") add(me.p.owner);
  if (actingFor && actingFor !== principal) add(actingFor);
  let level: Level | null = levelOfInfo(snap, store, me, res, now);
  for (const s of subjects.slice(1)) level = lower(res.type, level, levelOfInfo(snap, store, s, res, now));
  return level;
}

function callerLevel(ctx: ShareCtx, store: AccessStore, res: ResourceRec): Level | null {
  return levelFor(store, ctx.principal.id, res, ctx.now(), ctx.actingFor?.id);
}

function must(ctx: ShareCtx, store: AccessStore, res: ResourceRec, need: Level, what: string): Level {
  const have = callerLevel(ctx, store, res);
  if (!atLeast(res.type, have, need)) raise(ctx.trace.traceId, "permission.no_grant", `${what} needs ${need} on this`);
  return have!;
}

function resourceOf(ctx: AccessCtx, store: AccessStore, ref: ResourceRef): ResourceRec {
  const res = store.resources.get(ref.id);
  if (!res || res.type !== ref.type) raise(ctx.trace.traceId, "validation.not_found", "no such resource");
  return res;
}

function folderOf(ctx: AccessCtx, ss: ShareStore, store: AccessStore, id: string): { rec: FolderRec; res: ResourceRec } {
  const rec = ss.folders.get(id);
  const res = store.resources.get(id);
  if (!rec || !res) raise(ctx.trace.traceId, "validation.not_found", "no such folder");
  return { rec, res };
}

// ---- my_access ---------------------------------------------------------------------------------------------------------

const live = (g: GRec, now: number): boolean => g.exp > now && now >= g.nb && now <= g.na;

/** Candidate grants for classifying a row: the person's own matched grants, or for an owner every grant that gives someone else access. */
function classify(ss: ShareStore, snap: AccessSnapshot, store: AccessStore, s: Info, res: ResourceRec, now: number): Via {
  const owner = res.ownerId === s.p.id;
  const found = new Set<Via>();
  const consider = (g: GRec): void => {
    const where = g.row.resource_id;
    const onSelf = where === null || where === res.id;
    if (g.key === `group:${EVERYONE}` || (!onSelf && where !== null && ss.folders.get(where)?.scope === "space")) found.add("space");
    else if (!onSelf) found.add("folder");
    else found.add("grant");
  };
  if (owner) {
    const chain = snap.chain(res.id) ?? [];
    for (const c of chain) {
      for (const g of snap.grantsOn(c.id) ?? []) {
        if (g.key === `actor:${s.p.id}` || !live(g, now)) continue;
        consider(g);
      }
    }
    if (found.has("space")) return "space";
    if (found.has("folder")) return "folder";
    if (found.has("grant")) return "grant";
    return "owner";
  }
  for (const g of matched(snap, store, s, res, now)) consider(g);
  if (found.has("grant")) return "grant";
  if (found.has("folder")) return "folder";
  if (found.has("space")) return "space";
  return "grant";
}

function rowFor(ss: ShareStore, store: AccessStore, snap: AccessSnapshot, person: string, res: ResourceRec, now: number): AccessRow | null {
  const row = store.resourceRow(res.id);
  const d = authorize(snap, { principal: person, action: { perm: null, level: "view" }, resource: { type: res.type, id: res.id }, ...(row ? { row } : {}), now });
  if (d.effect !== "allow") return null;
  const s = snap.info(person);
  if (!s) return null;
  const level = levelOfInfo(snap, store, s, res, now);
  if (level === null) return null;
  return { person, type: res.type, id: res.id, level, via: classify(ss, snap, store, s, res, now) };
}

function descendants(store: AccessStore, roots: readonly string[]): Set<string> {
  const kids = new Map<string, string[]>();
  for (const r of store.resources.values()) {
    if (r.parentId === null) continue;
    const l = kids.get(r.parentId) ?? [];
    l.push(r.id);
    kids.set(r.parentId, l);
  }
  const out = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const k of kids.get(id) ?? []) queue.push(k);
  }
  return out;
}

/** Bring my_access up to date. `roots` limits the work to those resources and what sits under them, and is honoured only when the cache was fresh before the change. */
function rebuild(ctx: AccessCtx, store: AccessStore, ss: ShareStore, roots: readonly string[] | "all"): void {
  const snap = store.snapshot();
  const now = ctx.now();
  const people = [...store.principals.values()].filter((p) => p.kind === "person" && p.status === "active").map((p) => p.id);
  const scope = roots === "all" ? null : descendants(store, roots);
  const next = new Map<string, AccessRow>();
  for (const res of store.resources.values()) {
    if (scope && !scope.has(res.id)) continue;
    for (const person of people) {
      const row = rowFor(ss, store, snap, person, res, now);
      if (row) next.set(ak(person, row.type, row.id), row);
    }
  }
  const same = (a: AccessRow, b: AccessRow): boolean => a.level === b.level && a.via === b.via;
  const gone: AccessRow[] = [];
  for (const [key, old] of ss.access) {
    const inScope = scope === null || scope.has(old.id) || !store.resources.has(old.id);
    if (!inScope) continue;
    const now2 = next.get(key);
    if (!now2) { ss.access.delete(key); gone.push(old); }
  }
  const touched: AccessRow[] = [];
  for (const [key, row] of next) {
    const old = ss.access.get(key);
    if (old && same(old, row)) continue;
    if (old) gone.push(old);
    ss.access.set(key, row);
    touched.push(row);
  }
  ss.fresh = store.epoch;
  let until = Infinity;
  for (const g of store.grants.values()) {
    for (const t of [g.conditions.expiresAt, g.conditions.window?.from, g.conditions.window?.to]) if (t !== undefined && t > now && t < until) until = t;
  }
  ss.until = until;
  try {
    for (const g of gone) ctx.db.run("DELETE FROM access_my_access WHERE id = ?", accessId(g.person, g.type, g.id));
    for (const r of touched) {
      ctx.db.run(
        "INSERT INTO access_my_access (id,person,resourceType,resourceId,level,via,version,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        accessId(r.person, r.type, r.id), r.person, r.type, r.id, r.level, r.via, 1, ctx.now(),
      );
    }
  } catch (e) { ss.fresh = -1; throw e; }
}

function isFresh(ctx: AccessCtx, store: AccessStore, ss: ShareStore): boolean {
  return ss.fresh === store.epoch && ctx.now() < ss.until;
}

function ensureFresh(ctx: AccessCtx, store: AccessStore, ss: ShareStore): void {
  if (!isFresh(ctx, store, ss)) rebuild(ctx, store, ss, "all");
}

/** After a change: persist, then refresh my_access for the affected subtree (or everything when the cache was already stale). */
function commit(ctx: AccessCtx, store: AccessStore, ss: ShareStore, wasFresh: boolean, roots: readonly string[], persistFolderTables: boolean): void {
  if (persistFolderTables) persistFolders(ctx, ss);
  rebuild(ctx, store, ss, wasFresh ? roots : "all");
}

// ---- access.share, access.unshare, access.shares_of -------------------------------------------------------------------

function checkSubject(ctx: AccessCtx, store: AccessStore, subject: SubjectRef): void {
  const trace = ctx.trace.traceId;
  if (subject.kind === "link") return;
  if (subject.kind === "group") {
    if (!store.groups.has(subject.id)) raise(trace, "validation.not_found", "no such group");
    return;
  }
  if (subject.kind === "role") {
    if (!store.roles.has(subject.id)) raise(trace, "validation.not_found", "no such role");
    return;
  }
  if (!PERSON_KINDS.has(subject.kind)) raise(trace, "validation.bad_input", "unknown subject kind");
  const p = store.principals.get(subject.id);
  if (!p) raise(trace, "validation.not_found", "no such person, agent or actor");
  if (p.kind !== subject.kind) raise(trace, "validation.bad_input", `${subject.id} is a ${p.kind}, not a ${subject.kind}`);
  if (p.status === "removed") raise(trace, "validation.precondition_failed", "that principal was removed");
}

function checkConditions(ctx: AccessCtx, c: Cond | undefined): Cond {
  const out: Cond = {};
  if (!c) return out;
  if (c.rowFilter !== undefined && c.rowFilter !== null) {
    if (!isExpr(c.rowFilter)) raise(ctx.trace.traceId, "validation.bad_input", "row filter is outside the expression subset");
    out.rowFilter = c.rowFilter;
  }
  if (c.hiddenFields) out.hiddenFields = [...c.hiddenFields];
  if (c.labelCeiling) out.labelCeiling = c.labelCeiling;
  if (c.window) {
    if(c.window.from>=c.window.to||c.window.to<=ctx.now())raise(ctx.trace.traceId,"validation.precondition_failed","the access window must end after its start and after now");
    out.window = { from: c.window.from, to: c.window.to };
  }
  if (c.expiresAt !== undefined) {
    if (c.expiresAt <= ctx.now()) raise(ctx.trace.traceId, "validation.precondition_failed", "the expiry is already past");
    out.expiresAt = c.expiresAt;
  }
  return out;
}

function checkLink(ctx: ShareCtx, store: AccessStore, subject: SubjectRef, level: Level, cond: Cond): Cond {
  const trace = ctx.trace.traceId;
  if (!TOKEN.test(subject.id)) raise(trace, "validation.bad_input", "a link grant names the token hash");
  if (level !== "view") raise(trace, "validation.precondition_failed", "a public link is view only");
  const policy = store.policies.get(pkey("sharing.public_links", "space"))?.value;
  if (policy === "off") raise(trace, "validation.precondition_failed", "public links are off in this Space");
  if (policy === "admins" || policy === undefined) {
    const info = store.snapshot().info(ctx.principal.id);
    if (!info?.perms.has("access.manage")) raise(trace, "permission.role_lacks_permission", "only admins may make public links here");
  }
  const now = ctx.now();
  const out: Cond = { ...cond };
  if (out.expiresAt === undefined) out.expiresAt = now + LINK_DEFAULT_MS;
  if (out.expiresAt > now + LINK_MAX_MS) raise(trace, "validation.precondition_failed", "a public link lasts at most 90 days");
  return out;
}

/** A conservative proof: a narrower conjunction may retain the exact parent predicate. */
export function filterContained(parent: unknown, child: unknown): boolean {
  if(parent===undefined||parent===null)return true;
  if(child===undefined||child===null)return false;
  const stable=(value:unknown):string=>JSON.stringify(value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(stable(item))])):Array.isArray(value)?value.map(item=>JSON.parse(stable(item))):value);
  if(stable(parent)===stable(child))return true;
  const p=parent as {op?:string;args?:unknown[]},c=child as {op?:string;args?:unknown[]};
  if(p.op==="and"&&p.args)return p.args.every(part=>filterContained(part,child));
  return c.op==="and"&&!!c.args?.some(part=>filterContained(parent,part));
}
function hasOwnerPredicate(value:unknown):boolean {if(!value||typeof value!=="object")return false;const row=value as {op?:string;args?:unknown[]};return row.op==="owner_me"||!!row.args?.some(hasOwnerPredicate);}
/** Every acting subject must delegate through an independent, live path. The grant being edited cannot renew itself. */
function assertDelegation(ctx:ShareCtx,store:AccessStore,res:ResourceRec,subject:SubjectRef,level:Level,conditions:Cond,exclude?:string):void {
 const have=must(ctx,store,res,"edit","sharing");if(rank(res.type,level)>rank(res.type,have))raise(ctx.trace.traceId,"permission.not_contained",`you hold ${have} here and cannot give ${level}`);
 const snap=store.snapshot(),me=snap.info(ctx.principal.id);if(!me)raise(ctx.trace.traceId,"permission.no_grant");const subjects:Info[]=[me];
 const add=(id:string|null|undefined)=>{const who=id?snap.info(id):null;if(who&&!subjects.includes(who))subjects.push(who);};if(me.p.kind==="svc")add(me.p.owner);if(ctx.actingFor)add(ctx.actingFor.id);
 for(const who of subjects){if(res.ownerId===who.p.id)continue;
  const contained=matched(snap,store,who,res,ctx.now()).some(parent=>{
   if(parent.row.id===exclude||rank(res.type,parent.row.level)<rank(res.type,level)||!atLeast(res.type,parent.row.level,"edit"))return false;
   const original=store.grants.get(parent.row.id)?.conditions;
   if(Math.min(conditions.expiresAt??Infinity,conditions.window?.to??Infinity)>Math.min(parent.exp,parent.na)||(conditions.window?.from??-Infinity)<parent.nb)return false;
   if(parent.hidden.some(field=>!conditions.hiddenFields?.includes(field)))return false;
   if(!filterContained(parent.filter,conditions.rowFilter))return false;
   if(hasOwnerPredicate(parent.filter)&&(subject.kind!=="person"||subject.id!==who.p.id))return false;
   const ceiling=original?.labelCeiling;
   return !ceiling||labelRank(conditions.labelCeiling??"restricted")<=labelRank(ceiling);
  });
  if(!contained)raise(ctx.trace.traceId,"permission.not_contained","The new grant must stay inside an independent current grant, including its expiry, time window, row filter, hidden fields and sensitivity ceiling.");
 }
}
export async function updateGrant(ctx:ShareCtx,input:{grantId:string;level?:Level;conditions?:Cond}) {
 const store=storeOf(ctx),grant=store.grants.get(input.grantId);if(!grant)raise(ctx.trace.traceId,"validation.not_found","no such grant");
 const res=resourceOf(ctx,store,grant.resource),level=input.level??grant.level;let conditions=checkConditions(ctx,input.conditions??grant.conditions);checkSubject(ctx,store,grant.subject);
 if(grant.subject.kind==="link")conditions=checkLink(ctx,store,grant.subject,level,conditions);
 assertDelegation(ctx,store,res,grant.subject,level,conditions,grant.id);
 const ss=shareOf(ctx),wasFresh=isFresh(ctx,store,ss);grant.level=level;grant.conditions=conditions;
 const updated:{grantId:string;level:Level;expiresAt?:number}={grantId:grant.id,level};if(conditions.expiresAt!==undefined)updated.expiresAt=conditions.expiresAt;
 ctx.emit("grant.updated",grant.id,updated);changed(ctx,store,"assignment");commit(ctx,store,ss,wasFresh,[res.id],false);return {grant:grantView(grant)};
}

export async function share(ctx: ShareCtx, input: {
  resource: ResourceRef; subject: SubjectRef; level: Level; conditions?: Cond; source?: string; idempotencyKey?: string;
}) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  const trace = ctx.trace.traceId;
  const key = input.idempotencyKey ? `share:${ctx.principal.id}:${input.idempotencyKey}` : "";
  if (key) { const hit = ss.idem.get(key); if (hit) return hit as { grant: GrantRec }; }
  const res = resourceOf(ctx, store, input.resource);
  checkSubject(ctx, store, input.subject);
  let cond = checkConditions(ctx, input.conditions);
  if (input.subject.kind === "link") cond = checkLink(ctx, store, input.subject, input.level, cond);
  const wasFresh = isFresh(ctx, store, ss);
  const sameSource = input.source ?? undefined;
  let grant = [...store.grants.values()].find((g) =>
    g.subject.kind === input.subject.kind && g.subject.id === input.subject.id && g.resource.type === res.type && g.resource.id === res.id && g.source === sameSource);
  assertDelegation(ctx,store,res,input.subject,input.level,cond,grant?.id);
  const created = !grant;
  if (grant) { grant.level = input.level; grant.conditions = cond; }
  else {
    grant = {
      id: nid("gnt"), subject: { kind: input.subject.kind, id: input.subject.id }, resource: { type: res.type, id: res.id },
      level: input.level, conditions: cond, by: ctx.principal.id, createdAt: ctx.now(),
    };
    if (sameSource) grant.source = sameSource;
    store.grants.set(grant.id, grant);
  }
  if (created) {
    const p: { grantId: string; subject: SubjectRef; resource: ResourceRef; level: Level; source?: string } = {
      grantId: grant.id, subject: grant.subject, resource: grant.resource, level: grant.level,
    };
    if (grant.source) p.source = grant.source;
    ctx.emit("grant.created", grant.id, p);
  }
  changed(ctx, store, "assignment");
  if (res.type === "folder") ctx.emit("folder.shared", res.id, { folderId: res.id, subject: grant.subject, level: grant.level, removed: false });
  commit(ctx, store, ss, wasFresh, [res.id], false);
  const out = { grant: grantView(grant) };
  if (key) ss.idem.set(key, out);
  return out;
}

/** May this caller take this grant away: Manage on the resource, or the person who gave it and still holds Edit. */
function mayRemove(ctx: ShareCtx, store: AccessStore, g: GrantRec): boolean {
  if (g.resource.id === "*") return !!store.snapshot().info(ctx.principal.id)?.perms.has("access.manage");
  const res = store.resources.get(g.resource.id);
  if (!res) return !!store.snapshot().info(ctx.principal.id)?.perms.has("access.manage");
  const have = callerLevel(ctx, store, res);
  if (atLeast(res.type, have, "manage")) return true;
  return g.by === ctx.principal.id && atLeast(res.type, have, "edit");
}

export async function unshare(ctx: ShareCtx, input: { grantId?: string; resource?: ResourceRef; subject?: SubjectRef; source?: string }) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  const trace = ctx.trace.traceId;
  if (!input.grantId && !input.resource && !input.source) raise(trace, "validation.bad_input", "name a grant, a resource or a source");
  let doomed: GrantRec[];
  if (input.grantId) {
    const g = store.grants.get(input.grantId);
    if (!g) raise(trace, "validation.not_found", "no such grant");
    doomed = [g];
  } else {
    doomed = [...store.grants.values()].filter((g) => {
      if (input.resource && (g.resource.type !== input.resource.type || g.resource.id !== input.resource.id)) return false;
      if (input.subject && (g.subject.kind !== input.subject.kind || g.subject.id !== input.subject.id)) return false;
      if (input.source !== undefined && g.source !== input.source) return false;
      return true;
    });
  }
  for (const g of doomed) if (!mayRemove(ctx, store, g)) raise(trace, "permission.no_grant", "removing this access needs Manage on it");
  if (doomed.length === 0) return { revoked: 0 };
  const wasFresh = isFresh(ctx, store, ss);
  const roots = new Set<string>();
  for (const g of doomed) {
    store.grants.delete(g.id);
    if (g.resource.id !== "*") roots.add(g.resource.id);
    ctx.emit("grant.revoked", g.id, { grantId: g.id, subject: g.subject, resource: g.resource, reason: "unshared" });
  }
  changed(ctx, store, "assignment");
  for (const g of doomed) {
    if (g.resource.type === "folder") ctx.emit("folder.shared", g.resource.id, { folderId: g.resource.id, subject: g.subject, removed: true });
  }
  const typeWide = doomed.some((g) => g.resource.id === "*");
  commit(ctx, store, ss, wasFresh && !typeWide, [...roots], false);
  return { revoked: doomed.length };
}

export async function sharesOf(ctx: ShareCtx, input: { resource: ResourceRef }) {
  const store = storeOf(ctx);
  const res = resourceOf(ctx, store, input.resource);
  must(ctx, store, res, "view", "listing shares");
  const snap = store.snapshot();
  const chain = snap.chain(res.id) ?? [];
  const ids = new Set(chain.map((c) => c.id));
  const shares: { grant: ReturnType<typeof grantView>; through: "direct" | "group" | "role" | "folder" | "owner" }[] = [];
  if (res.ownerId) {
    shares.push({
      grant: {
        id: `gnt_owner${fnv(res.id)}`, subject: { kind: "person", id: res.ownerId }, resource: { type: res.type, id: res.id },
        level: "manage", conditions: {}, by: res.ownerId, createdAt: 0,
      },
      through: "owner",
    });
  }
  const now = ctx.now();
  const all = [...store.grants.values()].filter((g) => (g.resource.id === "*" ? g.resource.type === res.type : ids.has(g.resource.id)));
  all.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const g of all) {
    if (g.conditions.expiresAt !== undefined && g.conditions.expiresAt <= now) continue;
    const ancestor = g.resource.id !== "*" && g.resource.id !== res.id;
    const through = ancestor ? "folder" : g.subject.kind === "group" ? "group" : g.subject.kind === "role" ? "role" : "direct";
    shares.push({ grant: grantView(g), through });
  }
  return { shares };
}

// ---- folders -------------------------------------------------------------------------------------------------------

function cleanName(ctx: AccessCtx, name: string): string {
  const n = name.trim();
  if (!n) raise(ctx.trace.traceId, "validation.bad_input", "a folder needs a name");
  if (n.length > 120) raise(ctx.trace.traceId, "validation.bad_input", "a folder name is at most 120 characters");
  return n;
}

function siblingNamed(ss: ShareStore, f: { id: string; type: string; parentId: string | null; scope: string; owner: string }, name: string): boolean {
  const low = name.toLowerCase();
  for (const o of ss.folders.values()) {
    if (o.id === f.id || o.type !== f.type || o.parentId !== f.parentId || o.scope !== f.scope) continue;
    if (f.scope === "personal" && o.owner !== f.owner) continue;
    if (o.name.toLowerCase() === low) return true;
  }
  return false;
}

function folderView(ss: ShareStore, f: FolderRec, count: number) {
  const out: { id: string; type: string; name: string; parentId?: string; scope: "personal" | "space"; owner: string; count: number } = {
    id: f.id, type: f.type, name: f.name, scope: f.scope, owner: f.owner, count,
  };
  if (f.parentId) out.parentId = f.parentId;
  void ss;
  return out;
}

export async function foldersCreate(ctx: ShareCtx, input: { type: string; name: string; parentId?: string; scope?: "personal" | "space"; idempotencyKey?: string }) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  const trace = ctx.trace.traceId;
  const key = input.idempotencyKey ? `folders.create:${ctx.principal.id}:${input.idempotencyKey}` : "";
  if (key) { const hit = ss.idem.get(key); if (hit) return hit as { folder: ReturnType<typeof folderView> }; }
  const name = cleanName(ctx, input.name);
  let scope: "personal" | "space" = input.scope ?? "personal";
  let parent: { rec: FolderRec; res: ResourceRec } | null = null;
  if (input.parentId) {
    parent = folderOf(ctx, ss, store, input.parentId);
    if (parent.rec.type !== input.type) raise(trace, "validation.precondition_failed", "a folder holds one type of thing");
    must(ctx, store, parent.res, "edit", "adding a folder here");
    if (input.scope && input.scope !== parent.rec.scope) raise(trace, "validation.precondition_failed", "a folder takes the scope of the folder it sits in");
    scope = parent.rec.scope;
  }
  const mayShare = !!store.snapshot().info(ctx.principal.id)?.perms.has("access.manage");
  if (scope === "space" && !parent && !mayShare) raise(trace, "permission.role_lacks_permission", "a Space folder needs access.manage");
  const draft = { id: "", type: input.type, parentId: parent ? parent.rec.id : null, scope, owner: ctx.principal.id };
  if (siblingNamed(ss, draft, name)) raise(trace, "validation.duplicate", "a folder with that name is already there");
  const wasFresh = isFresh(ctx, store, ss);
  const id = nid("fld");
  const rec: FolderRec = { id, type: input.type, name, parentId: draft.parentId, scope, owner: ctx.principal.id, createdAt: ctx.now() };
  ss.folders.set(id, rec);
  store.resources.set(id, { id, type: "folder", parentId: rec.parentId, label: parent?.res.label ?? "public", ownerId: ctx.principal.id, holds: 0, row: { name, itemType: input.type, scope } });
  if (scope === "space" && !parent) {
    const grant: GrantRec = {
      id: nid("gnt"), subject: { kind: "group", id: EVERYONE }, resource: { type: "folder", id }, level: "view", conditions: {},
      by: ctx.principal.id, createdAt: ctx.now(), source: `${SPACE_FOLDER_SOURCE}${id}`,
    };
    store.grants.set(grant.id, grant);
    ctx.emit("grant.created", grant.id, { grantId: grant.id, subject: grant.subject, resource: grant.resource, level: grant.level, source: grant.source });
  }
  ctx.emit("folder.created", id, { folderId: id, ...(rec.parentId ? { parentId: rec.parentId } : {}), name });
  changed(ctx, store, "assignment");
  commit(ctx, store, ss, wasFresh, [id], true);
  const out = { folder: folderView(ss, rec, 0) };
  if (key) ss.idem.set(key, out);
  return out;
}

export async function foldersRename(ctx: ShareCtx, input: { folderId: string; name: string }) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  const { rec, res } = folderOf(ctx, ss, store, input.folderId);
  must(ctx, store, res, "manage", "renaming a folder");
  const name = cleanName(ctx, input.name);
  if (name === rec.name) return { folder: folderView(ss, rec, countIn(ctx, store, ss, rec.id)) };
  if (siblingNamed(ss, rec, name)) raise(ctx.trace.traceId, "validation.duplicate", "a folder with that name is already there");
  const from = rec.name;
  rec.name = name;
  if (res.row) res.row = { ...res.row, name };
  ctx.emit("folder.renamed", rec.id, { folderId: rec.id, from, to: name });
  persistFolders(ctx, ss);
  try { store.persist(ctx.db); } catch (e) { store.bump(); throw e; }
  return { folder: folderView(ss, rec, countIn(ctx, store, ss, rec.id)) };
}

function isAncestor(ss: ShareStore, ancestor: string, of: string): boolean {
  let cur: string | null = of;
  const seen = new Set<string>();
  while (cur !== null && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = ss.folders.get(cur)?.parentId ?? null;
  }
  return false;
}

export async function foldersMove(ctx: ShareCtx, input: { folderId: string; parentId: string | null }) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  const trace = ctx.trace.traceId;
  const { rec, res } = folderOf(ctx, ss, store, input.folderId);
  must(ctx, store, res, "manage", "moving a folder");
  const to = input.parentId;
  const from = rec.parentId;
  if (to === from) return { folder: folderView(ss, rec, countIn(ctx, store, ss, rec.id)) };
  let parent: { rec: FolderRec; res: ResourceRec } | null = null;
  if (to !== null) {
    parent = folderOf(ctx, ss, store, to);
    if (isAncestor(ss, rec.id, to)) raise(trace, "validation.precondition_failed", "a folder cannot move inside itself");
    if (parent.rec.type !== rec.type) raise(trace, "validation.precondition_failed", "a folder holds one type of thing");
    if (parent.rec.scope !== rec.scope) raise(trace, "validation.precondition_failed", "a Space folder and a personal folder do not nest");
    must(ctx, store, parent.res, "edit", "moving a folder here");
  }
  const moved = { id: rec.id, type: rec.type, parentId: to, scope: rec.scope, owner: rec.owner };
  if (siblingNamed(ss, moved, rec.name)) raise(trace, "validation.duplicate", "a folder with that name is already there");
  const wasFresh = isFresh(ctx, store, ss);
  rec.parentId = to;
  res.parentId = to;
  if (to !== null) ctx.emit("folder.moved", rec.id, { folderId: rec.id, ...(from ? { fromParentId: from } : {}), toParentId: to });
  ctx.emit("item.moved", rec.id, {
    resource: { type: "folder", id: rec.id }, ...(from ? { fromFolderId: from } : {}), ...(to ? { toFolderId: to } : {}),
  });
  changed(ctx, store, "assignment");
  commit(ctx, store, ss, wasFresh, [rec.id], true);
  return { folder: folderView(ss, rec, countIn(ctx, store, ss, rec.id)) };
}

/** Put an item back under the parent it had, or under nothing; an item with no owner goes to the person taking it out so it is never orphaned. */
function release(ctx: ShareCtx, store: AccessStore, ss: ShareStore, key: string, res: ResourceRec, orphanGuard: boolean): void {
  const back = ss.prev.get(key) ?? null;
  res.parentId = back !== null && store.resources.has(back) ? back : null;
  if (orphanGuard && res.ownerId === null) res.ownerId = ctx.principal.id;
  ss.placement.delete(key);
  ss.prev.delete(key);
}

export async function foldersDelete(ctx: ShareCtx, input: { folderId: string }) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  const { rec, res } = folderOf(ctx, ss, store, input.folderId);
  must(ctx, store, res, "manage", "deleting a folder");
  const wasFresh = isFresh(ctx, store, ss);
  const doomed = [...ss.folders.values()].filter((f) => isAncestor(ss, rec.id, f.id)).map((f) => f.id);
  const gone = new Set(doomed);
  const roots: string[] = [];
  const moves: { res: ResourceRec; from: string }[] = [];
  for (const [key, fid] of [...ss.placement]) {
    if (!gone.has(fid)) continue;
    const cut = key.indexOf(":");
    const item = store.resources.get(key.slice(cut + 1));
    ss.placement.delete(key);
    if (!item) { ss.prev.delete(key); continue; }
    release(ctx, store, ss, key, item, true);
    roots.push(item.id);
    moves.push({ res: item, from: fid });
  }
  for (const [id, g] of [...store.grants]) {
    if (g.resource.type === "folder" && gone.has(g.resource.id)) {
      store.grants.delete(id);
      ctx.emit("grant.revoked", id, { grantId: id, subject: g.subject, resource: g.resource, reason: "folder_deleted" });
    }
  }
  for (const id of doomed) {
    ss.folders.delete(id);
    store.resources.delete(id);
  }
  for (const m of moves) ctx.emit("item.moved", m.res.id, { resource: { type: m.res.type, id: m.res.id }, fromFolderId: m.from });
  for (const id of doomed) ctx.emit("folder.deleted", id, { folderId: id });
  changed(ctx, store, "assignment");
  commit(ctx, store, ss, wasFresh, roots, true);
  return { deleted: true };
}

/** What an item takes with it into a folder: the grants on the folder and its ancestors that are live now. */
function inheritedGrants(store: AccessStore, folderId: string, now: number): GrantRec[] {
  const chain = store.snapshot().chain(folderId) ?? [];
  const ids = new Set(chain.map((c) => c.id));
  return [...store.grants.values()].filter((g) => ids.has(g.resource.id) && (g.conditions.expiresAt === undefined || g.conditions.expiresAt > now));
}

export async function foldersPlace(ctx: ShareCtx, input: { resource: ResourceRef; folderId: string }) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  const trace = ctx.trace.traceId;
  const res = resourceOf(ctx, store, input.resource);
  if (res.type === "folder") raise(trace, "validation.precondition_failed", "move a folder with folders.move");
  const { rec: folder, res: folderRes } = folderOf(ctx, ss, store, input.folderId);
  if (folder.type !== res.type) raise(trace, "validation.precondition_failed", `this folder holds ${folder.type} items`);
  const key = pk(res.type, res.id);
  const current = ss.placement.get(key) ?? null;
  if (current === folder.id) return { ok: true };
  const have = must(ctx, store, res, current ? "manage" : "edit", "moving it");
  must(ctx, store, folderRes, "edit", "adding to this folder");
  // putting it in a folder hands the folder's access to the item; you cannot hand over more than you hold on the item
  const wasFresh = isFresh(ctx, store, ss);
  for (const g of inheritedGrants(store, folder.id, ctx.now())) {
    if (rank(res.type, g.level) > rank(res.type, have)) raise(trace, "permission.not_contained", `the folder gives ${g.level} and you hold ${have} on this`);
  }
  if (current) release(ctx, store, ss, key, res, false);
  if (!ss.prev.has(key)) ss.prev.set(key, res.parentId);
  ss.placement.set(key, folder.id);
  res.parentId = folder.id;
  ctx.emit("item.moved", res.id, { resource: { type: res.type, id: res.id }, ...(current ? { fromFolderId: current } : {}), toFolderId: folder.id });
  changed(ctx, store, "assignment");
  commit(ctx, store, ss, wasFresh, [res.id], true);
  return { ok: true };
}

export async function foldersUnplace(ctx: ShareCtx, input: { resource: ResourceRef }) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  const res = resourceOf(ctx, store, input.resource);
  const key = pk(res.type, res.id);
  const current = ss.placement.get(key);
  if (!current) return { ok: true };
  // taking it out removes what the folder gave others, so it needs Manage
  must(ctx, store, res, "manage", "taking it out of the folder");
  const wasFresh = isFresh(ctx, store, ss);
  release(ctx, store, ss, key, res, true);
  ctx.emit("item.moved", res.id, { resource: { type: res.type, id: res.id }, fromFolderId: current });
  changed(ctx, store, "assignment");
  commit(ctx, store, ss, wasFresh, [res.id], true);
  return { ok: true };
}

// ---- lists --------------------------------------------------------------------------------------------------------------

function titleOf(ss: ShareStore, res: ResourceRec): string {
  const f = ss.folders.get(res.id);
  if (f) return f.name;
  const t = res.row?.["title"] ?? res.row?.["name"];
  return typeof t === "string" && t ? t : res.id;
}

/** Items of one type this person can see, with their section. Section comes from `via` alone, so a replica can compute it from my_access. */
function mine(ctx: AccessCtx, store: AccessStore, ss: ShareStore, person: string, type: string): AccessRow[] {
  ensureFresh(ctx, store, ss);
  const out: AccessRow[] = [];
  for (const row of ss.access.values()) if (row.person === person && row.type === type) out.push(row);
  return out;
}

export const sectionOfVia = (via: Via): Section => (via === "owner" ? "personal" : via === "space" ? "space" : "shared");

function countIn(ctx: AccessCtx, store: AccessStore, ss: ShareStore, folderId: string, person?: string): number {
  const who = person ?? ctx.principal.id;
  ensureFresh(ctx, store, ss);
  let n = 0;
  for (const [key, fid] of ss.placement) {
    if (!isAncestor(ss, folderId, fid)) continue;
    const cut = key.indexOf(":");
    if (ss.access.has(ak(who, key.slice(0, cut), key.slice(cut + 1)))) n++;
  }
  return n;
}

export async function foldersList(ctx: ShareCtx, input: { type: string; scope?: "personal" | "space" }) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  ensureFresh(ctx, store, ss);
  const folders = [...ss.folders.values()]
    .filter((f) => f.type === input.type && (!input.scope || f.scope === input.scope) && ss.access.has(ak(ctx.principal.id, "folder", f.id)))
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.id < b.id ? -1 : 1));
  return { folders: folders.map((f) => folderView(ss, f, countIn(ctx, store, ss, f.id))) };
}

export async function lists(ctx: ShareCtx, input: { type: string; section?: Section; folder?: string; cursor?: string; limit?: number }) {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  const person = ctx.principal.id;
  const rows = mine(ctx, store, ss, person, input.type);
  const marks = ctx.marks?.(person, input.type);
  const starred = marks?.starred ?? new Set<string>();
  const following = marks?.following ?? new Set<string>();
  const counts: Record<string, number> = { personal: 0, shared: 0, space: 0, starred: 0, following: 0 };
  const picked: AccessRow[] = [];
  for (const r of rows) {
    const sec = sectionOfVia(r.via);
    counts[sec] = (counts[sec] ?? 0) + 1;
    if (starred.has(r.id)) counts["starred"] = (counts["starred"] ?? 0) + 1;
    if (following.has(r.id)) counts["following"] = (counts["following"] ?? 0) + 1;
    const folderId = ss.placement.get(pk(r.type, r.id));
    if (folderId) counts[folderId] = (counts[folderId] ?? 0) + 1;
    if (input.section === "starred" ? !starred.has(r.id) : input.section === "following" ? !following.has(r.id) : input.section && sec !== input.section) continue;
    if (input.folder && folderId !== input.folder) continue;
    picked.push(r);
  }
  const view = picked.map((r) => {
    const res = store.resources.get(r.id);
    const folderId = ss.placement.get(pk(r.type, r.id));
    const row: { type: string; id: string; title: string; via: Via; level: Level; folderId?: string; starred: boolean; following: boolean } = {
      type: r.type, id: r.id, title: res ? titleOf(ss, res) : r.id, via: r.via, level: r.level, starred: starred.has(r.id), following: following.has(r.id),
    };
    if (folderId) row.folderId = folderId;
    return row;
  }).sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : a.id < b.id ? -1 : 1));
  const p = page(view, input.cursor, input.limit);
  return { rows: p.rows, counts, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

/** Rebuild the cache and return a person's rows; used by tests and by the sync filter. */
export function myAccess(ctx: AccessCtx, person: string): AccessRow[] {
  const store = storeOf(ctx);
  const ss = shareOf(ctx);
  ensureFresh(ctx, store, ss);
  return [...ss.access.values()].filter((r) => r.person === person);
}
