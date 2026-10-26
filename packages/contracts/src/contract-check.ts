// Shared checks used by the generated contract tests (generated/tests/*.contract.test.ts). Hand-written, frozen.
// One test file per module keeps a push that touches generated/ fast; every check is still reported per capability and event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deref, sample, validate } from './jsonschema.ts';
import { ERROR_CODE_SET, VyreErr } from './errors.ts';
import type { Registry } from './registry.ts';

const ROLES = ['owner', 'admin', 'developer', 'member', 'guest'] as const;
const TRACE = '0123456789abcdef0123456789abcdef';

export type StubHandler = (ctx: { trace: { traceId: string } }, input: never) => Promise<unknown>;
export type Check = (v: unknown, p: string, e: string[]) => void;

export function moduleContracts(
  registry: Registry,
  moduleId: string,
  notImplemented: Record<string, StubHandler>,
  examples: Record<string, StubHandler>,
  validators: Record<string, { in: Check; out: Check }>,
  eventValidators: Record<string, Check>,
): void {
  const defs = registry.$defs;
  const events = new Set(registry.events.map((e) => e.name));
  const perms = new Map(registry.permissions.map((p) => [p.key, p] as const));
  const notify = new Set(registry.notificationKinds.map((n) => n.key));
  const retention = new Set(registry.retention.map((r) => r.key));
  const latest = new Map<string, number>();
  for (const c of registry.capabilities) latest.set(c.name, Math.max(latest.get(c.name) ?? 0, c.v));

  for (const cap of registry.capabilities.filter((c) => c.module === moduleId)) {
    const name = `${cap.name}@${cap.v}`;

    test(`${name}: examples validate against input and output (interpreted and compiled)`, () => {
      assert.ok(cap.examples.length >= 1, 'at least one example');
      const compiled = validators[name];
      assert.ok(compiled, 'compiled validators exist');
      for (const ex of cap.examples) {
        assert.deepEqual(validate(cap.input, ex.input, '', defs), [], `example ${ex.name} input`);
        assert.deepEqual(validate(cap.output, ex.output, '', defs), [], `example ${ex.name} output`);
        const ei: string[] = []; compiled.in(ex.input, '', ei);
        const eo: string[] = []; compiled.out(ex.output, '', eo);
        assert.deepEqual(ei, [], 'compiled input validator');
        assert.deepEqual(eo, [], 'compiled output validator');
      }
    });

    test(`${name}: declared errors are in the catalogue and events are declared`, () => {
      for (const code of cap.errors) assert.ok(ERROR_CODE_SET.has(code), `unknown error code ${code}`);
      for (const f of cap.forbids ?? []) assert.ok(ERROR_CODE_SET.has(f.error), `unknown forbids error ${f.error}`);
      for (const e of cap.emits) assert.ok(events.has(e), `undeclared event ${e}`);
    });

    test(`${name}: idempotency, gate and caller rules`, () => {
      if (cap.idempotency === 'key') assert.ok(deref(cap.input, defs).required?.includes('idempotencyKey'), 'input requires idempotencyKey');
      if (cap.effects === 'outward') assert.ok(cap.gate, 'outward capability declares a gate');
      if (cap.caller && cap.caller !== 'principal') {
        assert.equal(cap.permission, null);
        assert.ok(!cap.surfaces.mcp, 'pre-auth capabilities are not agent tools');
      }
    });

    test(`${name}: permission matrix by built-in role`, () => {
      if (cap.permission === null) return;
      const p = perms.get(cap.permission);
      assert.ok(p, `permission ${cap.permission} exists`);
      for (const role of ROLES) assert.equal(typeof p.defaults[role], 'boolean', `${cap.permission} has a default for ${role}`);
      assert.equal(p.defaults.owner, true, 'owner holds every permission');
      for (const f of cap.forbids ?? []) {
        if (f.as !== 'guest-no-grant') assert.notEqual(p.defaults[f.as], true, `${f.as} is expected to lack ${cap.permission}`);
      }
    });

    if (latest.get(cap.name) === cap.v) {
      const h = notImplemented[cap.name];
      const ex = examples[cap.name];
      if (h) {
        test(`${name}: stub handler returns a typed not-implemented error with the trace id`, async () => {
          const input = sample(cap.input, 0, defs) as never;
          await assert.rejects(
            () => h({ trace: { traceId: TRACE } }, input),
            (e: unknown) => e instanceof VyreErr && e.error.code === 'internal.not_implemented' && e.error.traceId === TRACE && e.error.next.length > 0,
          );
        });
      }
      if (ex) {
        test(`${name}: example-answer stub returns a valid output`, async () => {
          const out = await ex({ trace: { traceId: TRACE } }, sample(cap.input, 0, defs) as never);
          assert.deepEqual(validate(cap.output, out, '', defs), []);
        });
      }
    }

    test(`${name}: real handler passes the examples (pending until the module is live)`, { todo: true }, () => {
      assert.fail('handler not implemented');
    });
  }

  for (const ev of registry.events.filter((e) => e.module === moduleId)) {
    test(`${ev.name}@${ev.sv}: payload schema, subject, visibility and redaction`, () => {
      const payload = validate(ev.payload, sample(ev.payload, 0, defs), '', defs);
      assert.deepEqual(payload, [], 'sample payload validates');
      const compiled = eventValidators[ev.name];
      assert.ok(compiled, 'compiled event validator exists');
      const errs: string[] = [];
      compiled(sample(ev.payload, 0, defs), '', errs);
      assert.deepEqual(errs, []);
      assert.ok(ev.subject.id.startsWith('/'), 'subject is a JSON pointer');
      for (const r of ev.redact ?? []) assert.ok(r.startsWith('/'), 'redact entries are JSON pointers');
      if (ev.notify) assert.ok(notify.has(ev.notify), `notification kind ${ev.notify} exists`);
      if (ev.retention) assert.ok(retention.has(ev.retention), `retention ${ev.retention} exists`);
      assert.ok(['space', 'participants', 'owner', 'private'].includes(ev.vis));
    });
  }
}

/** The capability families a test fake checks (see strictGuard). */
export const STRICT_PREFIXES: readonly string[] = ['records.', 'tasks.'];

/**
 * The guard a module test's fake for records.* and tasks.* runs before it answers: the input must pass the generated validator, and a tasks.create action key must be in the action list of its
 * kind (the real handler refuses it with validation.precondition_failed). Without it a unit test passes on a call the booted daemon answers with 422. Three bugs passed that way in a week:
 * vault.request card actions (#584), access.request task actions (golden 12), and meetings writing epoch ms where records wants ISO (#630).
 * `validateInput` is generated/validators.ts's, passed in so this file stays free of generated imports. The guard throws `{ error: { code, message, errors } }` like the host, and ignores every other capability.
 */
export function strictGuard(registry: Registry, validateInput: (cap: string, v: number, input: unknown) => string[]): (cap: string, input: unknown) => void {
  const latest = new Map<string, number>();
  for (const c of registry.capabilities) latest.set(c.name, Math.max(latest.get(c.name) ?? 0, c.v));
  const kindActions = new Map<string, Set<string>>();
  for (const k of registry.taskKinds) kindActions.set(k.key, new Set(k.actions.map((a) => a.key)));
  const actionErrors = (input: unknown): string[] => {
    if (input === null || typeof input !== 'object') return [];
    const o = input as { kind?: unknown; actions?: unknown };
    if (!Array.isArray(o.actions)) return [];
    const kind = typeof o.kind === 'string' ? o.kind : 'work';
    const allowed = kindActions.get(kind);
    if (!allowed) return [];
    const out: string[] = [];
    for (const a of o.actions) {
      const key = a !== null && typeof a === 'object' ? (a as { key?: unknown }).key : undefined;
      if (typeof key === 'string' && !allowed.has(key)) out.push(`/actions: a ${kind} task has no action called ${key}`);
    }
    return out;
  };
  return (cap, input) => {
    if (!STRICT_PREFIXES.some((p) => cap.startsWith(p))) return;
    const v = latest.get(cap);
    if (v === undefined) return;
    const schema = validateInput(cap, v, input);
    const actions = cap === 'tasks.create' ? actionErrors(input) : [];
    const errors = [...schema, ...actions];
    if (errors.length === 0) return;
    const code = schema.length === 0 ? 'validation.precondition_failed' : 'validation.bad_input';
    const message = `${cap} refused its input: ${errors.slice(0, 5).join('; ')}`;
    throw Object.assign(new Error(message), { error: { code, message, errors } });
  };
}
