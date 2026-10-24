// JSON Schema (the subset in contracts) to a TypeScript type expression.
import type { JsonSchema } from '../../../packages/contracts/src/index.ts';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function key(k: string): string {
  return IDENT.test(k) ? k : JSON.stringify(k);
}

export function tsType(s: JsonSchema, depth = 0): string {
  if (s.anyOf && s.anyOf.length) return s.anyOf.map((x) => paren(tsType(x, depth))).join(' | ');
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum && s.enum.length) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (!types.length) return 'unknown';
  return types.map((ty) => one(ty, s, depth)).join(' | ');
}

function paren(t: string): string {
  return t.includes(' | ') ? `(${t})` : t;
}

function one(ty: string, s: JsonSchema, depth: number): string {
  switch (ty) {
    case 'string': return 'string';
    case 'integer':
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array': return `Array<${s.items ? tsType(s.items, depth + 1) : 'unknown'}>`;
    case 'object': {
      const props = s.properties ?? {};
      const names = Object.keys(props);
      if (!names.length) {
        if (s.additionalProperties && typeof s.additionalProperties === 'object') return `Record<string, ${tsType(s.additionalProperties, depth + 1)}>`;
        return 'Record<string, unknown>';
      }
      const req = new Set(s.required ?? []);
      const pad = '  '.repeat(depth + 1);
      const lines = names.map((n) => `${pad}${key(n)}${req.has(n) ? '' : '?'}: ${tsType(props[n] as JsonSchema, depth + 1)};`);
      return `{\n${lines.join('\n')}\n${'  '.repeat(depth)}}`;
    }
    default: return 'unknown';
  }
}

export function pascal(name: string): string {
  return name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('');
}
