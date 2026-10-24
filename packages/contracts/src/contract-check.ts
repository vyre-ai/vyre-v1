// Shared checks used by the generated contract tests (generated/tests/**). Hand-written, frozen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sample, validate } from './jsonschema.ts';
import { ERROR_CODE_SET, VyreErr } from './errors.ts';
import type { Registry } from './registry.ts';

const ROLES = ['owner', 'admin', 'developer', 'member', 'guest'] as const;
const TRACE = '0123456789abcdef0123456789abcdef';

export type StubHandler = (ctx: { trace: { traceId: string } }, input: never) => Promise<unknown>;

export function capabilityContract(registry: Registry, name: string, v: number, handler?: StubHandler, example?: StubHandler): void {
  const cap = registry.capabilities.find((c) => c.name === name && c.v === v);
  const events = new Set(registry.events.map((e) => e.name));
  const perms = new Map(registry.permissions.map((p) => [p.key, p] as const));
  test(`${name}@${v}: declared in the registry`, () => {
    assert.ok(cap, 'capability is in the registry');
  });
  if (!cap) return;

  test(`${name}@${v}: examples validate against input and output`, () => {
    assert.ok(cap.examples.length >= 1, 'at least one example');
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input), [], `example ${ex.name} input`);
      assert.deepEqual(validate(cap.output, ex.output), [], `example ${ex.name} output`);
    }
  });

  test(`${name}@${v}: declared errors are in the catalogue`, () => {
    for (const code of cap.errors) assert.ok(ERROR_CODE_SET.has(code), `unknown error code ${code}`);
    for (const f of cap.forbids ?? []) assert.ok(ERROR_CODE_SET.has(f.error), `unknown forbids error ${f.error}`);
  });

  test(`${name}@${v}: emitted events are declared`, () => {
    for (const e of cap.emits) assert.ok(events.has(e), `undeclared event ${e}`);
  });

  test(`${name}@${v}: idempotency key is required when declared`, () => {
    if (cap.idempotency === 'key') assert.ok(cap.input.required?.includes('idempotencyKey'), 'input requires idempotencyKey');
  });

  test(`${name}@${v}: permission matrix by built-in role`, () => {
    if (cap.permission === null) {
      assert.equal(cap.level === 'view' || cap.level === 'use' || cap.level === 'edit' || cap.level === 'manage', true);
      return;
    }
    const p = perms.get(cap.permission);
    assert.ok(p, `permission ${cap.permission} exists`);
    for (const role of ROLES) assert.equal(typeof p.defaults[role], 'boolean', `${cap.permission} has a default for ${role}`);
    assert.equal(p.defaults.owner, true, 'owner holds every permission');
    for (const f of cap.forbids ?? []) {
      if (f.as !== 'guest-no-grant') assert.notEqual(p.defaults[f.as], true, `${f.as} is expected to lack ${cap.permission}`);
    }
  });

  test(`${name}@${v}: outward effects name a Gate act`, () => {
    if (cap.effects === 'outward') assert.ok(cap.gate, 'outward capability declares a gate');
  });

  if (handler) {
    test(`${name}@${v}: stub handler returns a typed not-implemented error with the trace id`, async () => {
      const input = sample(cap.input) as never;
      await assert.rejects(
        () => handler({ trace: { traceId: TRACE } }, input),
        (e: unknown) => e instanceof VyreErr && e.error.code === 'internal.not_implemented' && e.error.traceId === TRACE && e.error.next.length > 0,
      );
    });
  }

  if (example) {
    test(`${name}@${v}: example-answer stub returns a valid output`, async () => {
      const out = await example({ trace: { traceId: TRACE } }, sample(cap.input) as never);
      assert.deepEqual(validate(cap.output, out), []);
    });
  }

  test(`${name}@${v}: real handler passes the examples (pending until the module is live)`, { todo: true }, () => {
    assert.fail('handler not implemented');
  });
}

export function eventContracts(registry: Registry, moduleId: string): void {
  const notify = new Set(registry.notificationKinds.map((n) => n.key));
  const retention = new Set(registry.retention.map((r) => r.key));
  for (const ev of registry.events.filter((e) => e.module === moduleId)) {
    test(`${ev.name}@${ev.sv}: payload schema, subject, visibility and redaction`, () => {
      assert.equal(ev.payload.type, 'object', 'payload is an object');
      assert.deepEqual(validate(ev.payload, sample(ev.payload)), [], 'sample payload validates');
      assert.ok(ev.subject.id.startsWith('/'), 'subject is a JSON pointer');
      assert.ok(ev.subject.id.slice(1).split('/')[0] in (ev.payload.properties ?? {}), 'subject pointer resolves in the payload');
      for (const r of ev.redact ?? []) assert.ok(r.startsWith('/'), 'redact entries are JSON pointers');
      if (ev.notify) assert.ok(notify.has(ev.notify), `notification kind ${ev.notify} exists`);
      if (ev.retention) assert.ok(retention.has(ev.retention), `retention ${ev.retention} exists`);
      assert.ok(['space', 'participants', 'owner', 'private'].includes(ev.vis));
    });
  }
}
