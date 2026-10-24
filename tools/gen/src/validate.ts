// Validation before emit (ARCHITECTURE-V1.md 3.7). Returns every problem found; the CLI fails if there is any.
import type { CapabilityDef, EventDef } from '../../../packages/contracts/src/index.ts';
import { ERROR_CODE_SET, RESOURCE_TYPE_LIST, pointerSchema, sample, validate } from '../../../packages/contracts/src/index.ts';
import type { Loaded } from './load.ts';
import { pascal } from './schema-ts.ts';
import { ENTITY_RESERVED, RT_RESERVED } from './ddl.ts';

export interface LaneTable {
  lanes: Record<string, string[]>;
  extras: Record<string, string>;
  frozenCount: number;
  versioned?: string[];
}

const CAP_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const EVENT_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ROLES = ['owner', 'admin', 'developer', 'member', 'guest'];
const VERSIONED_DEFAULT = ['records', 'files', 'automations', 'memory', 'kits', 'agents'];
const FORBIDDEN_CHARS: Array<[string, RegExp]> = [['em dash', /—/], ['section sign', /§/]];

export function mcpToolName(c: CapabilityDef): string | undefined {
  return c.surfaces.mcp ? (c.surfaces.mcp.name ?? c.name.replace(/\./g, '_')) : undefined;
}

export function agentVisible(c: CapabilityDef): boolean {
  const a = c.surfaces.agent;
  if (a === undefined) return Boolean(c.surfaces.mcp);
  return a !== false;
}

export function autoRoute(c: CapabilityDef): { method: string; path: string } {
  if (c.surfaces.http && c.surfaces.http !== 'auto') return c.surfaces.http;
  return { method: 'POST', path: `/v1/${c.name.replace(/\./g, '/')}${c.v > 1 ? `@${c.v}` : ''}` };
}

function walkStrings(v: unknown, path: string, cb: (s: string, path: string) => void): void {
  if (typeof v === 'string') cb(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}/${i}`, cb));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkStrings(x, `${path}/${k}`, cb);
}

export function validateAll(loaded: Loaded[], table: LaneTable): string[] {
  const errs: string[] = [];
  const err = (m: string) => errs.push(m);
  const ms = loaded.map((l) => l.manifest);

  // ---- manifests and lanes
  const laneOf = new Map<string, string>();
  for (const [lane, mods] of Object.entries(table.lanes)) for (const id of mods) {
    if (laneOf.has(id)) err(`lanes: module ${id} is in two lanes`);
    laneOf.set(id, lane);
  }
  if (laneOf.size !== table.frozenCount) err(`lanes: lane table lists ${laneOf.size} modules, expected ${table.frozenCount}`);
  const ids = new Set<string>();
  for (const l of loaded) {
    const m = l.manifest;
    const where = `[${l.file}]`;
    if (m.manifest !== 1) err(`${where} manifest must be 1`);
    if (!KEBAB.test(m.id)) err(`${where} id ${m.id} is not kebab case`);
    const base = l.file.replace(/^manifests\/(connectors\/|kits\/)?/, '').replace(/\.ts$/, '');
    if (m.id !== base) err(`${where} id ${m.id} must equal the file name ${base}`);
    if (ids.has(m.id)) err(`${where} duplicate module id ${m.id}`);
    ids.add(m.id);
    const lane = laneOf.get(m.id) ?? table.extras[m.id];
    if (!lane) err(`${where} module ${m.id} is not in the lane table or extras`);
    else if (m.owner !== lane) err(`${where} owner ${m.owner} must be ${lane}`);
    if (l.dir === '' && !laneOf.has(m.id)) err(`${where} ${m.id} is not one of the ${table.frozenCount} modules`);
    if (l.dir === 'connectors' && m.kind !== 'connector') err(`${where} kind must be connector`);
    if (l.dir === 'kits' && m.kind !== 'kit') err(`${where} kind must be kit`);
    if (m.kind === 'connector' && !(m.connectors ?? []).length) err(`${where} connector module declares no connectors`);
  }
  for (const id of laneOf.keys()) if (!ids.has(id)) err(`lanes: module ${id} has no manifest`);
  for (const m of ms) for (const r of Object.keys(m.requires ?? {})) if (!ids.has(r)) err(`[${m.id}] requires unknown module ${r}`);

  // ---- collect declarations
  const caps = new Map<string, CapabilityDef & { module: string }>();
  const events = new Map<string, EventDef & { module: string }>();
  const perms = new Map<string, string>();
  const dupe = (kind: string, map: Map<string, unknown>, key: string, m: string) => {
    if (map.has(key)) err(`[${m}] duplicate ${kind} ${key}`);
  };
  const sets = {
    fieldTypes: new Set<string>(), viewKinds: new Set<string>(), recordTypes: new Set<string>(), entities: new Set<string>(),
    gateActs: new Set<string>(), blocks: new Set<string>(), notif: new Set<string>(), retention: new Set<string>(),
    health: new Set<string>(), steps: new Set<string>(), triggers: new Set<string>(), connectors: new Set<string>(),
    agentTools: new Set<string>(), screens: new Set<string>(), taskKinds: new Set<string>(), imports: new Set<string>(),
    settings: new Set<string>(), lists: new Set<string>(),
  };
  const uniq = (kind: string, set: Set<string>, key: string, m: string) => {
    if (set.has(key)) err(`[${m}] duplicate ${kind} ${key}`);
    set.add(key);
  };
  for (const m of ms) {
    for (const c of m.capabilities ?? []) {
      const k = `${c.name}@${c.v}`;
      dupe('capability', caps, k, m.id);
      caps.set(k, { ...c, module: m.id });
    }
    for (const e of m.events ?? []) { dupe('event', events, e.name, m.id); events.set(e.name, { ...e, module: m.id }); }
    for (const p of m.permissions ?? []) { if (perms.has(p.key)) err(`[${m.id}] duplicate permission ${p.key}`); perms.set(p.key, m.id); }
    for (const x of m.fieldTypes ?? []) uniq('field type', sets.fieldTypes, x.key, m.id);
    for (const x of m.viewKinds ?? []) uniq('view kind', sets.viewKinds, x.key, m.id);
    for (const x of m.recordTypes ?? []) uniq('record type', sets.recordTypes, x.key, m.id);
    for (const x of m.entities ?? []) uniq('entity', sets.entities, x.key, m.id);
    for (const x of m.gateActs ?? []) uniq('gate act', sets.gateActs, x.key, m.id);
    for (const x of m.blocks ?? []) uniq('block', sets.blocks, x.type, m.id);
    for (const x of m.notificationKinds ?? []) uniq('notification kind', sets.notif, x.key, m.id);
    for (const x of m.retention ?? []) uniq('retention', sets.retention, x.key, m.id);
    for (const x of m.health ?? []) uniq('health check', sets.health, x.key, m.id);
    for (const x of m.steps ?? []) uniq('step', sets.steps, x.key, m.id);
    for (const x of m.triggers ?? []) uniq('trigger', sets.triggers, x.key, m.id);
    for (const x of m.connectors ?? []) uniq('connector', sets.connectors, x.key, m.id);
    for (const x of m.agentTools ?? []) uniq('agent tool', sets.agentTools, x.name, m.id);
    for (const x of m.screens ?? []) uniq('screen', sets.screens, x.id, m.id);
    for (const x of m.taskKinds ?? []) uniq('task kind', sets.taskKinds, x.key, m.id);
    for (const x of m.importSources ?? []) uniq('import source', sets.imports, x.key, m.id);
    for (const x of m.settings ?? []) uniq('setting', sets.settings, x.key, m.id);
    for (const x of m.lists ?? []) uniq('list', sets.lists, x.type, m.id);
  }
  const capByName = new Map<string, CapabilityDef & { module: string }>();
  for (const c of caps.values()) { const prev = capByName.get(c.name); if (!prev || prev.v < c.v) capByName.set(c.name, c); }

  // ---- capabilities
  const pascalSeen = new Map<string, string>();
  const names = [...capByName.keys()].sort();
  for (let i = 0; i < names.length; i++) {
    const a = names[i] as string;
    const b = names[i + 1];
    if (b !== undefined && b.startsWith(a + '.')) err(`capability ${a} is a prefix of ${b}`);
  }
  const mcpNames = new Map<string, string>();
  const routes = new Map<string, string>();
  for (const c of caps.values()) {
    const w = `[cap ${c.name}]`;
    if (!CAP_RE.test(c.name)) err(`${w} name does not match <area>.<verb>`);
    if (!Number.isInteger(c.v) || c.v < 1) err(`${w} v must be a positive integer`);
    if (!c.summary || c.summary.length > 300) err(`${w} summary must be one line of up to 300 characters`);
    const p = pascal(c.name);
    const prev = pascalSeen.get(p);
    if (prev && prev !== c.name) err(`${w} generates the same type name ${p} as ${prev}`);
    pascalSeen.set(p, c.name);
    for (const code of c.errors) if (!ERROR_CODE_SET.has(code)) err(`${w} unknown error code ${code}`);
    for (const e of c.emits) if (!events.has(e)) err(`${w} emits undeclared event ${e}`);
    if (c.permission !== null && !perms.has(c.permission)) err(`${w} unknown permission ${c.permission}`);
    if (c.input.type !== 'object') err(`${w} input must be an object schema`);
    if (c.output.type !== 'object') err(`${w} output must be an object schema`);
    const r = c.resource;
    if (r.type === 'dynamic') {
      const ps = pointerSchema(c.input, r.ref);
      const typeEnum = ps?.properties?.type?.enum as string[] | undefined;
      if (!ps || !typeEnum || !ps.properties?.id) err(`${w} dynamic resource ref ${r.ref} must be a {type,id} ResourceRef input`);
      else {
        for (const ty of typeEnum) if (!RESOURCE_TYPE_LIST.includes(ty as never)) err(`${w} ref type ${ty} is not a ResourceType`);
        for (const ty of r.allowed ?? []) if (!typeEnum.includes(ty)) err(`${w} allowed type ${ty} is not in the ref enum`);
      }
      if (r.parent && !pointerSchema(c.input, r.parent)) err(`${w} resource parent pointer ${r.parent} is not an input property`);
    } else if (r.type === 'entity') {
      if (!sets.entities.has(r.entity)) err(`${w} unknown entity ${r.entity}`);
      if (!pointerSchema(c.input, r.id)) err(`${w} entity id pointer ${r.id} is not an input property`);
    } else {
      if ('id' in r && !pointerSchema(c.input, r.id)) err(`${w} resource id pointer ${r.id} is not an input property`);
      if ('parent' in r && r.parent && !pointerSchema(c.input, r.parent)) err(`${w} resource parent pointer ${r.parent} is not an input property`);
    }
    if (c.caller && c.caller !== 'principal') {
      if (c.permission !== null) err(`${w} pre-auth capability cannot need a role permission`);
      if (agentVisible(c) || c.surfaces.mcp) err(`${w} pre-auth capability must stay off the agent surface`);
      if (r.type !== 'space') err(`${w} pre-auth capability binds the Space`);
      if (c.caller === 'anonymous' && !c.rate) err(`${w} anonymous capability needs a rate limit`);
    }
    if (c.effects === 'outward' && !c.gate) err(`${w} outward capability needs a gate act or gate: { act: 'none', reason }`);
    if (c.gate) {
      if (c.gate.act === 'none') { if (!c.gate.reason) err(`${w} gate act none needs a reason`); }
      else if (!sets.gateActs.has(c.gate.act)) err(`${w} unknown gate act ${c.gate.act}`);
    }
    if (c.idempotency === 'key' && !(c.input.required ?? []).includes('idempotencyKey')) err(`${w} idempotency key but input does not require idempotencyKey`);
    if (!c.examples.length) err(`${w} needs at least one example`);
    for (const ex of c.examples) {
      for (const m of validate(c.input, ex.input)) err(`${w} example ${ex.name} input: ${m}`);
      for (const m of validate(c.output, ex.output)) err(`${w} example ${ex.name} output: ${m}`);
    }
    for (const f of c.forbids ?? []) {
      if (!ERROR_CODE_SET.has(f.error)) err(`${w} forbids unknown error ${f.error}`);
      if (f.as !== 'guest-no-grant' && !ROLES.includes(f.as) && c.permission === null) err(`${w} forbids as ${f.as} but the capability has no role permission`);
    }
    const tool = mcpToolName(c);
    if (tool) { const o = mcpNames.get(tool); if (o) err(`${w} mcp tool name ${tool} already used by ${o}`); mcpNames.set(tool, c.name); }
    const rt = autoRoute(c);
    const rk = `${rt.method} ${rt.path}`;
    const ro = routes.get(rk);
    if (ro && ro !== `${c.name}@${c.v}`) err(`${w} route ${rk} already used by ${ro}`);
    routes.set(rk, `${c.name}@${c.v}`);
    if (c.surfaces.mcp && c.surfaces.agent === false) err(`${w} has an mcp tool but agent is false`);
  }
  for (const t of table.versioned ?? VERSIONED_DEFAULT) {
    if (!capByName.has(`${t}.versions`)) err(`versioned type ${t}: missing capability ${t}.versions`);
    if (!capByName.has(`${t}.restore_version`)) err(`versioned type ${t}: missing capability ${t}.restore_version`);
  }

  // ---- permissions
  for (const m of ms) for (const p of m.permissions ?? []) {
    const w = `[permission ${p.key}]`;
    for (const r of ROLES) if (typeof p.defaults[r] !== 'boolean') err(`${w} missing default for role ${r}`);
    if (p.defaults.owner !== true || p.defaults.admin !== true) err(`${w} owner and admin must hold every permission`);
    if (p.defaults.guest === true && p.risk === 'high') err(`${w} a high-risk permission cannot default on for guests`);
  }

  // ---- events
  for (const e of events.values()) {
    const w = `[event ${e.name}]`;
    if (!EVENT_RE.test(e.name)) err(`${w} name does not match <primitive>.<verb>`);
    if (e.payload.type !== 'object') err(`${w} payload must be an object schema`);
    if (!e.subject.id.startsWith('/') || !pointerSchema(e.payload, e.subject.id)) err(`${w} subject pointer ${e.subject.id} is not a payload property`);
    for (const r of e.redact ?? []) if (!pointerSchema(e.payload, r)) err(`${w} redact pointer ${r} is not a payload property`);
    for (const f of e.trigger?.fields ?? []) if (!f.startsWith('/')) err(`${w} trigger field ${f} must be a JSON pointer`);
    if (e.notify && !sets.notif.has(e.notify)) err(`${w} unknown notification kind ${e.notify}`);
    if (e.retention && !sets.retention.has(e.retention)) err(`${w} unknown retention ${e.retention}`);
  }

  // ---- entities, record types
  for (const m of ms) {
    for (const e of m.entities ?? []) {
      const w = `[entity ${e.key}]`;
      for (const k of Object.keys(e.fields)) if (ENTITY_RESERVED.includes(k.toLowerCase())) err(`${w} field ${k} is a reserved column name`);
      for (const [k, f] of Object.entries(e.fields)) if (!sets.fieldTypes.has(f.type)) err(`${w} field ${k} has unknown field type ${f.type}`);
      if (e.parent && !sets.entities.has(e.parent.entity)) err(`${w} unknown parent entity ${e.parent.entity}`);
      if (e.acl.multi && !(e.acl.parentField && e.acl.parentField in e.fields)) err(`${w} multi acl needs parentField in fields`);
      if (e.acl.fallback && !(e.acl.fallback.field in e.fields)) err(`${w} acl fallback field ${e.acl.fallback.field} is not a field`);
      if (e.parent && !(e.parent.field in e.fields)) err(`${w} parent field ${e.parent.field} is not a field`);
      for (const f of e.sync.text ?? []) if (!(f in e.fields)) err(`${w} sync.text field ${f} is not a field`);
      for (const f of e.sync.protectedFields ?? []) if (!(f in e.fields)) err(`${w} protected field ${f} is not a field`);
      for (const f of e.fts ?? []) if (!(f in e.fields)) err(`${w} fts field ${f} is not a field`);
      if (e.retention && !sets.retention.has(e.retention)) err(`${w} unknown retention ${e.retention}`);
    }
    for (const r of m.recordTypes ?? []) {
      const w = `[record type ${r.key}]`;
      const keys = new Set<string>();
      for (const f of r.fields) {
        if (keys.has(f.key)) err(`${w} duplicate field ${f.key}`);
        keys.add(f.key);
        if (!sets.fieldTypes.has(f.type)) err(`${w} field ${f.key} has unknown field type ${f.type}`);
        if (RT_RESERVED.includes(f.key.toLowerCase()) && !(f.key === 'owner' && r.ownerField === 'owner')) err(`${w} field ${f.key} is a reserved column name`);
      }
      for (const k of [r.titleField, r.summaryField, r.statusField, r.ownerField]) if (k && !keys.has(k)) err(`${w} ${k} is not a field`);
      for (const v of r.views ?? []) if (!sets.viewKinds.has(v.kind)) err(`${w} view ${v.key} has unknown kind ${v.kind}`);
      if (r.retention && !sets.retention.has(r.retention)) err(`${w} unknown retention ${r.retention}`);
      if (r.workspace && r.template !== 'project' && r.key !== 'project') err(`${w} workspace is only for Projects and Journey types`);
    }
    for (const f of m.fieldTypes ?? []) {
      if (f.sealed && f.merge !== 'assistant') err(`[field type ${f.key}] sealed values merge through the assistant`);
    }
    for (const v of m.viewKinds ?? []) for (const n of v.needs ?? []) if (!sets.fieldTypes.has(n.fieldType)) err(`[view kind ${v.key}] needs unknown field type ${n.fieldType}`);
  }

  // ---- references to capabilities
  const need = (w: string, name: string | undefined) => { if (name && !capByName.has(name)) err(`${w} references unknown capability ${name}`); };
  const agentTools = new Map<string, string>();
  for (const m of ms) for (const a of m.agentTools ?? []) if (a.cap) agentTools.set(a.cap, a.name);
  for (const m of ms) {
    for (const s of m.steps ?? []) {
      const w = `[step ${s.key}]`;
      if (s.kind === 'capability' && !s.cap) err(`${w} kind capability needs cap`);
      need(w, s.cap); need(w, s.compensate);
      if (s.gateAct && !sets.gateActs.has(s.gateAct)) err(`${w} unknown gate act ${s.gateAct}`);
      for (const c of s.errors) if (!ERROR_CODE_SET.has(c)) err(`${w} unknown error code ${c}`);
      for (const e of s.waits?.cancelsOn ?? []) if (!events.has(e)) err(`${w} cancelsOn undeclared event ${e}`);
      if (s.cap) { const c = capByName.get(s.cap); if (c && c.effects === 'outward' && s.effects !== 'outward') err(`${w} wraps outward capability ${s.cap} but effects is ${s.effects}`); }
    }
    for (const tr of m.triggers ?? []) {
      if ('event' in tr.source && !events.has(tr.source.event)) err(`[trigger ${tr.key}] undeclared event ${tr.source.event}`);
      if ('events' in tr.source) {
        if (!tr.source.events.length) err(`[trigger ${tr.key}] events list is empty`);
        for (const e of tr.source.events) if (!events.has(e)) err(`[trigger ${tr.key}] undeclared event ${e}`);
      }
      if ('webhook' in tr.source && tr.personalOk) err(`[trigger ${tr.key}] webhook triggers need a Team Space (personalOk false)`);
    }
    for (const c of m.connectors ?? []) {
      const w = `[connector ${c.key}]`;
      for (const a of c.actions ?? []) need(w, a);
      for (const s of c.sources ?? []) if (!events.has(s.event)) err(`${w} source ${s.key} undeclared event ${s.event}`);
      if (!sets.health.has(c.health)) err(`${w} unknown health check ${c.health}`);
      for (const st of c.syncedTypes ?? []) if (!sets.recordTypes.has(st.type)) err(`${w} synced type ${st.type} is not a record type`);
      if (!c.domains.length && c.mode !== 'webhook_only') err(`${w} declares no egress domains`);
    }
    for (const a of m.agentTools ?? []) {
      const w = `[agent tool ${a.name}]`;
      need(w, a.cap);
      for (const b of a.blocks ?? []) if (!sets.blocks.has(b)) err(`${w} unknown block ${b}`);
      if (mcpNames.has(a.name) && mcpNames.get(a.name) !== a.cap) err(`${w} name collides with capability tool of ${mcpNames.get(a.name)}`);
    }
    for (const b of m.blocks ?? []) {
      const w = `[block ${b.type}]`;
      for (const a of b.actions ?? []) {
        need(w, a.cap);
        const c = capByName.get(a.cap);
        if (c) for (const k of Object.keys(a.input)) if (!(k in (c.input.properties ?? {}))) err(`${w} action ${a.key} maps ${k} which is not an input of ${a.cap}`);
      }
    }
    for (const s of m.screens ?? []) {
      const w = `[screen ${s.id}]`;
      const check = (kind: string, name: string, cap: string, input: Record<string, string>) => {
        need(`${w} ${kind} ${name}`, cap);
        const c = capByName.get(cap);
        if (!c) return;
        for (const k of Object.keys(input)) if (!(k in (c.input.properties ?? {}))) err(`${w} ${kind} ${name} maps ${k} which is not an input of ${cap}`);
        const sc = s.caller ?? 'principal';
        const cc = c.caller ?? 'principal';
        if (sc !== cc) err(`${w} ${kind} ${name} uses ${cap} (caller ${cc}) from a ${sc} screen`);
        else if (cc === 'principal' && !agentVisible(c) && !agentTools.has(cap)) err(`${w} ${kind} ${name} uses ${cap} which agents cannot call (agent parity)`);
      };
      for (const [k, q] of Object.entries(s.queries)) check('query', k, q.cap, q.input);
      for (const [k, a] of Object.entries(s.actions)) check('action', k, a.cap, a.input);
      for (const n of s.needs ?? []) if (!perms.has(n)) err(`${w} needs unknown permission ${n}`);
    }
    for (const h of m.health ?? []) {
      const w = `[health ${h.key}]`;
      need(w, h.cap);
      for (const d of h.dependsOn ?? []) if (!sets.health.has(d)) err(`${w} depends on unknown check ${d}`);
    }
    for (const g of m.gateActs ?? []) {
      const w = `[gate act ${g.key}]`;
      need(w, g.sendsOnApprove);
      for (const b of g.preview.blocks) if (!sets.blocks.has(b.type)) err(`${w} preview uses unknown block ${b.type}`);
    }
    for (const k of m.taskKinds ?? []) {
      const w = `[task kind ${k.key}]`;
      for (const a of k.actions) need(w, a.cap);
      for (const b of k.blocks) if (!sets.blocks.has(b)) err(`${w} unknown block ${b}`);
    }
    for (const n of m.notificationKinds ?? []) for (const a of n.actions ?? []) need(`[notification ${n.key}]`, a.cap);
    for (const i of m.importSources ?? []) need(`[import source ${i.key}]`, i.parse);
    for (const l of m.lists ?? []) need(`[list ${l.type}]`, l.items);
    for (const s of m.settings ?? []) {
      for (const msg of validate(s.schema, s.default)) err(`[setting ${s.key}] default: ${msg}`);
    }
  }
  for (const c of caps.values()) for (const b of c.surfaces.agent && typeof c.surfaces.agent === 'object' ? c.surfaces.agent.blocks ?? [] : []) {
    if (!sets.blocks.has(b)) err(`[cap ${c.name}] agent surface uses unknown block ${b}`);
  }

  // ---- text lint: no em dash or section sign anywhere in declarations
  const seen: string[] = [];
  for (const m of ms) walkStrings(m, `/${m.id}`, (s, path) => {
    for (const [name, re] of FORBIDDEN_CHARS) if (re.test(s) && seen.length < 20) seen.push(`${path}: contains ${name}`);
  });
  for (const s of seen) err(`text: ${s}`);

  // sample sanity: every event payload and capability output can be sampled
  for (const e of events.values()) { try { sample(e.payload); } catch { err(`[event ${e.name}] payload cannot be sampled`); } }
  return errs.sort();
}
