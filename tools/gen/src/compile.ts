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

export function compileValidators(reg: Registry): string {
  const g = new Gen();
  const fns: string[] = [];
  const defNames = Object.keys(reg.$defs ?? {});
  for (const k of defNames) fns.push(g.fn(`d_${k}`, (reg.$defs as Record<string, JsonSchema>)[k] as JsonSchema));
  const caps: string[] = [];
  const nameFor = (s: JsonSchema, base: string): string => {
    if (s.$ref) return `d_${s.$ref.replace('#/$defs/', '')}`;
    fns.push(g.fn(base, s));
    return base;
  };
  reg.capabilities.forEach((c, i) => {
    const a = nameFor(c.input, `c${i}_in`);
    const b = nameFor(c.output, `c${i}_out`);
    caps.push(`  ${q(`${c.name}@${c.v}`)}: { in: ${a}, out: ${b} },`);
  });
  const evs: string[] = [];
  reg.events.forEach((e, i) => evs.push(`  ${q(e.name)}: ${nameFor(e.payload, `e${i}_payload`)},`));
  const leafDecl = [...g.leaves.entries()].map(([key, n]) => {
    const d = JSON.parse(key) as Record<string, unknown>;
    const re = d.re !== undefined ? `new RegExp(${q(String(d.re))})` : undefined;
    const rest = { ...d };
    delete rest.re;
    const body = JSON.stringify(rest).slice(1, -1);
    return `const ${n}: Leaf = { ${[body, re ? `re: ${re}` : ''].filter(Boolean).join(', ')} };`;
  });
  return `// GENERATED by tools/gen from manifests/. Do not edit. Run \`node tools/gen/src/cli.ts\` to regenerate.
// Compiled validators: one function per shared schema, per capability input and output, and per event payload.
// Each pushes error strings (JSON pointer plus reason) into the array; an empty array means valid.

export type Check = (v: unknown, p: string, e: string[]) => void;

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

interface Leaf { t?: string[]; c?: string; en?: string[]; ml?: number; xl?: number; re?: RegExp; mn?: number; mx?: number }

function lf(v: unknown, p: string, e: string[], d: Leaf): void {
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

${leafDecl.join('\n')}

${fns.join('\n\n')}

export const validators: Record<string, { in: Check; out: Check }> = {
${caps.join('\n')}
};

export const eventValidators: Record<string, Check> = {
${evs.join('\n')}
};

export function validateInput(cap: string, v: number, input: unknown): string[] {
  const c = validators[\`\${cap}@\${v}\`];
  if (!c) throw new Error(\`unknown capability \${cap}@\${v}\`);
  const e: string[] = [];
  c.in(input, '', e);
  return e;
}

export function validateOutput(cap: string, v: number, output: unknown): string[] {
  const c = validators[\`\${cap}@\${v}\`];
  if (!c) throw new Error(\`unknown capability \${cap}@\${v}\`);
  const e: string[] = [];
  c.out(output, '', e);
  return e;
}

export function validateEvent(name: string, payload: unknown): string[] {
  const c = eventValidators[name];
  if (!c) throw new Error(\`unknown event \${name}\`);
  const e: string[] = [];
  c(payload, '', e);
  return e;
}
`;
}
