// Prototype seed (ARCH 10.3). Each Space is built by calling the real capability pipeline (validate, authorize, idempotency, rate limit, handler, commit),
// then exported as a template database keyed by the recipe sources plus generated/hash.txt. A boot copies that file and reads the log.
// The founding owner is one genesis event: no capability creates a Space. Everyone else, every agent and every client is a capability call.
// Personal does not call members.* (those capabilities are teamOnly, spec 2.1).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import { createIdempotency } from "../../../kernel/src/idempotency/index.ts";
import type { IdemRecord } from "../../../kernel/src/idempotency/index.ts";
import { LogStore } from "../../../kernel/src/log/store.ts";
import type { NewEvent, StoredEvent } from "../../../kernel/src/log/types.ts";
import { cacheDir, copyTemplate, templateKey } from "../core/cache.ts";
import type { Template } from "../core/cache.ts";
import { registry } from "../../../generated/registry.ts";
import { roleDefaults } from "../../../generated/permissions.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import { createInvoke, createRateLimiter, fail, HostError, indexCapabilities } from "../../../host/src/invoke.ts";
import type { CtxSeed, Handler } from "../../../host/src/invoke.ts";
import { VYRE_SEED, agentId, clientId, companyId, personId } from "./seed.ts";
import type { SeedClient, SeedIds, SeedPerson, SeedSpace, SpaceKey } from "./seed.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const NOW = 1_790_000_000_000;
const TRACE = "c0ffee00c0ffee00c0ffee00c0ffee00";
const ROLES = ["owner", "admin", "developer", "member", "guest"] as const;
const CLEARANCE: Record<(typeof ROLES)[number], number> = { owner: 3, admin: 3, developer: 2, member: 2, guest: 1 };
const KEYS = {
  personKeyByPassword: "d3JhcHBlZA==", publicKey: "cHVibGlj", privateKeyWrapped: "d3JhcHBlZA==",
  spaceKeys: [{ epoch: 0, wrapped: "d3JhcHBlZA==" }],
};

/** The files whose content defines the template. */
export const PROTO_SOURCES: readonly string[] = [path.join(HERE, "seed.ts"), path.join(HERE, "build.ts")];
export const registryHash = (): string => fs.readFileSync(path.join(REPO, "generated/hash.txt"), "utf8").trim();

export interface BootOptions { cache?: string; scratch?: string; sources?: readonly string[]; registry?: string }
export interface PrototypeSpace extends SeedIds {
  key: SpaceKey;
  space: string;
  hit: boolean;
  template: string;
  file: string;
  invited: number;
  joined: number;
  verified: boolean;
  close(): void;
}

interface Invite { id: string; code: string; role: string; username: string; createdBy: string; state: "open" | "accepted" }
interface Who { id: string; kind: "person" | "actor"; preAuth?: boolean }

const dropUndef = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function toNew(e: EventEnvelope): NewEvent {
  return dropUndef({
    id: e.id, type: e.type, sv: e.sv, hlc: e.hlc, trace_id: e.traceId, span_id: e.spanId, actor: e.actor, on_behalf: e.onBehalf,
    device: e.device, run_id: e.runId, cause: e.cause, origin: e.origin, depth: e.depth, entity: e.entity, entity_id: e.entityId,
    fields: e.fields, label: e.label, vis: e.vis, enc: e.enc, payload: e.payload,
  }) as NewEvent;
}

function payloadOf(ev: StoredEvent): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(ev.payload)) as Record<string, unknown>;
}

export function idsFrom(events: readonly StoredEvent[]): SeedIds & { invited: number; joined: number } {
  const people: string[] = [], agents: string[] = [], clients: string[] = [], companies: string[] = [];
  let invited = 0, joined = 0;
  for (const ev of events) {
    const p = payloadOf(ev);
    if (ev.type === "principal.created" && p["kind"] === "person" && typeof p["principalId"] === "string") people.push(p["principalId"]);
    if (ev.type === "agent.created" && typeof p["agentId"] === "string") agents.push(p["agentId"]);
    if (ev.type === "record.created" && p["type"] === "contact" && typeof p["recordId"] === "string") clients.push(p["recordId"]);
    if (ev.type === "record.created" && p["type"] === "company" && typeof p["recordId"] === "string") companies.push(p["recordId"]);
    if (ev.type === "member.invited") invited += 1;
    if (ev.type === "member.joined") joined += 1;
  }
  return { people, agents, clients, companies, invited, joined };
}

/** Two columns, prototype then seeded, one id per row. */
export function idColumns(proto: readonly string[], seeded: readonly string[]): string {
  const width = Math.max(9, ...proto.map((s) => s.length), ...seeded.map((s) => s.length));
  const n = Math.max(proto.length, seeded.length);
  const lines = [`${"prototype".padEnd(width)}  seeded`];
  for (let i = 0; i < n; i++) lines.push(`${(proto[i] ?? "").padEnd(width)}  ${seeded[i] ?? ""}`);
  return lines.join("\n");
}

function accessFor(spec: SeedSpace, ownerId: string, ownerName: string): AccessSnapshot {
  const s = new AccessSnapshot();
  for (const role of ROLES) {
    const perms = Object.entries(roleDefaults).filter(([, d]) => d[role] === true).map(([k]) => k);
    s.putRole({ id: role, clearance: CLEARANCE[role], perms, name: role });
  }
  s.putPrincipal({ id: ownerId, kind: "person", status: "active", name: ownerName });
  s.addPrincipalRole({ holder: ownerId, role: "owner" });
  s.putResource({ id: spec.spaceId, type: "space", parent_id: null, label: 0, owner_id: ownerId, holds: 0 });
  s.putResource({ id: "contact", type: "record_type", parent_id: spec.spaceId, label: 0, owner_id: ownerId, holds: 0 });
  s.putResource({ id: "company", type: "record_type", parent_id: spec.spaceId, label: 0, owner_id: ownerId, holds: 0 });
  s.putGrant({ id: "gnt_owner", subject_kind: "role", subject_id: "owner", resource_type: "space", resource_id: spec.spaceId, level: "manage" });
  return s;
}

function handlersFor(spec: SeedSpace, ownerId: string): Record<string, Handler> {
  const invites = new Map<string, Invite>();
  const people = new Set<string>([ownerId]);
  const agents = new Set<string>();
  const records = new Set<string>();
  const byEmail = new Map(spec.people.map((p) => [p.email, p] as const));
  const byClientEmail = new Map(spec.clients.map((c) => [c.email, c] as const));
  const byOrg = new Map(spec.clients.map((c) => [c.org, c] as const));

  const onInvite: Handler = (ctx, input: any) => {
    const email = input.email;
    const person: SeedPerson | undefined = typeof email === "string" ? byEmail.get(email) : undefined;
    if (!person || person.role === "owner") throw fail("validation.bad_input", ctx.trace.traceId, { details: { errors: ["/email: no such person to invite"] } });
    if (typeof input.role !== "string" || input.role !== `rol_${person.role}`) throw fail("validation.bad_input", ctx.trace.traceId, { details: { errors: ["/role: does not match the seed"] } });
    const code = person.id;
    if (invites.has(code) || people.has(personId(person.id))) throw fail("validation.duplicate", ctx.trace.traceId, { details: { username: person.id } });
    const invite: Invite = { id: `inv_${person.id}`, code, role: input.role, username: person.id, createdBy: ctx.principal.id, state: "open" };
    invites.set(code, invite);
    const at = ctx.now();
    ctx.emit("member.invited", `entity/${invite.id}`, { inviteId: invite.id, role: invite.role, expiresAt: at + 7 * 86_400_000 });
    return {
      invite: {
        id: invite.id, role: invite.role, groups: [], agents: [], projects: [], channels: [], email, expiresAt: at + 7 * 86_400_000,
        createdBy: invite.createdBy, state: "open", createdAt: at,
      },
      link: `https://${spec.domain}/join/${code}`,
    };
  };

  const onAccept: Handler = (ctx, input: any) => {
    const code = input.code;
    const username = input.username;
    const invite = typeof code === "string" ? invites.get(code) : undefined;
    if (!invite || invite.state !== "open" || username !== invite.username) throw fail("auth.invalid_code", ctx.trace.traceId, { message: "That invite code is not open." });
    const id = personId(invite.username);
    if (people.has(id)) throw fail("validation.duplicate", ctx.trace.traceId, { details: { personId: id } });
    people.add(id);
    invite.state = "accepted";
    ctx.emit("member.joined", `entity/${id}`, { personId: id, inviteId: invite.id, role: invite.role, invitedBy: invite.createdBy });
    ctx.emit("principal.created", `entity/${id}`, { principalId: id, kind: "person" });
    return { personId: id, sessionId: `ses_${invite.username}`, token: `seed-${invite.username}`, epoch: 0 };
  };

  const onAgent: Handler = (ctx, input: any) => {
    const name = input.name;
    if (typeof name !== "string" || name.length === 0) throw fail("validation.bad_input", ctx.trace.traceId, { details: { errors: ["/name: required"] } });
    const id = agentId(name);
    const owner = typeof input.ownerId === "string" ? input.ownerId : ctx.principal.id;
    if (agents.has(id)) throw fail("validation.duplicate", ctx.trace.traceId, { details: { agentId: id } });
    agents.add(id);
    const slug = name.toLowerCase();
    ctx.emit("agent.created", `agent/${id}`, { agentId: id, name, ownerId: owner, templateVersion: 1 });
    return {
      agent: {
        agentId: id, name, face: typeof input.face === "string" ? input.face : slug, status: "awake", ownerId: owner, folderId: `fld_${slug}`,
        accountPolicy: "asker", toolsAllowed: [], toolsDenied: [], vaultKeys: [], limits: {}, captureMode: "propose", hasComputer: false,
        templateVersion: 1, createdAt: ctx.now(),
      },
    };
  };

  const onRecord: Handler = (ctx, input: any) => {
    const type = input.type;
    const fields = input.fields ?? {};
    let id: string | undefined;
    let client: SeedClient | undefined;
    if (type === "contact" && typeof fields["email"] === "string") client = byClientEmail.get(fields["email"]);
    if (type === "company" && typeof fields["name"] === "string") client = byOrg.get(fields["name"]);
    if (client && type === "contact") id = clientId(client.id);
    if (client && type === "company") id = companyId(client.id);
    if (!id || (type !== "contact" && type !== "company")) throw fail("validation.bad_input", ctx.trace.traceId, { details: { errors: ["/type: the seed knows contact and company rows from VyreSeed"] } });
    if (records.has(id)) throw fail("validation.duplicate", ctx.trace.traceId, { details: { recordId: id } });
    records.add(id);
    const at = ctx.now();
    ctx.emit("record.created", `record/${id}`, { recordId: id, type, fields: { ...fields } });
    return { record: { id, type, version: 1, label: 1, fields, createdAt: at, updatedAt: at, holds: 0 } };
  };

  return { "members.invites.create": onInvite, "members.accept": onAccept, "agents.create": onAgent, "records.create": onRecord };
}

async function fill(store: LogStore, spec: SeedSpace): Promise<void> {
  const owner = spec.people.find((p) => p.role === "owner");
  if (!owner || spec.people.filter((p) => p.role === "owner").length !== 1) throw new Error(`${spec.name} needs one owner`);
  const ownerId = personId(owner.id);
  if (spec.kind === "personal" && (spec.people.length !== 1 || spec.clients.length !== 0)) throw new Error(`${spec.name} seeds its owner and agents only`);
  const genesis = store.appendBatch([{
    id: `evt_seed_${spec.key}_owner`, type: "principal.created", sv: 1, trace_id: TRACE, actor: "svc_seed", vis: "space",
    entity: "entity", entity_id: ownerId, payload: { principalId: ownerId, kind: "person" },
  }]);
  const g = genesis[0];
  if (!g?.ok) throw new Error(`owner seed refused: ${g && !g.ok ? g.message : "missing result"}`);

  const access = accessFor(spec, ownerId, owner.name);
  const mem = new Map<string, IdemRecord>();
  const handlers = handlersFor(spec, ownerId);
  const invoke = createInvoke({
    caps: indexCapabilities(registry.capabilities),
    validateInput, validateEvent,
    authorize: (req) => authorize(access, req),
    handler: (cap) => handlers[cap],
    commit: async (b) => {
      if (b.events.length === 0) return [];
      const results = store.appendBatch(b.events.map(toNew));
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r?.ok) throw fail("internal.unexpected", b.events[i]?.traceId ?? TRACE, { details: { message: r && !r.ok ? r.message : "missing append result", cap: b.cap } });
      }
      return b.events;
    },
    idem: createIdempotency({ get: (key) => mem.get(key) ?? null, put: (key, _p, _c, rec) => { mem.set(key, rec); } }),
    rate: createRateLimiter(),
    now: () => NOW,
  });

  const call = async (cap: string, input: unknown, who: Who): Promise<Record<string, unknown>> => {
    const seed: CtxSeed = { space: spec.spaceId, principal: { kind: who.kind, id: who.id }, ...(who.preAuth ? { preAuth: true } : {}) };
    let result;
    try { result = await invoke(cap, input, seed); }
    catch (e) {
      if (e instanceof HostError) throw new Error(`${cap} refused: ${e.error.code}${e.error.details ? ` ${JSON.stringify(e.error.details)}` : ""}`);
      throw e;
    }
    if (result.status !== "ok") throw new Error(`${cap} held`);
    const bad = validateOutput(cap, 1, result.output);
    if (bad.length) throw new Error(`${cap} output does not match the contract: ${bad.slice(0, 8).join("; ")}`);
    return result.output as Record<string, unknown>;
  };

  const asOwner: Who = { id: ownerId, kind: "person" };
  if (spec.kind === "team") {
    for (const p of spec.people) {
      if (p.role === "owner") continue;
      const created = await call("members.invites.create", { role: `rol_${p.role}`, email: p.email, idempotencyKey: `invite:${p.id}` }, asOwner);
      const link = created["link"];
      if (typeof link !== "string") throw new Error("members.invites.create returned no link");
      const code = link.slice(link.lastIndexOf("/") + 1);
      await call("members.accept", {
        code, username: p.id, displayName: p.name, password: "seed-password", deviceName: "Seed", deviceClass: "desktop", keys: KEYS,
      }, { id: "act_join", kind: "actor", preAuth: true });
    }
  }
  for (const name of spec.agents) {
    await call("agents.create", { name, face: name.toLowerCase(), ownerId, idempotencyKey: `agent:${agentId(name)}` }, asOwner);
  }
  for (const c of spec.clients) {
    await call("records.create", { type: "company", fields: { name: c.org }, idempotencyKey: `co:${c.id}` }, asOwner);
    await call("records.create", {
      type: "contact", fields: { name: c.name, email: c.email, phone: c.phone, company: [companyId(c.id)] }, idempotencyKey: `contact:${c.id}`,
    }, asOwner);
  }
}

/** Build the template database for one Space. */
export async function buildInto(file: string, spec: SeedSpace): Promise<void> {
  const store = new LogStore({ db: new DatabaseSync(file), space: spec.spaceId, clock: () => NOW });
  try {
    await fill(store, spec);
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  } finally { store.close(); }
}

/** The template file for one Space, built through capabilities when missing. */
export async function ensurePrototype(dir: string, key: SpaceKey, hash: string): Promise<Template> {
  const spec = VYRE_SEED[key];
  const file = path.join(dir, `prototype-${key}-${hash}.db`);
  if (fs.existsSync(file)) return { path: file, hit: true };
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try { await buildInto(tmp, spec); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, { force: true }); fs.rmSync(`${tmp}-wal`, { force: true }); fs.rmSync(`${tmp}-shm`, { force: true }); }
  return { path: file, hit: false };
}

/** Open a copy of the exported template and read its ids. */
export async function bootPrototype(key: SpaceKey, o: BootOptions = {}): Promise<PrototypeSpace> {
  const hash = templateKey(o.sources ?? PROTO_SOURCES, o.registry ?? registryHash());
  const tpl = await ensurePrototype(o.cache ?? cacheDir(), key, hash);
  const scratch = o.scratch ?? os.tmpdir();
  const file = copyTemplate(tpl, scratch);
  const store = new LogStore({ db: new DatabaseSync(file), space: VYRE_SEED[key].spaceId });
  const verified = store.verify();
  const ids = idsFrom(store.read({ limit: 500 }));
  return {
    key, space: VYRE_SEED[key].spaceId, hit: tpl.hit, template: tpl.path, file, ...ids, verified: verified.ok,
    close: () => { store.close(); fs.rmSync(file, { force: true }); fs.rmSync(`${file}-wal`, { force: true }); fs.rmSync(`${file}-shm`, { force: true }); },
  };
}

