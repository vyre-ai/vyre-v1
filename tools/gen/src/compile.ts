// Compiled validators: JSON Schema (with $ref into registry.$defs) to plain TypeScript functions, no runtime dependencies.
import type { JsonSchema, Registry } from '../../../packages/contracts/src/index.ts';

const q = (s: string) => JSON.stringify(s);

class Gen {
  uid = 0;
  regexes = new Map<string, string>();
  re(pattern: string): string {
    let n = this.regexes.get(pattern);
    if (!n) { n = `re${this.regexes.size}`; this.regexes.set(pattern, n); }
    return n;
  }

  /** Emit statements validating variable `v` at path expression `p` into the array variable `errs`. */
  node(s: JsonSchema, v: string, p: string, errs: string, out: string[]): void {
    if (s.$ref) { out.push(`d_${s.$ref.replace('#/$defs/', '')}(${v}, ${p}, ${errs});`); return; }
    const n = this.uid++;
    if (s.anyOf && s.anyOf.length) {
      const tmps: string[] = [];
      out.push('{');
      s.anyOf.forEach((a, i) => {
        const t = `t${n}_${i}`;
        tmps.push(t);
        out.push(`const ${t}: string[] = [];`);
        this.node(a, v, p, t, out);
      });
      out.push(`if (![${tmps.join(', ')}].some((x) => x.length === 0)) ${errs}.push(${p} + ': matches none of anyOf');`);
      out.push('}');
      return;
    }
    const g = `g${n}`;
    out.push('{', `const ${g} = typeOf(${v});`, `let ok${n} = true;`);
    if (s.const !== undefined) out.push(`if (JSON.stringify(${v}) !== ${q(JSON.stringify(s.const))}) { ${errs}.push(${p} + ': not the constant'); ok${n} = false; }`);
    if (s.enum) out.push(`if (!${JSON.stringify(s.enum.map((x) => JSON.stringify(x)))}.includes(JSON.stringify(${v}))) { ${errs}.push(${p} + ': not in enum'); ok${n} = false; }`);
    const want = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    if (want.length) {
      const cond = want.map((w) => (w === 'number' ? `(${g} === 'number' || ${g} === 'integer')` : `${g} === ${q(w)}`)).join(' || ');
      out.push(`if (!(${cond})) { ${errs}.push(${p} + ': expected ${want.join('|')} got ' + ${g}); ok${n} = false; }`);
    }
    out.push(`if (ok${n}) {`);
    if (s.minLength !== undefined || s.maxLength !== undefined || s.pattern !== undefined) {
      out.push(`if (${g} === 'string') { const s${n} = ${v} as string;`);
      if (s.minLength !== undefined) out.push(`if (s${n}.length < ${s.minLength}) ${errs}.push(${p} + ': too short');`);
      if (s.maxLength !== undefined) out.push(`if (s${n}.length > ${s.maxLength}) ${errs}.push(${p} + ': too long');`);
      if (s.pattern !== undefined) out.push(`if (!${this.re(s.pattern)}.test(s${n})) ${errs}.push(${p} + ': pattern ' + ${q(s.pattern)});`);
      out.push('}');
    }
    if (s.minimum !== undefined || s.maximum !== undefined) {
      out.push(`if (${g} === 'number' || ${g} === 'integer') { const n${n} = ${v} as number;`);
      if (s.minimum !== undefined) out.push(`if (n${n} < ${s.minimum}) ${errs}.push(${p} + ': below minimum');`);
      if (s.maximum !== undefined) out.push(`if (n${n} > ${s.maximum}) ${errs}.push(${p} + ': above maximum');`);
      out.push('}');
    }
    if (s.items || s.minItems !== undefined || s.maxItems !== undefined) {
      out.push(`if (${g} === 'array') { const a${n} = ${v} as unknown[];`);
      if (s.minItems !== undefined) out.push(`if (a${n}.length < ${s.minItems}) ${errs}.push(${p} + ': too few items');`);
      if (s.maxItems !== undefined) out.push(`if (a${n}.length > ${s.maxItems}) ${errs}.push(${p} + ': too many items');`);
      if (s.items) {
        out.push(`for (let i${n} = 0; i${n} < a${n}.length; i${n}++) { const x${n} = a${n}[i${n}];`);
        this.node(s.items, `x${n}`, `${p} + '/' + i${n}`, errs, out);
        out.push('}');
      }
      out.push('}');
    }
    const props = s.properties ?? {};
    const names = Object.keys(props);
    if (names.length || s.required?.length || s.additionalProperties !== undefined) {
      out.push(`if (${g} === 'object') { const o${n} = ${v} as Record<string, unknown>;`);
      for (const k of s.required ?? []) out.push(`if (!(${q(k)} in o${n})) ${errs}.push(${p} + ${q('/' + k)} + ': required');`);
      names.forEach((k, i) => {
        out.push(`if (${q(k)} in o${n}) { const p${n}_${i} = o${n}[${q(k)}];`);
        this.node(props[k] as JsonSchema, `p${n}_${i}`, `${p} + ${q('/' + k)}`, errs, out);
        out.push('}');
      });
      if (s.additionalProperties === false) {
        out.push(`for (const k of Object.keys(o${n})) if (!${JSON.stringify(names)}.includes(k)) ${errs}.push(${p} + '/' + k + ': unknown property');`);
      } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        out.push(`for (const k of Object.keys(o${n})) { if (${JSON.stringify(names)}.includes(k)) continue; const ap${n} = o${n}[k];`);
        this.node(s.additionalProperties, `ap${n}`, `${p} + '/' + k`, errs, out);
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
  const res = [...g.regexes.entries()].map(([pat, n]) => `const ${n} = new RegExp(${q(pat)});`);
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

${res.join('\n')}

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
