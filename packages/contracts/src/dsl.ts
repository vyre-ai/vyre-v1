// Builder DSL for manifests. Everything here returns plain data (section 3 types); manifests stay pure data.
import type {
  AgentToolDef, BlockTypeDef, CapabilityDef, CapName, ComponentKey, ConnectorDef, EntityDef, EntityFieldDef, ErrorCode, EventDef,
  EventName, FieldDef, FieldTypeDef, FilterOp, GateActKindDef, HealthCheckDef, ImportSourceDef, JsonSchema, KitScreenDef, Label, Level,
  ListDef, Manifest, NotificationKindDef, PermissionDef, PlaceId, RecordTypeDef, ResourceBinding, ResourceType, RetentionDef, Risk,
  RoleName, SettingDef, StepDef, TaskKindDef, TaskState, Toolset, TriggerDef, ViewKindDef,
} from './types.ts';
import { sample } from './jsonschema.ts';

type S = JsonSchema;
export type Props = Record<string, JsonSchema>;
export type SchemaLike = JsonSchema | Props;

const OPT = Symbol('optional');

function isSchema(x: SchemaLike): x is JsonSchema {
  const o = x as Record<string, unknown>;
  return typeof o.type === 'string' || Array.isArray(o.type) || Array.isArray(o.anyOf) || Array.isArray(o.enum) || typeof o.description === 'string';
}

function clean(s: JsonSchema): JsonSchema {
  return Object.fromEntries(Object.entries(s)) as JsonSchema;
}

function buildObject(props: Props, extra: Partial<JsonSchema> = {}): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const k of Object.keys(props)) {
    const s = props[k] as JsonSchema;
    if ((s as unknown as Record<symbol, unknown>)[OPT] !== true) required.push(k);
    properties[k] = clean(s);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), ...extra };
}

export function toSchema(x: SchemaLike): JsonSchema {
  return isSchema(x) ? x : buildObject(x);
}

/** Schema builders. `t.opt(x)` marks a property optional inside `t.obj` or a props record. */
export const t = {
  str: (o: Partial<JsonSchema> = {}): S => ({ type: 'string', ...o }),
  int: (o: Partial<JsonSchema> = {}): S => ({ type: 'integer', ...o }),
  num: (o: Partial<JsonSchema> = {}): S => ({ type: 'number', ...o }),
  bool: (): S => ({ type: 'boolean' }),
  nul: (): S => ({ type: 'null' }),
  id: (prefix: string): S => ({ type: 'string', pattern: `^${prefix}_[a-z0-9]+$`, examples: [`${prefix}_a1b2c3`] }),
  ts: (): S => ({ type: 'integer', minimum: 0, examples: [1760000000000], description: 'Milliseconds since the Unix epoch' }),
  json: (): S => ({ description: 'Any JSON value' }),
  any: (): S => ({ description: 'Any JSON value' }),
  enm: (...vals: string[]): S => ({ type: 'string', enum: vals }),
  lit: (v: string | number | boolean): S => ({ type: typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : 'boolean', const: v }),
  arr: (items: SchemaLike, o: Partial<JsonSchema> = {}): S => ({ type: 'array', items: toSchema(items), ...o }),
  obj: (props: Props = {}, extra: Partial<JsonSchema> = {}): S => buildObject(props, extra),
  rec: (v?: SchemaLike): S => ({ type: 'object', additionalProperties: v ? toSchema(v) : true }),
  opt: (s: JsonSchema): S => Object.assign({}, s, { [OPT]: true }) as S,
  nullable: (s: JsonSchema): S => ({ anyOf: [clean(s), { type: 'null' }] }),
  union: (...s: JsonSchema[]): S => ({ anyOf: s.map(clean) }),
};

// ---------------------------------------------------------------- capabilities

export interface CapOpts {
  in?: SchemaLike;
  out?: SchemaLike;
  on?: readonly [ResourceType, string];            // resource type and JSON pointer to its id in the input
  parent?: string;                                 // with `on`: pointer to the parent id
  resolve?: 'name' | 'handle';                     // with `on`: the input holds a name or handle, not an id
  make?: readonly [ResourceType, string];          // creation: resource type and pointer to the parent id
  dyn?: string | { ref: string; allowed?: ResourceType[]; parent?: string };   // resource named in the input as a {type,id} ResourceRef (see resourceRef in _common.ts)
  row?: readonly [string, string];                 // resource is an entity row: entity key and pointer to its id; access follows the EntityDef acl
  space?: boolean;                                 // force the Space binding even when the input carries a resource ref
  caller?: 'principal' | 'anonymous' | 'pending';  // pre-auth capabilities; never exposed to agents
  perm?: string | null;
  level?: Level;
  risk?: Risk;
  emits?: EventName[];
  gate?: string | { act: string; when?: string; reason?: string };
  idem?: 'key' | 'natural' | 'none';
  audit?: 'always' | 'sensitive' | 'none';
  label?: 'check' | 'filter';
  offline?: 'patch' | 'queue' | 'online';
  run?: { kind: string; stoppable: boolean };
  rate?: { n: number; perSeconds: number; scope: 'principal' | 'space' };
  tool?: Toolset;                                  // MCP toolset; omitted = no MCP tool
  mcpName?: string;
  deferred?: boolean;
  agent?: boolean | { planMode: 'allowed' | 'blocked'; blocks?: string[] };
  http?: 'auto' | { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string };
  cli?: string;
  hook?: boolean;                                  // may be subscribed as an outbound webhook
  errors?: ErrorCode[];
  forbids?: CapabilityDef['forbids'];
  team?: boolean;                                  // teamOnly
  since?: string;
  ex?: { input?: unknown; output?: unknown };      // override the generated example
}

function withIdempotency(s: JsonSchema): JsonSchema {
  if (s.type !== 'object') return s;
  const properties = { ...(s.properties ?? {}), idempotencyKey: { type: 'string', minLength: 1, examples: ['idem_1'] } as JsonSchema };
  const required = Array.from(new Set([...(s.required ?? []), 'idempotencyKey']));
  return { ...s, properties, required };
}

function makeCap(kind: CapabilityDef['effects'], name: string, summary: string, o: CapOpts): CapabilityDef {
  const idem = o.idem ?? 'natural';
  let input = toSchema(o.in ?? {});
  if (idem === 'key') input = withIdempotency(input);
  const output = toSchema(o.out ?? {});
  const level: Level = o.level ?? (kind === 'read' ? 'view' : kind === 'write' ? 'edit' : 'use');
  const risk: Risk = o.risk ?? (kind === 'read' ? 'low' : kind === 'write' ? 'medium' : 'high');
  const permission = o.perm === undefined ? null : o.perm;
  let resource: ResourceBinding = { type: 'space' };
  if (o.on) resource = { type: o.on[0], id: o.on[1], ...(o.parent ? { parent: o.parent } : {}), ...(o.resolve ? { resolve: o.resolve } : {}) };
  if (o.make) resource = { type: o.make[0], create: true, parent: o.make[1] };
  if (o.row) resource = { type: 'entity', entity: o.row[0], id: o.row[1] };
  const refProp = input.properties?.resource;
  if (!o.on && !o.make && !o.dyn && !o.row && !o.space && refProp && (input.required ?? []).includes('resource') && refProp.properties?.type?.enum && refProp.properties?.id) resource = { type: 'dynamic', ref: '/resource' };
  if (o.dyn) resource = typeof o.dyn === 'string' ? { type: 'dynamic', ref: o.dyn } : { type: 'dynamic', ref: o.dyn.ref, ...(o.dyn.allowed ? { allowed: o.dyn.allowed } : {}), ...(o.dyn.parent ? { parent: o.dyn.parent } : {}) };
  const errs = new Set<ErrorCode>(['validation.bad_input', 'internal.unexpected', 'permission.no_grant', 'permission.above_clearance']);
  if (permission) errs.add('permission.role_lacks_permission');
  if (o.on) errs.add('validation.not_found');
  if (o.team) errs.add('permission.needs_team');
  if (kind === 'outward') { errs.add('provider.unavailable'); errs.add('provider.network'); }
  for (const c of o.errors ?? []) errs.add(c);
  const gate = o.gate === undefined ? undefined : typeof o.gate === 'string' ? { act: o.gate } : o.gate;
  const surfaces: CapabilityDef['surfaces'] = { http: o.http ?? 'auto' };
  if (o.tool) surfaces.mcp = { toolset: o.tool, ...(o.mcpName ? { name: o.mcpName } : {}), ...(o.deferred ? { deferred: true } : {}) };
  if (o.agent !== undefined) surfaces.agent = o.agent;
  if (o.cli) surfaces.cli = o.cli;
  if (o.hook) surfaces.outboundWebhook = true;
  const cap: CapabilityDef = {
    name: name as CapName,
    v: 1,
    summary,
    input,
    output,
    errors: Array.from(errs).sort(),
    resource,
    permission,
    level,
    risk,
    effects: kind,
    ...(gate ? { gate } : {}),
    emits: o.emits ?? [],
    idempotency: idem,
    ...(o.audit ? { audit: o.audit } : {}),
    ...(o.label ? { label: o.label } : {}),
    ...(o.offline ? { offline: o.offline } : {}),
    ...(o.run ? { run: o.run } : {}),
    ...(o.rate ? { rate: o.rate } : {}),
    surfaces,
    examples: [{ name: 'example', input: o.ex?.input ?? sample(input), output: o.ex?.output ?? sample(output) }],
    ...(o.forbids ? { forbids: o.forbids } : {}),
    ...(o.caller && o.caller !== 'principal' ? { caller: o.caller } : {}),
    ...(o.team ? { teamOnly: true } : {}),
    since: o.since ?? '1.0.0',
  };
  return cap;
}

/** A read: no role permission by default, grant level `view`. */
export const read = (name: string, summary: string, o: CapOpts = {}): CapabilityDef => makeCap('read', name, summary, o);
/** A write inside the Space: grant level `edit`. */
export const write = (name: string, summary: string, o: CapOpts = {}): CapabilityDef => makeCap('write', name, summary, o);
/** A create: a write with an idempotency key, checked against the parent. */
export const create = (name: string, summary: string, o: CapOpts = {}): CapabilityDef => makeCap('write', name, summary, { idem: 'key', ...o });
/** An outward act (send, post, pay, deploy, push). Needs `gate` or an explicit `gate: { act: 'none', reason }`. */
export const outward = (name: string, summary: string, o: CapOpts = {}): CapabilityDef => makeCap('outward', name, summary, { idem: 'key', audit: 'always', ...o });

// ---------------------------------------------------------------- events

export interface EvOpts {
  p?: SchemaLike;
  subject?: readonly [ResourceType | 'entity', string];
  vis?: EventDef['vis'];
  label?: Label | 'subject';
  redact?: string[];
  trigger?: string | { title: string; fields?: string[] };
  notify?: string;
  retention?: string;
  replay?: 'pure' | 'stub';
  sv?: number;
  e2e?: 'none' | 'owner';
}

export function ev(name: string, summary: string, o: EvOpts = {}): EventDef {
  const subject = o.subject ?? (['entity', '/id'] as const);
  return {
    name: name as EventName,
    sv: o.sv ?? 1,
    summary,
    payload: toSchema(o.p ?? { id: t.str() }),
    subject: { type: subject[0], id: subject[1] },
    vis: o.vis ?? 'space',
    ...(o.e2e ? { e2e: o.e2e } : {}),
    ...(o.label ? { label: o.label } : {}),
    ...(o.redact ? { redact: o.redact } : {}),
    ...(o.trigger ? { trigger: typeof o.trigger === 'string' ? { title: o.trigger } : o.trigger } : {}),
    ...(o.notify ? { notify: o.notify } : {}),
    ...(o.retention ? { retention: o.retention } : {}),
    replay: o.replay ?? 'pure',
  };
}

// ---------------------------------------------------------------- permissions

const ROLE_LIST: RoleName[] = ['owner', 'admin', 'developer', 'member', 'guest'];

export function perm(key: string, area: PermissionDef['area'], title: string, risk: Risk, on: RoleName[], appliesTo: ResourceType[] = ['space']): PermissionDef {
  const defaults: Partial<Record<RoleName, boolean>> = {};
  for (const r of ROLE_LIST) defaults[r] = on.includes(r);
  return { key, area, title, risk, defaults, appliesTo };
}

// ---------------------------------------------------------------- records and fields

export function field(key: string, type: string, title: string, o: Partial<FieldDef> = {}): FieldDef {
  return { key, type, title, ...o };
}

export function rtype(key: string, title: string, plural: string, icon: string, fields: FieldDef[], o: Partial<RecordTypeDef> = {}): RecordTypeDef {
  return { key, title, plural, icon, label: 'internal', titleField: fields[0]?.key ?? 'title', fields, ...o };
}

export function ftype(key: string, title: string, value: SchemaLike, o: Partial<FieldTypeDef> = {}): FieldTypeDef {
  return {
    key, title,
    storage: { columns: [{ suffix: '', sql: 'TEXT' }] },
    value: toSchema(value),
    merge: 'lww',
    filterOps: ['eq', 'ne', 'in', 'empty', 'notempty'] as FilterOp[],
    sortable: true, groupable: false, indexable: true,
    cell: `ui:Cell${pascal(key)}`, editor: `ui:Editor${pascal(key)}`, csv: 'text',
    ...o,
  };
}

export function vkind(key: string, title: string, query: 'rows' | 'aggregate', o: Partial<ViewKindDef> = {}): ViewKindDef {
  return { key, title, config: t.obj({}), component: `ui:View${pascal(key)}`, query, ...o };
}

function pascal(s: string): string {
  return s.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((x) => x[0]?.toUpperCase() + x.slice(1)).join('');
}

export interface EntityOpts {
  parent?: EntityDef['parent'];
  parentField?: string;
  ownerField?: string;
  multi?: boolean;
  fallback?: { resource: ResourceType; field: string };
  sync?: Partial<EntityDef['sync']>;
  fts?: string[];
  retention?: string;
}

export function entity(key: string, table: string, idPrefix: string, fields: Record<string, string | EntityFieldDef>, resource: ResourceType, o: EntityOpts = {}): EntityDef {
  const f: Record<string, EntityFieldDef> = {};
  for (const [k, v] of Object.entries(fields)) f[k] = typeof v === 'string' ? { type: v } : v;
  return {
    key, table, idPrefix, fields: f,
    ...(o.parent ? { parent: o.parent } : {}),
    acl: { resource, ...(o.parentField ? { parentField: o.parentField } : {}), ...(o.ownerField ? { ownerField: o.ownerField } : {}), ...(o.multi ? { multi: true } : {}), ...(o.fallback ? { fallback: o.fallback } : {}) },
    sync: { profile: { desktop: 'all', phone: 'window', web: 'all' }, ...(o.sync ?? {}) },
    ...(o.fts ? { fts: o.fts } : {}),
    ...(o.retention ? { retention: o.retention } : {}),
  };
}

export function list(type: ResourceType, title: string, plural: string, items: string, o: Partial<ListDef> = {}): ListDef {
  return { type, title, plural, items: items as CapName, folders: true, newItemStartsPersonal: true, shareLevels: ['view', 'use', 'edit', 'manage'], ...o };
}

// ---------------------------------------------------------------- steps, triggers, connectors, tools

export function step(key: string, title: string, category: StepDef['category'], kind: StepDef['kind'], o: Partial<StepDef> & { in?: SchemaLike; out?: SchemaLike } = {}): StepDef {
  const { in: i, out: out, ...rest } = o;
  const input = toSchema(i ?? {});
  const output = toSchema(out ?? {});
  return {
    key, title, category, kind,
    input, output,
    effects: 'read',
    errors: ['validation.bad_input', 'internal.unexpected'],
    retry: { max: 3, backoff: 'exp', baseMs: 500 },
    idempotency: 'natural',
    editor: `ui:Step${pascal(key)}`,
    sample: sample(output),
    ...rest,
  };
}

export function trigger(key: string, title: string, source: TriggerDef['source'], payload: SchemaLike, o: Partial<TriggerDef> = {}): TriggerDef {
  const p = toSchema(payload);
  return { key, title, source, payload: p, sample: sample(p), allowSelfTrigger: false, personalOk: !('webhook' in source), ...o };
}

export function conn(key: string, title: string, o: Partial<ConnectorDef> & Pick<ConnectorDef, 'mode' | 'scope' | 'auth' | 'domains' | 'health'>): ConnectorDef {
  return { key, title, secrets: [], rate: { rps: 5, burst: 10 }, tests: `connectors/${key}/tests`, ...o };
}

export function atool(name: string, summary: string, o: Partial<AgentToolDef> & { in?: SchemaLike; out?: SchemaLike } = {}): AgentToolDef {
  const { in: i, out: out, ...rest } = o;
  const input = toSchema(i ?? {});
  const output = toSchema(out ?? {});
  return { name, summary, input, output, local: 'none', effects: 'read', planMode: 'allowed', examples: [{ input: sample(input), output: sample(output) }], ...rest };
}

export function block(type: string, data: SchemaLike, fallback: string, o: Partial<BlockTypeDef> = {}): BlockTypeDef {
  return { type, v: 1, data: toSchema(data), component: `ui:Block${pascal(type)}`, fallback, ...o };
}

// ---------------------------------------------------------------- screens, health, gate, tasks, notifications

type Q = readonly [cap: string, input?: Record<string, string>, live?: boolean];
type A = readonly [cap: string, input?: Record<string, string>, confirm?: string];

export interface ScreenOpts {
  slot?: KitScreenDef['slot'];
  q?: Record<string, Q>;
  a?: Record<string, A>;
  empty?: string;
  primary?: string;
  needs?: string[];
  perf?: { firstPaintMs: number; completeMs: number };
  menus?: KitScreenDef['menus'];
  keys?: KitScreenDef['keys'];
  ask?: KitScreenDef['ask'];
  caller?: 'principal' | 'anonymous' | 'pending';
}

export function screen(id: string, place: PlaceId | 'shell', builtin: ComponentKey, o: ScreenOpts = {}): KitScreenDef {
  const queries: KitScreenDef['queries'] = {};
  for (const [k, q] of Object.entries(o.q ?? {})) queries[k] = { cap: q[0] as CapName, input: q[1] ?? {}, live: q[2] ?? true };
  const actions: KitScreenDef['actions'] = {};
  for (const [k, a] of Object.entries(o.a ?? {})) actions[k] = { cap: a[0] as CapName, input: a[1] ?? {}, ...(a[2] ? { confirm: a[2] } : {}) };
  return {
    id, place, slot: o.slot ?? 'main', builtin, queries, actions,
    ...(o.caller && o.caller !== 'principal' ? { caller: o.caller } : {}),
    states: {
      empty: { line: o.empty ?? 'Nothing here yet', ...(o.primary ? { primary: o.primary } : {}) },
      offline: { line: 'Offline, showing your saved copy' },
      error: { line: "Couldn't load this", primary: 'Try again' },
    },
    ...(o.menus ? { menus: o.menus } : {}),
    ...(o.keys ? { keys: o.keys } : {}),
    ...(o.needs ? { needs: o.needs } : {}),
    perf: o.perf ?? { firstPaintMs: 50, completeMs: 100 },
    ...(o.ask ? { ask: o.ask } : {}),
  };
}

export function health(key: string, title: string, cap: string, next: string, o: Partial<HealthCheckDef> = {}): HealthCheckDef {
  return { key, title, cap: cap as CapName, intervalSec: 60, timeoutMs: 5000, states: { degradedWhen: 'latencyMs > 2000', downWhen: "state == 'down'" }, next, ...o };
}

export function gateAct(key: string, title: string, risk: Risk, previewBlock: string, o: Partial<GateActKindDef> = {}): GateActKindDef {
  return {
    key, title, risk,
    preview: { blocks: [{ type: previewBlock, from: '$input' }] },
    approvers: { default: 'role:admin', peopleOnly: true },
    timeout: { afterHours: 24, onTimeout: 'escalate', escalateTo: 'delegate', emailBackstopHours: 4 },
    appliesTo: { actors: ['agent', 'automation', 'campaign'], humanToo: false },
    sendsOnApprove: 'gate.release' as CapName,
    ...o,
  };
}

export function taskKind(key: string, title: string, o: Partial<TaskKindDef> & { initial?: TaskState } = {}): TaskKindDef {
  return {
    key, title, needsYou: false, slots: ['assigned', 'reviewer', 'approver'], initial: 'todo', closeOn: 'complete',
    actions: [], blocks: [],
    ...o,
  };
}

export function notif(key: string, level: NotificationKindDef['level'], place: PlaceId, title: string, o: Partial<NotificationKindDef> = {}): NotificationKindDef {
  return { key, level, place, title, collapseKey: `${key}:{{subject}}`, respectHours: level !== 'interrupt', ...(level === 'interrupt' ? { pushTitle: '{{space}} needs you' } : {}), ...o };
}

export function importSource(key: string, title: string, accepts: string[], parse: string, mapsTo: ImportSourceDef['mapsTo']): ImportSourceDef {
  return { key, title, accepts, parse: parse as CapName, mapsTo };
}

export function setting(key: string, scope: SettingDef['scope'], page: string, title: string, schema: SchemaLike, def: unknown, o: Partial<SettingDef> = {}): SettingDef {
  return { key, scope, page, title, schema: toSchema(schema), default: def, ...o };
}

export function retention(key: string, title: string, def: string, o: Partial<RetentionDef> = {}): RetentionDef {
  return { key, title, default: def, holdable: true, tombstone: true, ...o };
}

// ---------------------------------------------------------------- manifest

export type ManifestInput = Omit<Manifest, 'manifest' | 'version' | 'status' | 'kind'> & Partial<Pick<Manifest, 'version' | 'status' | 'kind'>>;

export function defineManifest(m: ManifestInput): Manifest {
  return { manifest: 1, version: '0.1.0', status: 'stub', kind: 'module', ...m };
}

// ---------------------------------------------------------------- binding by input name

export type BindRule = { on: ResourceType } | { row: string };

/** For capabilities still bound to the Space, bind to the resource or entity row named by a required input property. First matching rule wins. */
export function bindInputs(caps: CapabilityDef[], rules: Record<string, BindRule>): CapabilityDef[] {
  return caps.map((c) => {
    if (c.resource.type !== 'space') return c;
    const req = c.input.required ?? [];
    for (const [prop, r] of Object.entries(rules)) {
      if (!req.includes(prop)) continue;
      const resource: ResourceBinding = 'row' in r ? { type: 'entity', entity: r.row, id: `/${prop}` } : { type: r.on, id: `/${prop}` };
      return { ...c, resource };
    }
    return c;
  });
}
