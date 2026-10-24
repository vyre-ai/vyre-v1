// vyre-gen diff: compare a released registry with the current one (ARCH 3.6).
// A released capability version is immutable except: new optional input fields, new output fields, new error codes, new examples.
// Anything else is breaking and needs a new `v`. Events: payload additions are free; other changes need a new `sv`.
import type { JsonSchema, Registry } from '../../../packages/contracts/src/index.ts';
import { deref } from '../../../packages/contracts/src/index.ts';

export interface DiffResult { breaking: string[]; additive: string[] }

function type(s: JsonSchema | undefined): string {
  if (!s) return 'unknown';
  return JSON.stringify(Array.isArray(s.type) ? s.type : s.type ?? null) + JSON.stringify(s.enum ?? null) + JSON.stringify(s.const ?? null);
}

/** Changes of a consumer-visible shape. `side` input: tightening is breaking; output: removal and retyping are breaking. */
function compareSchema(path: string, a: JsonSchema, b: JsonSchema, side: 'in' | 'out', da: Registry['$defs'], db: Registry['$defs'], res: DiffResult): void {
  const x = deref(a, da);
  const y = deref(b, db);
  if (type(x) !== type(y)) {
    const inputWidened = side === 'in' && x.enum && y.enum && x.enum.every((v) => y.enum?.some((w) => JSON.stringify(w) === JSON.stringify(v)));
    if (inputWidened) res.additive.push(`${path}: enum widened`);
    else res.breaking.push(`${path}: type or enum changed`);
    return;
  }
  const px = x.properties ?? {};
  const py = y.properties ?? {};
  const rx = new Set(x.required ?? []);
  const ry = new Set(y.required ?? []);
  for (const k of Object.keys(px)) {
    if (!(k in py)) { res.breaking.push(`${path}/${k}: removed`); continue; }
    compareSchema(`${path}/${k}`, px[k] as JsonSchema, py[k] as JsonSchema, side, da, db, res);
    if (side === 'in' && !rx.has(k) && ry.has(k)) res.breaking.push(`${path}/${k}: became required`);
    if (side === 'out' && rx.has(k) && !ry.has(k)) res.breaking.push(`${path}/${k}: no longer always present`);
  }
  for (const k of Object.keys(py)) {
    if (k in px) continue;
    if (side === 'in' && ry.has(k)) res.breaking.push(`${path}/${k}: new required input`);
    else res.additive.push(`${path}/${k}: added`);
  }
  if (x.items && y.items) compareSchema(`${path}[]`, x.items, y.items, side, da, db, res);
  for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'minItems', 'maxItems'] as const) {
    if (side === 'in' && JSON.stringify(x[k]) !== JSON.stringify(y[k])) {
      const tighter = (k.startsWith('min') ? (y[k] as number) > ((x[k] as number) ?? -Infinity) : (y[k] as number) < ((x[k] as number) ?? Infinity)) || k === 'pattern';
      (tighter ? res.breaking : res.additive).push(`${path}: ${k} changed`);
    }
  }
}

export function diffRegistries(oldReg: Registry, newReg: Registry): DiffResult {
  const res: DiffResult = { breaking: [], additive: [] };
  const caps = new Map<string, (typeof newReg.capabilities)[number]>(newReg.capabilities.map((c) => [`${c.name}@${c.v}`, c]));
  for (const o of oldReg.capabilities) {
    const key = `${o.name}@${o.v}`;
    const n = caps.get(key);
    if (!n) {
      const newer = newReg.capabilities.some((c) => c.name === o.name && c.v > o.v);
      if (newer) res.additive.push(`${key}: superseded by a newer v`);
      else res.breaking.push(`${key}: removed without a newer v`);
      continue;
    }
    const before = res.breaking.length;
    compareSchema(`${key} input`, o.input, n.input, 'in', oldReg.$defs, newReg.$defs, res);
    compareSchema(`${key} output`, o.output, n.output, 'out', oldReg.$defs, newReg.$defs, res);
    if (o.effects !== n.effects) res.breaking.push(`${key}: effects changed ${o.effects} to ${n.effects}`);
    if (o.idempotency !== n.idempotency && n.idempotency === 'key') res.breaking.push(`${key}: idempotency key now required`);
    for (const code of n.errors) if (!o.errors.includes(code)) res.additive.push(`${key}: new error ${code}`);
    for (const code of o.errors) if (!n.errors.includes(code)) res.additive.push(`${key}: error ${code} no longer raised`);
    void before;
  }
  for (const n of newReg.capabilities) if (!oldReg.capabilities.some((o) => o.name === n.name && o.v === n.v)) res.additive.push(`${n.name}@${n.v}: new`);
  const evs = new Map(newReg.events.map((e) => [e.name, e] as const));
  for (const o of oldReg.events) {
    const n = evs.get(o.name);
    if (!n) { res.breaking.push(`event ${o.name}: removed`); continue; }
    const r: DiffResult = { breaking: [], additive: [] };
    compareSchema(`event ${o.name}`, o.payload, n.payload, 'out', oldReg.$defs, newReg.$defs, r);
    if (r.breaking.length && n.sv <= o.sv) res.breaking.push(...r.breaking.map((m) => `${m} (bump sv)`));
    else res.additive.push(...r.additive);
  }
  return res;
}
