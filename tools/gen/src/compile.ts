// Compiled validators: JSON Schema (with $ref into registry.$defs) to plain TypeScript functions, no runtime dependencies.
import type { JsonSchema, Registry } from '../../../packages/contracts/src/index.ts';

const q = (s: string) => JSON.stringify(s);

class Gen {
  uid = 0;
  leaves = new Map<string, string>();

  leaf(s: JsonSchema): string | null {
    const d: Record<string, unknown> = {};
    const want = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    if (want.length) d.t = want;
    if (s.const !== undefined) d.c = JSON.stringify(s.const);
    if (s.enum) d.en = s.enum.map((x) => JSON.stringify(x));
    if (s.minLength !== undefined) d.ml = s.minLength;
    if (s.maxLength !== undefined) d.xl = s.maxLength;
    if (s.pattern !== undefined) d.re = s.pattern;
    if (s.minimum !== undefined) d.mn = s.minimum;
    if (s.maximum !== undefined) d.mx = s.maximum;
    if (!Object.keys(d).length) return null;
    const key = JSON.stringify(d);
    let n = this.leaves.get(key);
    if (!n) { n = `L${this.leaves.size}`; this.leaves.set(key, n); }
    return n;
  }

  isLeaf(s: JsonSchema): boolean {
    return !s.$ref && !s.anyOf && !s.properties && !s.required && !s.items && s.additionalProperties === undefined && s.minItems === undefined && s.maxItems === undefined && !(Array.isArray(s.type) ? s.type.includes('object') || s.type.includes('array') : s.type === 'object' || s.type === 'array');
  }

  /** Emit statements validating expression `v` at path expression `p` into the array variable `errs`. */
  node(s: JsonSchema, v: string, p: string, errs: string, out: string[]): void {
    if (s.$ref) { out.push(`d_${s.$ref.replace('#/$defs/', '')}(${v}, ${p}, ${errs});`); return; }
    if (this.isLeaf(s)) {
      const l = this.leaf(s);
      if (l) out.push(`lf(${v}, ${p}, ${errs}, ${l});`);
      return;
    }
    const n = this.uid++;
    if (s.anyOf && s.anyOf.length) {
      const tmps: string[] = [];
      out.push('{', `const x${n} = ${v};`);
      s.anyOf.forEach((a, i) => {
        const t = `t${n}_${i}`;
        tmps.push(t);
        out.push(`const ${t}: string[] = [];`);
        this.node(a, `x${n}`, p, t, out);
      });
      out.push(`if (![${tmps.join(', ')}].some((x) => x.length === 0)) ${errs}.push(${p} + ': matches none of anyOf');`);
      out.push('}');
      return;
    }
    const want = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    const l = this.leaf({ type: s.type });
    out.push('{', `const x${n} = ${v};`, `const g${n} = typeOf(x${n});`);
    if (l) out.push(`const b${n}: string[] = []; lf(x${n}, ${p}, b${n}, ${l}); if (b${n}.length) ${errs}.push(...b${n});`);
    out.push(`if (${want.length ? want.map((w) => `g${n} === ${q(w)}`).join(' || ') + (want.includes('number') ? ` || g${n} === 'integer'` : '') : 'true'}) {`);
    if (s.items || s.minItems !== undefined || s.maxItems !== undefined) {
      out.push(`if (g${n} === 'array') { const a${n} = x${n} as unknown[];`);
      if (s.minItems !== undefined) out.push(`if (a${n}.length < ${s.minItems}) ${errs}.push(${p} + ': too few items');`);
      if (s.maxItems !== undefined) out.push(`if (a${n}.length > ${s.maxItems}) ${errs}.push(${p} + ': too many items');`);
      if (s.items) {
        out.push(`for (let i${n} = 0; i${n} < a${n}.length; i${n}++) {`);
        this.node(s.items, `a${n}[i${n}]`, `${p} + '/' + i${n}`, errs, out);
        out.push('}');
      }
      out.push('}');
    }
    const props = s.properties ?? {};
    const names = Object.keys(props);
    if (names.length || s.required?.length || s.additionalProperties !== undefined) {
      out.push(`if (g${n} === 'object') { const o${n} = x${n} as Record<string, unknown>;`);
      for (const k of s.required ?? []) out.push(`if (!(${q(k)} in o${n})) ${errs}.push(${p} + ${q('/' + k)} + ': required');`);
      names.forEach((k) => {
        const sub = props[k] as JsonSchema;
        const body: string[] = [];
        this.node(sub, `o${n}[${q(k)}]`, `${p} + ${q('/' + k)}`, errs, body);
        if (!body.length) return;
        if (body.length === 1) out.push(`if (${q(k)} in o${n}) ${body[0]}`);
        else out.push(`if (${q(k)} in o${n}) {`, ...body, '}');
      });
      const known = `(${JSON.stringify(names)} as string[])`;
      if (s.additionalProperties === false) {
        out.push(`for (const k of Object.keys(o${n})) if (!${known}.includes(k)) ${errs}.push(${p} + '/' + k + ': unknown property');`);
      } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        out.push(`for (const k of Object.keys(o${n})) { if (${known}.includes(k)) continue;`);
        this.node(s.additionalProperties, `o${n}[k]`, `${p} + '/' + k`, errs, out);
        out.push('}');
      }
      out.push('}');
    }
    out.push('}', '}');
  }

  fn(name: string, s: JsonSchema): string {
    const body: string[] = [];
    this.node(s, 'v', 'p', 'e', body);
    return `function ${name}(v: unknown, p: string, e: string[]): void {\n${body.join('\n')}\n}`;
  }
}

const HEADER = `// GENERATED by tools/gen from manifests/. Do not edit. Run \`node tools/gen/src/cli.ts\` to regenerate.\n`;

/** The names a block of generated code uses from the shared core: the shared-schema functions, the leaf tables, lf and typeOf. */
const usedFromCore = (code: string): string[] => [...new Set(code.match(/\b(d_[A-Za-z0-9_]+|L\d+|lf|typeOf)\b/g) ?? [])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

/**
 * Compiled validators, one file per module so a screen that checks five capabilities loads five modules' worth of code and not the whole 3.6 MB:
 *   validators/core.ts      Check, typeOf, lf, the leaf tables and one function per shared schema ($defs)
 *   validators/<module>.ts  the module's capability input and output checks and event payload checks, as `validators`, `eventValidators` and `validateInput`/`validateOutput`/`validateEvent` for that module
 *   validators.ts           the index: every module merged, with the same exports the single file had
 */
export function compileValidators(reg: Registry): Map<string, string> {
  const g = new Gen();
  const defNames = Object.keys(reg.$defs ?? {});
  const defFns = defNames.map((k) => g.fn(`d_${k}`, (reg.$defs as Record<string, JsonSchema>)[k] as JsonSchema));
  const perModule = new Map<string, { fns: string[]; caps: string[]; evs: string[] }>();
  const mod = (id: string) => { let m = perModule.get(id); if (!m) { m = { fns: [], caps: [], evs: [] }; perModule.set(id, m); } return m; };
  const nameFor = (m: { fns: string[] }, s: JsonSchema, base: string): string => {
    if (s.$ref) return `d_${s.$ref.replace('#/$defs/', '')}`;
    m.fns.push(g.fn(base, s));
    return base;
  };
  reg.capabilities.forEach((c, i) => {
    const m = mod(c.module);
    const a = nameFor(m, c.input, `c${i}_in`);
    const b = nameFor(m, c.output, `c${i}_out`);
    m.caps.push(`  ${q(`${c.name}@${c.v}`)}: { in: ${a}, out: ${b} },`);
  });
  reg.events.forEach((e, i) => { const m = mod(e.module); m.evs.push(`  ${q(e.name)}: ${nameFor(m, e.payload, `e${i}_payload`)},`); });
  // A shared schema used by one module only (directly, or through other schemas only that module uses) is compiled into that module's file; the rest stay in core.
  const defCode = new Map(defNames.map((k, i) => [`d_${k}`, defFns[i] as string]));
  const refsOf = (code: string): string[] => [...new Set(code.match(/\bd_[A-Za-z0-9_]+/g) ?? [])];
  const reach = new Map<string, Set<string>>();
  const touch = (d: string, m: string): void => {
    let r = reach.get(d);
    if (!r) { r = new Set(); reach.set(d, r); }
    if (r.has(m)) return;
    r.add(m);
    for (const x of refsOf(defCode.get(d) ?? '')) if (x !== d && defCode.has(x)) touch(x, m);
  };
  for (const [id, m] of perModule) for (const d of refsOf(m.fns.join('\n') + m.caps.join('\n') + m.evs.join('\n'))) if (defCode.has(d)) touch(d, id);
  const owner = (d: string): string | null => { const r = reach.get(d); return r && r.size === 1 ? [...r][0]! : null; };
  const leafDecl = [...g.leaves.entries()].map(([key, n]) => {
    const d = JSON.parse(key) as Record<string, unknown>;
    const re = d.re !== undefined ? `new RegExp(${q(String(d.re))})` : undefined;
    const rest = { ...d };
    delete rest.re;
    const body = JSON.stringify(rest).slice(1, -1);
    return `export const ${n}: Leaf = { ${[body, re ? `re: ${re}` : ''].filter(Boolean).join(', ')} };`;
  });
  const out = new Map<string, string>();
  out.set('validators/core.ts', `${HEADER}// Compiled validators, shared part: the check type, the leaf checks and one function per shared schema.
// Each check pushes error strings (JSON pointer plus reason) into the array; an empty array means valid.

export type Check = (v: unknown, p: string, e: string[]) => void;

export function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

export interface Leaf { t?: string[]; c?: string; en?: string[]; ml?: number; xl?: number; re?: RegExp; mn?: number; mx?: number }

export function lf(v: unknown, p: string, e: string[], d: Leaf): void {
  const g = typeOf(v);
  if (d.t && !d.t.some((w) => w === g || (w === 'number' && g === 'integer'))) { e.push(p + ': expected ' + d.t.join('|') + ' got ' + g); return; }
  if (d.c !== undefined && JSON.stringify(v) !== d.c) e.push(p + ': not the constant');
  if (d.en && !d.en.includes(JSON.stringify(v))) e.push(p + ': not in enum');
  if (typeof v === 'string') {
    if (d.ml !== undefined && v.length < d.ml) e.push(p + ': too short');
    if (d.xl !== undefined && v.length > d.xl) e.push(p + ': too long');
    if (d.re && !d.re.test(v)) e.push(p + ': pattern');
  }
  if (typeof v === 'number') {
    if (d.mn !== undefined && v < d.mn) e.push(p + ': below minimum');
    if (d.mx !== undefined && v > d.mx) e.push(p + ': above maximum');
  }
}

/** The checks of one module's table: what validators/<module>.ts and the index use. */
export function checkIn(table: Record<string, { in: Check; out: Check }>, which: 'in' | 'out', cap: string, v: number, input: unknown): string[] {
  const c = table[\`\${cap}@\${v}\`];
  if (!c) throw new Error(\`unknown capability \${cap}@\${v}\`);
  const e: string[] = [];
  c[which](input, '', e);
  return e;
}

${leafDecl.join('\n')}

${[...defCode].filter(([d]) => owner(d) === null).map(([, f]) => f.replace(/^function /, 'export function ')).join('\n\n')}
`);
  const ids = [...perModule.keys()].sort();
  for (const id of ids) {
    const m = perModule.get(id)!;
    const own = [...defCode].filter(([d]) => owner(d) === id).map(([, f]) => f);
    const body = [...own, ...m.fns].join('\n\n');
    const ownNames = new Set([...defCode].filter(([d]) => owner(d) === id).map(([d]) => d));
    const used = usedFromCore(body + m.caps.join('\n') + m.evs.join('\n')).filter((n) => !ownNames.has(n));
    out.set(`validators/${id}.ts`, `${HEADER}// Compiled validators of the ${id} module: the input and output check of each of its capabilities and the payload check of each of its events.
import { checkIn${used.length ? ', ' + used.join(', ') : ''} } from './core.ts';
import type { Check } from './core.ts';

${body}${body ? '\n\n' : ''}export const validators: Record<string, { in: Check; out: Check }> = {
${m.caps.join('\n')}
};

export const eventValidators: Record<string, Check> = {
${m.evs.join('\n')}
};

export const validateInput = (cap: string, v: number, input: unknown): string[] => checkIn(validators, 'in', cap, v, input);
export const validateOutput = (cap: string, v: number, output: unknown): string[] => checkIn(validators, 'out', cap, v, output);
`);
  }
  const alias = (id: string) => 'm_' + id.replace(/[^A-Za-z0-9]/g, '_');
  out.set('validators.ts', `${HEADER}// Compiled validators: every module's checks merged. A screen that needs a few capabilities imports validators/<module>.ts and loads only those.
import { checkIn } from './validators/core.ts';
import type { Check } from './validators/core.ts';
${ids.map((id) => `import { validators as ${alias(id)}, eventValidators as ${alias(id)}_ev } from './validators/${id}.ts';`).join('\n')}

export type { Check };

export const validators: Record<string, { in: Check; out: Check }> = {
${ids.map((id) => `  ...${alias(id)},`).join('\n')}
};

export const eventValidators: Record<string, Check> = {
${ids.map((id) => `  ...${alias(id)}_ev,`).join('\n')}
};

export function validateInput(cap: string, v: number, input: unknown): string[] {
  return checkIn(validators, 'in', cap, v, input);
}

export function validateOutput(cap: string, v: number, output: unknown): string[] {
  return checkIn(validators, 'out', cap, v, output);
}

export function validateEvent(name: string, payload: unknown): string[] {
  const c = eventValidators[name];
  if (!c) throw new Error(\`unknown event \${name}\`);
  const e: string[] = [];
  c(payload, '', e);
  return e;
}
`);
  return out;
}
