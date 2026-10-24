// Boundaries B1 to B8: module leaves, kernel vs contracts/generated, B8 exceptions, absence of local/hands-* and voice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { absenceViolations, checkSources, generatedGlob, layerDag, parseImports } from './boundaries.ts';
import type { AllowlistFile, BoundariesFile } from './boundaries.ts';

const config: BoundariesFile = {
  layers: {
    '0': ['lib', 'manifest'],
    '1': ['contracts', 'kernel'],
    '2': ['host', 'sync', 'client'],
    '3': ['modules/*', 'agent', 'sandbox'],
    '4': ['ui'],
    '5': ['apps/*', 'kits/*', 'relay/*'],
  },
  mayImport: {
    lib: ['node:*', 'allowlist'],
    manifest: ['lib', 'node:*', 'allowlist'],
    contracts: ['lib', 'manifest'],
    kernel: ['lib', 'manifest'],
    host: ['lib', 'manifest', 'contracts', 'kernel'],
    sync: ['lib', 'manifest', 'contracts', 'kernel'],
    client: ['contracts', 'sync/client', 'lib'],
    'modules/*': ['lib', 'manifest', 'contracts', 'kernel', 'host', 'sync', 'client'],
    agent: ['lib', 'manifest', 'contracts', 'kernel', 'host', 'sync', 'client'],
    sandbox: ['lib', 'manifest', 'contracts', 'kernel', 'host', 'sync', 'client'],
    ui: ['client', 'contracts', 'lib'],
    'apps/*': ['lib', 'manifest', 'contracts', 'sync', 'client', 'ui'],
    'kits/*': ['lib', 'contracts', 'client', 'ui'],
    'relay/*': ['lib', 'manifest', 'contracts', 'sync', 'client'],
  },
  rules: {
    B2: { allowNodeSqlite: ['kernel', 'sync', 'modules/search'] },
    B3: { allowCrypto: ['kernel', 'modules/vault'], crypto: ['node:crypto', '@noble/curves', '@noble/hashes', '@noble/ciphers'] },
    B4: { noFetchIn: ['ui', 'apps'] },
    B5: { generatedGlob: '**/generated/**' },
    B6: { allowlist: 'scripts/allowlist.json' },
    B7: { extra: ['testkit'] },
  },
  exceptions: [
    { id: 'B8', from: ['modules/engine', 'modules/chat', 'modules/mcp', 'modules/memory', 'modules/agents'], to: ['agent'] },
    { id: 'B8', from: ['modules/computers', 'modules/terminal', 'modules/engine'], to: ['sandbox'] },
    { id: 'B8', from: ['modules/sites'], to: ['host/src/caddy.ts'], via: 'ctx.platform handle, not by path' },
  ],
  forbidden: [
    { from: ['agent', 'sandbox'], to: ['modules/*'], reason: 'reach capabilities only through the injected invoke function' },
    { from: ['kernel'], to: ['contracts/generated'], reason: 'the kernel is generic; it receives the registry at boot' },
    { from: ['client'], to: ['kernel', 'host', 'modules/*'] },
    { from: ['apps/*'], to: ['kernel', 'host', 'modules/*', 'agent', 'sandbox'] },
  ],
};

const allow: AllowlistFile = { deps: [{ name: 'ws' }, { name: '@noble/hashes' }, { name: 'playwright', dev: true }] };

test('parseImports reads static and dynamic imports', () => {
  const src = [
    'import a from "./a.ts";',
    'import "./side.ts";',
    'export { b } from "./b.ts";',
    'export const c = import("./c.ts");',
    'const d = require("./d.cjs");',
  ].join('\n');
  const found = parseImports(src);
  assert.deepEqual(found.map((i) => i.spec).sort(), ['./a.ts', './b.ts', './c.ts', './d.cjs', './side.ts']);
  assert.equal(found.find((i) => i.spec === './c.ts')?.dynamic, true);
  assert.equal(found.find((i) => i.spec === './a.ts')?.dynamic, false);
});

test('a module importing another module fails', () => {
  const viaStatic = checkSources({
    'modules/mail/src/index.ts': 'import { x } from "../../inbox/src/index.ts";\n',
  }, config);
  const viaDynamic = checkSources({
    'modules/mail/src/index.ts': 'export const load = () => import("../../inbox/src/index.ts");\n',
  }, config);
  assert.equal(viaStatic.length, 1);
  assert.equal(viaStatic[0]?.rule, 'B1');
  assert.match(viaStatic[0]?.message ?? '', /modules\/mail imports modules\/inbox/);
  assert.equal(viaDynamic.length, 1);
  assert.equal(viaDynamic[0]?.rule, 'B1');
});

test('kernel importing contracts/generated fails', () => {
  const v = checkSources({
    'kernel/src/boot.ts': 'import { reg } from "../../contracts/generated/registry.ts";\n',
  }, config);
  assert.equal(v.length, 1);
  assert.equal(v[0]?.rule, 'forbidden');
  assert.match(v[0]?.message ?? '', /contracts\/generated/);
  assert.match(v[0]?.message ?? '', /registry at boot/);
});

test('B8 exceptions pass and the caddy handle is not a path import', () => {
  const ok = checkSources({
    'modules/engine/src/run.ts': 'import { drive } from "../../../agent/src/driver.ts";\n',
    'modules/computers/src/box.ts': 'import { box } from "../../../sandbox/src/index.ts";\n',
    'modules/chat/src/talk.ts': 'import { talk } from "../../../agent/src/driver.ts";\n',
    'modules/terminal/src/term.ts': 'import { sb } from "../../../sandbox/src/index.ts";\n',
  }, config);
  assert.deepEqual(ok, []);
  const caddy = checkSources({
    'modules/sites/src/publish.ts': 'import { caddy } from "../../../host/src/caddy.ts";\n',
  }, config);
  assert.ok(caddy.some((v) => v.rule === 'B8' && (v.message.includes('not by path'))));
});

test('same-package imports and downward mayImport edges pass', () => {
  const v = checkSources({
    'modules/mail/src/a.ts': 'import { b } from "./b.ts";\n',
    'host/src/gateway.ts': 'import { boot } from "../../kernel/src/boot.ts";\n',
    'client/src/store.ts': 'import { c } from "../../sync/client/store.ts";\n',
  }, config);
  assert.deepEqual(v, []);
  const up = checkSources({
    'client/src/store.ts': 'import { p } from "../../sync/src/protocol.ts";\n',
  }, config);
  assert.ok(up.some((x) => x.rule === 'layer'));
});

test('layer dag points downward and records B8 exceptions', () => {
  assert.equal(generatedGlob(config), '**/generated/**');
  const edges = layerDag(config);
  assert.ok(edges.some((e) => e.from === 'host' && e.to === 'kernel' && e.kind === 'down' && e.fromLayer === 2 && e.toLayer === 1));
  assert.ok(edges.some((e) => e.from === 'modules/engine' && e.to === 'agent' && e.kind === 'exception'));
  assert.ok(edges.some((e) => e.from === 'client' && e.to === 'sync/client' && e.kind === 'exception' && e.fromLayer === 2 && e.toLayer === 2));
});

test('fetch in ui fails and node:sqlite is limited to B2', () => {
  const v = checkSources({
    'ui/src/row.ts': 'export const n = fetch("/api");\n',
    'modules/mail/src/db.ts': 'import "node:sqlite";\n',
    'kernel/src/db.ts': 'import "node:sqlite";\n',
  }, config);
  assert.ok(v.some((x) => x.rule === 'B4' && x.file === 'ui/src/row.ts'));
  assert.ok(v.some((x) => x.rule === 'B2' && x.file === 'modules/mail/src/db.ts'));
  assert.ok(!v.some((x) => x.file === 'kernel/src/db.ts'));
});

test('third-party imports follow the allowlist and B3', () => {
  const v = checkSources({
    'lib/src/net.ts': 'import "ws";\n',
    'ui/src/net.ts': 'import "ws";\n',
    'modules/vault/src/k.ts': 'import "@noble/hashes";\n',
    'modules/mail/src/k.ts': 'import "@noble/hashes";\n',
  }, config, allow);
  assert.deepEqual(v.map((x) => `${x.rule} ${x.file}`).sort(), ['B3 modules/mail/src/k.ts', 'B6 ui/src/net.ts']);
});

test('absence check blocks local/hands-* and voice paths', () => {
  const paths = [
    'lib/hello.mjs',
    'local/hands-chrome-mac/index.js',
    'local/hands-mac/control.js',
    'voice/codec.ts',
    'modules/voice/index.ts',
    'modules/telephony/src/voice_token.ts',
  ];
  assert.deepEqual(absenceViolations(paths).map((v) => v.file), [
    'local/hands-chrome-mac/index.js',
    'local/hands-mac/control.js',
    'voice/codec.ts',
    'modules/voice/index.ts',
  ]);
  const imported = checkSources({
    'lib/src/a.ts': 'import "../../local/hands-chrome-mac/index.js";\n',
  }, config);
  assert.ok(imported.some((v) => v.rule === 'absence' && (v.message.includes('local/hands-'))));
});

test('shipped boundaries.json agrees when the file is present', () => {
  if (!existsSync('scripts/boundaries.json')) return;
  const shipped = JSON.parse(readFileSync('scripts/boundaries.json', 'utf8')) as BoundariesFile;
  const v = checkSources({
    'modules/mail/src/index.ts': 'import "../../inbox/src/index.ts";\n',
    'kernel/src/boot.ts': 'import "../../contracts/generated/registry.ts";\n',
    'modules/engine/src/run.ts': 'import "../../../agent/src/driver.ts";\n',
  }, shipped);
  assert.ok(v.some((x) => x.file.startsWith('modules/mail') && x.rule === 'B1'));
  assert.ok(v.some((x) => x.file.startsWith('kernel/') && x.rule === 'forbidden'));
  assert.ok(!v.some((x) => x.file.startsWith('modules/engine')));
  assert.ok(layerDag(shipped).some((e) => e.kind === 'exception' && e.to === 'agent'));
});

test('an import is a statement: the word inside a string or a dotted name is not one', () => {
  const src = [
    'const ADMIN = ["records.import", "files.read", "from", "x"];',
    'const msg = "do not import from here";',
    'export const keys = ["import"] as const;',
    'import real from "./real.ts";',
  ].join('\n');
  assert.deepEqual(parseImports(src).map((i) => i.spec), ['./real.ts']);
  assert.deepEqual(parseImports('const a = 1; import b from "./b.ts"; export { c } from "./c.ts";').map((i) => i.spec), ['./b.ts', './c.ts']);
});

test('tests are exempt from B2, B3 and B4; named files, dynamicOk and ignoreImports follow the shipped config', () => {
  if (!existsSync('scripts/boundaries.json')) return;
  const shipped = JSON.parse(readFileSync('scripts/boundaries.json', 'utf8')) as BoundariesFile;
  const files: Record<string, string> = {
    'lib/acme/csr.ts': 'import crypto from "node:crypto";\n',
    'lib/other.ts': 'import crypto from "node:crypto";\n',
    'lib/tests/a.test.ts': 'import crypto from "node:crypto";\nimport { DatabaseSync } from "node:sqlite";\n',
    'modules/mail/src/a.ts': 'import { DatabaseSync } from "node:sqlite";\n',
    'ui/src/a.test.ts': 'const f = fetch("/x");\n',
    'ui/src/a.ts': 'const f = fetch("/x");\n',
    'host/src/loader.ts': 'const m = await import(path);\n',
    'host/src/other.ts': 'const m = await import(path);\n',
    'manifest/gen/scaffold/index.ts': 'const t = `import("../../../manifests/${name}.ts")`;\n',
    'packages/contracts/tests/a.test.ts': 'import { all } from "../../../manifests/index.ts";\n',
    'packages/contracts/src/a.ts': 'import { all } from "../../../manifests/index.ts";\n',
    'testkit/src/x.ts': 'import { DatabaseSync } from "node:sqlite";\nimport "../../kernel/src/log/index.ts";\n',
  };
  const bad = new Set(checkSources(files, shipped, { deps: [] }).map((v) => v.file));
  assert.deepEqual([...bad].sort(), ['host/src/other.ts', 'lib/other.ts', 'modules/mail/src/a.ts', 'packages/contracts/src/a.ts', 'ui/src/a.ts']);
});
