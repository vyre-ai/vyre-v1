// Small JSON Schema subset: validator and deterministic sampler. No dependencies.
import type { JsonSchema } from './types.ts';

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeOk(want: string, got: string): boolean {
  return want === got || (want === 'number' && got === 'integer');
}

export function validate(schema: JsonSchema, value: unknown, path = ''): string[] {
  const out: string[] = [];
  walk(schema, value, path, out);
  return out;
}

function walk(s: JsonSchema, v: unknown, p: string, out: string[]): void {
  if (s.anyOf) {
    const attempts = s.anyOf.map((sub) => validate(sub, v, p));
    if (!attempts.some((a) => a.length === 0)) out.push(`${p || '/'}: matches none of anyOf`);
    return;
  }
  if (s.const !== undefined && JSON.stringify(s.const) !== JSON.stringify(v)) out.push(`${p || '/'}: not the constant`);
  if (s.enum && !s.enum.some((x) => JSON.stringify(x) === JSON.stringify(v))) out.push(`${p || '/'}: not in enum`);
  const got = typeOf(v);
  if (s.type) {
    const want = Array.isArray(s.type) ? s.type : [s.type];
    if (!want.some((w) => typeOk(w, got))) {
      out.push(`${p || '/'}: expected ${want.join('|')} got ${got}`);
      return;
    }
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) out.push(`${p || '/'}: too short`);
    if (s.maxLength !== undefined && v.length > s.maxLength) out.push(`${p || '/'}: too long`);
    if (s.pattern !== undefined && !new RegExp(s.pattern).test(v)) out.push(`${p || '/'}: pattern ${s.pattern}`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${p || '/'}: below minimum`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${p || '/'}: above maximum`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${p || '/'}: too few items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${p || '/'}: too many items`);
    if (s.items) v.forEach((x, i) => walk(s.items as JsonSchema, x, `${p}/${i}`, out));
  }
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) out.push(`${p}/${k}: required`);
    const props = s.properties ?? {};
    for (const [k, x] of Object.entries(o)) {
      const sub = props[k];
      if (sub) walk(sub, x, `${p}/${k}`, out);
      else if (s.additionalProperties === false) out.push(`${p}/${k}: unknown property`);
      else if (typeof s.additionalProperties === 'object') walk(s.additionalProperties, x, `${p}/${k}`, out);
    }
  }
}

/** Deterministic example value for a schema. */
export function sample(s: JsonSchema, depth = 0): unknown {
  if (s.examples && s.examples.length) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum && s.enum.length) return s.enum[0];
  if (s.anyOf && s.anyOf.length) return sample(s.anyOf[0] as JsonSchema, depth + 1);
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  switch (type) {
    case 'string': {
      if (s.format === 'date-time') return '2026-01-01T00:00:00.000Z';
      const base = 'example';
      const padded = s.minLength && base.length < s.minLength ? base.padEnd(s.minLength, 'x') : base;
      return s.maxLength !== undefined ? padded.slice(0, s.maxLength) : padded;
    }
    case 'integer': return Math.max(1, s.minimum ?? 1);
    case 'number': return Math.max(1, s.minimum ?? 1);
    case 'boolean': return true;
    case 'null': return null;
    case 'array': {
      if (depth > 6 || !s.items) return [];
      return Array.from({ length: Math.max(1, s.minItems ?? 1) }, () => sample(s.items as JsonSchema, depth + 1));
    }
    case 'object': {
      const o: Record<string, unknown> = {};
      if (depth > 6) return o;
      for (const k of Object.keys(s.properties ?? {}).sort()) o[k] = sample((s.properties as Record<string, JsonSchema>)[k] as JsonSchema, depth + 1);
      return o;
    }
    default: return {};
  }
}

/** Resolve a top-level JSON pointer like '/recordId' to a property schema, or undefined. */
export function pointerSchema(s: JsonSchema, pointer: string): JsonSchema | undefined {
  if (!pointer.startsWith('/')) return undefined;
  let cur: JsonSchema | undefined = s;
  for (const part of pointer.slice(1).split('/')) {
    if (!cur || !cur.properties) return undefined;
    cur = cur.properties[part];
  }
  return cur;
}
