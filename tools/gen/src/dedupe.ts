// Shared schemas: repeated subtrees of every schema in the registry move into registry.$defs and are referenced by $ref.
import { createHash } from 'node:crypto';
import type { JsonSchema, Registry } from '../../../packages/contracts/src/index.ts';
import { sortKeys } from './canonical.ts';

const MIN_BYTES = 160;

function children(s: JsonSchema): JsonSchema[] {
  const out: JsonSchema[] = [];
  for (const p of Object.values(s.properties ?? {})) out.push(p);
  if (s.items) out.push(s.items);
  for (const a of s.anyOf ?? []) out.push(a);
  if (s.additionalProperties && typeof s.additionalProperties === 'object') out.push(s.additionalProperties);
  return out;
}

export function dedupeRegistry(reg: Registry): Registry {
  const canonCache = new Map<object, string>();
  const canon = (s: JsonSchema): string => {
    let c = canonCache.get(s);
    if (c === undefined) { c = JSON.stringify(sortKeys(s)); canonCache.set(s, c); }
    return c;
  };

  const roots: JsonSchema[] = [];
  const each = (xs: Array<Record<string, unknown>>, keys: string[]) => { for (const x of xs) for (const k of keys) if (x[k] && typeof x[k] === 'object') roots.push(x[k] as JsonSchema); };
  each(reg.capabilities as never, ['input', 'output']);
  each(reg.events as never, ['payload']);
  each(reg.fieldTypes as never, ['value', 'options']);
  each(reg.viewKinds as never, ['config']);
  each(reg.steps as never, ['input', 'output']);
  each(reg.triggers as never, ['payload']);
  each(reg.agentTools as never, ['input', 'output']);
  each(reg.blocks as never, ['data']);
  each(reg.settings as never, ['schema']);

  // pass 1: count each distinct expanded subtree once per distinct parent
  const count = new Map<string, number>();
  const seen = new Set<string>();
  const visit = (s: JsonSchema) => {
    const k = canon(s);
    if (k.length >= MIN_BYTES) {
      count.set(k, (count.get(k) ?? 0) + 1);
      if (seen.has(k)) return;
      seen.add(k);
    }
    for (const c of children(s)) visit(c);
  };
  for (const r of roots) visit(r);

  // pass 2: replace
  const defs: Record<string, JsonSchema> = {};
  const nameOf = new Map<string, string>();
  const rebuild = (s: JsonSchema): JsonSchema => {
    const o: JsonSchema = { ...s };
    if (s.properties) o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, replace(v)]));
    if (s.items) o.items = replace(s.items);
    if (s.anyOf) o.anyOf = s.anyOf.map(replace);
    if (s.additionalProperties && typeof s.additionalProperties === 'object') o.additionalProperties = replace(s.additionalProperties);
    return o;
  };
  const replace = (s: JsonSchema): JsonSchema => {
    const k = canon(s);
    if (k.length >= MIN_BYTES && (count.get(k) ?? 0) >= 2) {
      let name = nameOf.get(k);
      if (!name) {
        name = 's_' + createHash('sha256').update(k).digest('hex').slice(0, 10);
        nameOf.set(k, name);
        defs[name] = rebuild(s);
      }
      return { $ref: `#/$defs/${name}` };
    }
    return rebuild(s);
  };
  const apply = (xs: Array<Record<string, unknown>>, keys: string[]) => { for (const x of xs) for (const k of keys) if (x[k] && typeof x[k] === 'object') x[k] = replace(x[k] as JsonSchema); };

  const out = JSON.parse(JSON.stringify(reg)) as Registry;
  apply(out.capabilities as never, ['input', 'output']);
  apply(out.events as never, ['payload']);
  apply(out.fieldTypes as never, ['value', 'options']);
  apply(out.viewKinds as never, ['config']);
  apply(out.steps as never, ['input', 'output']);
  apply(out.triggers as never, ['payload']);
  apply(out.agentTools as never, ['input', 'output']);
  apply(out.blocks as never, ['data']);
  apply(out.settings as never, ['schema']);
  out.$defs = Object.fromEntries(Object.entries(defs).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  return out;
}
