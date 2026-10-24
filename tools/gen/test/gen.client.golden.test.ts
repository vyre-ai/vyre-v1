// Golden output for outputs 4, 5, 6, 7, 18: typed client, module stubs, MCP tools, tool index, CLI table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/build.ts';
import { emitAll } from '../src/emit.ts';
import { loaded } from './fixture.ts';

const files = emitAll(buildRegistry(loaded()));

test('client and stubs have one function per capability', () => {
  for (const f of ['client.ts', 'stubs.ts']) {
    const s = files.get(f) as string;
    for (const c of ['alpha.create', 'alpha.get', 'beta.notify']) assert.ok(s.includes(`"${c}"`), `${f} ${c}`);
  }
});

test('MCP tool list equals the agent-visible capabilities (no tool for capabilities without a toolset)', () => {
  const tools = (JSON.parse(files.get('mcp-tools.json') as string) as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  assert.deepEqual(tools, ['alpha_create', 'alpha_get']);
  const index = (JSON.parse(files.get('tool-index.json') as string) as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  assert.deepEqual(index, tools);
});

test('types.ts has input and output types and the capability map', () => {
  const t = files.get('types.ts') as string;
  assert.match(t, /export type AlphaGetIn = \{/);
  assert.match(t, /"alpha.get": \{ in: AlphaGetIn; out: AlphaGetOut \};/);
});
