// Golden output for outputs 19 and 20: stub handlers answering the first example, not-implemented handlers, lane briefs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/build.ts';
import { emitAll } from '../src/emit.ts';
import { loaded } from './fixture.ts';

const files = emitAll(buildRegistry(loaded()));

test('stub-impl answers the first example output of each capability', () => {
  const s = files.get('modules/alpha/stub-impl.ts') as string;
  assert.match(s, /"alpha.get": async \(\) => \(\{"name":"example"\} as unknown\) as never/);
});

test('not-implemented throws a typed error carrying the trace id', () => {
  const s = files.get('modules/alpha/not-implemented.ts') as string;
  assert.match(s, /throw new VyreErr\(notImplemented\("alpha.get", ctx.trace\)\)/);
});

test('lane brief lists modules, capabilities and the tests that must go green', () => {
  const s = files.get('docs/lanes/L1.md') as string;
  assert.match(s, /generated\/tests\/alpha\//);
  assert.match(s, /alpha.create/);
});
